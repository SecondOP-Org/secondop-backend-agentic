import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { transaction } from '../database/connection';
import { AppError } from '../middleware/errorHandler';
import {
  buildPasswordResetEmail,
  buildWelcomeVerifyEmail,
  getAppPublicUrl,
  isEmailConfigured,
  queueEmail,
} from './email.service';
import logger from '../utils/logger';
import { normalizeDoctorSpecialty } from '../constants/doctorSpecialties';
import {
  createPendingOrganizationWithOwner,
  markOrganizationInviteAccepted,
  parseOrganizationSignupInput,
  resolveInviteForDoctorRegistration,
} from './organization.service';
import {
  createSignupApprovalToken,
  decideSignupApproval,
  queueSignupApprovalNotify,
  signupRequiresApproval,
} from './signupApproval.service';
import * as authRepository from '../repositories/auth.repository';

const generateToken = (
  userId: string,
  email: string,
  userType: 'patient' | 'doctor' | 'organization'
) => {
  const expiresIn = (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'];
  return jwt.sign({ id: userId, email, type: userType }, process.env.JWT_SECRET!, { expiresIn });
};

const generateRefreshToken = (userId: string) => {
  const expiresIn = (process.env.JWT_REFRESH_EXPIRES_IN || '30d') as jwt.SignOptions['expiresIn'];
  return jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET!, { expiresIn });
};

const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const hashSecret = (value: string): string => {
  return crypto.createHash('sha256').update(value).digest('hex');
};

const bcryptRounds = Number.isFinite(Number(process.env.BCRYPT_ROUNDS))
  ? Math.max(12, parseInt(process.env.BCRYPT_ROUNDS as string, 10))
  : 12;

export interface RegisterInput {
  email: string;
  phone?: string;
  password: string;
  userType: string;
  firstName: string;
  lastName: string;
  inviteToken?: string;
  specialty?: string;
  licenseNumber?: string;
  registrationNumber?: string;
  registrationCouncil?: string;
  country?: string;
  npi?: string;
  [key: string]: unknown;
}

export interface RegisterResult {
  status: 'pendingApproval' | 'success';
  user: {
    id: string;
    email: string;
    userType: string;
    isVerified: boolean;
  };
  token?: string;
  refreshToken?: string;
  emailVerificationSent?: boolean;
}

export const register = async (input: RegisterInput): Promise<RegisterResult> => {
  const { email, phone, password, userType, firstName, lastName } = input;

  if (!email || !password || !userType || !firstName || !lastName) {
    throw new AppError('Missing required fields', 400);
  }

  if (!['patient', 'doctor', 'organization'].includes(userType)) {
    throw new AppError('Invalid user type', 400);
  }

  if (
    typeof input.inviteToken === 'string' &&
    input.inviteToken.trim() &&
    userType !== 'doctor'
  ) {
    throw new AppError('Organization invites can only be accepted by doctor accounts', 400);
  }

  const existingUser = await authRepository.findExistingUserByEmailOrPhone(
    email,
    phone || null
  );

  if (existingUser.length > 0) {
    throw new AppError('User already exists with this email or phone', 409);
  }

  const passwordHash = await bcrypt.hash(password, bcryptRounds);
  const requiresApproval = signupRequiresApproval();

  const result = await transaction(async (client) => {
    const user = await authRepository.insertUser(
      {
        email,
        phone: phone || null,
        passwordHash,
        userType,
        isVerified: false,
        isActive: !requiresApproval,
      },
      client
    );

    if (userType === 'patient') {
      await authRepository.insertPatient(user.id, firstName, lastName, client);
    } else if (userType === 'organization') {
      const orgInput = parseOrganizationSignupInput(input as Record<string, unknown>);
      if (orgInput.contactEmail.toLowerCase() !== String(email).toLowerCase()) {
        throw new AppError('Organization contact email must match the account email', 400);
      }
      await createPendingOrganizationWithOwner(client, orgInput, user.id);
    } else {
      const {
        specialty,
        licenseNumber,
        registrationNumber,
        registrationCouncil,
        country,
        npi,
        inviteToken,
      } = input;
      const registrationId =
        typeof registrationNumber === 'string' && registrationNumber.trim()
          ? registrationNumber.trim()
          : typeof licenseNumber === 'string'
            ? licenseNumber.trim()
            : '';
      const council = typeof registrationCouncil === 'string' ? registrationCouncil.trim() : '';
      const jurisdiction = typeof country === 'string' ? country.trim() : '';
      const npiValue = typeof npi === 'string' && npi.trim() ? npi.trim() : null;
      const normalizedSpecialty =
        typeof specialty === 'string' ? normalizeDoctorSpecialty(specialty) : null;

      if (!normalizedSpecialty || !registrationId || !council || !jurisdiction) {
        throw new AppError(
          'Specialty (from allowed list), registration council, registration number, and country are required for doctors',
          400
        );
      }

      let organizationId: string | null = null;
      let inviteId: string | null = null;
      if (typeof inviteToken === 'string' && inviteToken.trim()) {
        const invite = await resolveInviteForDoctorRegistration(client, {
          inviteToken: inviteToken.trim(),
          email: String(email),
        });
        organizationId = invite.organizationId;
        inviteId = invite.inviteId;
      }

      await authRepository.insertDoctor(
        {
          userId: user.id,
          firstName,
          lastName,
          specialty: normalizedSpecialty,
          registrationId,
          council,
          jurisdiction,
          npiValue,
          organizationId,
        },
        client
      );

      if (organizationId && inviteId) {
        await authRepository.insertOrganizationMember(organizationId, user.id, client);
        await markOrganizationInviteAccepted(client, inviteId, user.id);
      }
    }

    return user;
  });

  logger.info(`User registered: ${result.email}`, {
    requiresApproval,
    isActive: result.is_active,
  });

  const userPayload = {
    id: result.id,
    email: result.email,
    userType: result.user_type,
    isVerified: result.is_verified,
  };

  if (requiresApproval) {
    try {
      const approvalToken = await createSignupApprovalToken({
        userId: result.id,
        email: result.email,
      });
      queueSignupApprovalNotify({
        token: approvalToken,
        userId: result.id,
        email: result.email,
        firstName: String(firstName),
        lastName: String(lastName),
        userType: result.user_type,
      });
    } catch (approvalError) {
      logger.error('Failed to queue signup approval notify', {
        email: result.email,
        error: approvalError instanceof Error ? approvalError.message : String(approvalError),
      });
    }

    return {
      status: 'pendingApproval',
      user: userPayload,
      emailVerificationSent: false,
    };
  }

  const token = generateToken(result.id, result.email, result.user_type);
  const refreshToken = generateRefreshToken(result.id);

  let emailVerificationQueued = false;
  const verifyToken = uuidv4();
  const verifyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  try {
    await authRepository.insertOtpVerification({
      userId: result.id,
      email: result.email,
      otpCodeHash: hashSecret(verifyToken),
      purpose: 'email_verify',
      expiresAt: verifyExpiresAt,
    });
    if (isEmailConfigured()) {
      const verifyUrl = `${getAppPublicUrl()}/verify-email?token=${encodeURIComponent(verifyToken)}`;
      const mail = buildWelcomeVerifyEmail({
        firstName: String(firstName),
        verifyUrl,
      });
      queueEmail({
        to: result.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
      emailVerificationQueued = true;
    }
  } catch (emailError) {
    logger.error('Failed to queue welcome/verify email after register', {
      email: result.email,
      error: emailError instanceof Error ? emailError.message : String(emailError),
    });
  }

  return {
    status: 'success',
    user: userPayload,
    token,
    refreshToken,
    emailVerificationSent: emailVerificationQueued,
  };
};

export const decideSignupApprovalAction = async (
  token: string,
  action: 'approve' | 'reject'
) => {
  return decideSignupApproval(token, action);
};

export interface LoginResult {
  user: {
    id: string;
    email: string;
    userType: string;
    isVerified: boolean;
  };
  token: string;
  refreshToken: string;
}

export const login = async (email: string, password: string): Promise<LoginResult> => {
  if (!email || !password) {
    throw new AppError('Email and password are required', 400);
  }

  const rows = await authRepository.findUserByEmailForLogin(email);

  if (rows.length === 0) {
    throw new AppError('Invalid credentials', 401);
  }

  const user = rows[0];

  if (!user.is_active) {
    throw new AppError('Account is deactivated', 403);
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);

  if (!isPasswordValid) {
    throw new AppError('Invalid credentials', 401);
  }

  await authRepository.updateLastLogin(user.id);

  const token = generateToken(user.id, user.email, user.user_type);
  const refreshToken = generateRefreshToken(user.id);

  logger.info(`User logged in: ${user.email}`);

  return {
    user: {
      id: user.id,
      email: user.email,
      userType: user.user_type,
      isVerified: user.is_verified,
    },
    token,
    refreshToken,
  };
};

export interface LoginWithPhoneResult {
  userId: string;
  otp?: string;
}

export const loginWithPhone = async (phone: string): Promise<LoginWithPhoneResult> => {
  if (!phone) {
    throw new AppError('Phone number is required', 400);
  }

  const rows = await authRepository.findUserByPhone(phone);

  let userId: string;
  if (rows.length === 0) {
    const newUser = await authRepository.insertPhoneUser(phone);
    userId = newUser.id;
  } else {
    userId = rows[0].id;
  }

  const otpCode = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await authRepository.insertOtpVerification({
    userId,
    phone,
    otpCodeHash: hashSecret(otpCode),
    purpose: 'login',
    expiresAt,
  });

  logger.info(`OTP generated for phone ${phone}`);

  return {
    userId,
    ...(process.env.NODE_ENV === 'development' && { otp: otpCode }),
  };
};

export interface VerifyOtpResult {
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    userType: string;
    isVerified: boolean;
  };
  token: string;
  refreshToken: string;
}

export const verifyOTP = async (userId: string, otp: string): Promise<VerifyOtpResult> => {
  if (!userId || !otp) {
    throw new AppError('User ID and OTP are required', 400);
  }

  const otpRows = await authRepository.findValidOtp(userId, hashSecret(otp));

  if (otpRows.length === 0) {
    throw new AppError('Invalid or expired OTP', 401);
  }

  await authRepository.markOtpUsed(otpRows[0].id);

  const userRows = await authRepository.findUserById(userId);
  const user = userRows[0];

  await authRepository.verifyUserAndUpdateLogin(userId);

  const token = generateToken(user.id, user.email || user.phone, user.user_type);
  const refreshToken = generateRefreshToken(user.id);

  return {
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      userType: user.user_type,
      isVerified: true,
    },
    token,
    refreshToken,
  };
};

export interface RefreshTokenResult {
  token: string;
  refreshToken: string;
}

export const refreshToken = async (refreshTokenValue: string): Promise<RefreshTokenResult> => {
  if (!refreshTokenValue) {
    throw new AppError('Refresh token is required', 400);
  }

  const decoded = jwt.verify(refreshTokenValue, process.env.JWT_REFRESH_SECRET!) as { id: string };

  const rows = await authRepository.findActiveUserById(decoded.id);

  if (rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  const user = rows[0];
  const newToken = generateToken(user.id, user.email, user.user_type);
  const newRefreshToken = generateRefreshToken(user.id);

  return {
    token: newToken,
    refreshToken: newRefreshToken,
  };
};

export const forgotPassword = async (email: string): Promise<{ message: string }> => {
  if (!email) {
    throw new AppError('Email is required', 400);
  }

  const genericMessage = 'If the email exists, a reset link has been sent';
  const rows = await authRepository.findUserIdByEmail(email);

  if (rows.length === 0) {
    return { message: genericMessage };
  }

  const userId = rows[0].id;
  const resetToken = uuidv4();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await authRepository.invalidatePasswordResetOtps(userId);

  await authRepository.insertOtpVerification({
    userId,
    email,
    otpCodeHash: hashSecret(resetToken),
    purpose: 'password_reset',
    expiresAt,
  });

  const resetUrl = `${getAppPublicUrl()}/reset-password?token=${encodeURIComponent(resetToken)}`;
  const mail = buildPasswordResetEmail({ resetUrl });
  queueEmail({
    to: email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });

  logger.info(`Password reset requested for ${email}`);

  return { message: genericMessage };
};

export const verifyEmail = async (token: string): Promise<void> => {
  if (!token || typeof token !== 'string') {
    throw new AppError('Verification token is required', 400);
  }

  const rows = await authRepository.findEmailVerifyOtp(hashSecret(token));

  if (rows.length === 0) {
    throw new AppError('Invalid or expired verification token', 401);
  }

  const { id: verificationId, user_id: userId } = rows[0];

  await authRepository.verifyUser(userId);
  await authRepository.markOtpUsed(verificationId);
  await authRepository.invalidateEmailVerifyOtps(userId);
};

export const resetPassword = async (token: string, newPassword: string): Promise<void> => {
  if (!token || !newPassword) {
    throw new AppError('Token and new password are required', 400);
  }

  const rows = await authRepository.findPasswordResetOtp(hashSecret(token));

  if (rows.length === 0) {
    throw new AppError('Invalid or expired reset token', 401);
  }

  const userId = rows[0].user_id;
  const passwordHash = await bcrypt.hash(newPassword, bcryptRounds);

  await authRepository.updatePasswordHash(userId, passwordHash);
  await authRepository.invalidatePasswordResetOtps(userId);
};

export const changePassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> => {
  if (!currentPassword || !newPassword) {
    throw new AppError('Current and new password are required', 400);
  }

  const rows = await authRepository.findPasswordHashByUserId(userId);

  const isPasswordValid = await bcrypt.compare(currentPassword, rows[0].password_hash);

  if (!isPasswordValid) {
    throw new AppError('Current password is incorrect', 401);
  }

  const passwordHash = await bcrypt.hash(newPassword, bcryptRounds);
  await authRepository.updatePasswordHash(userId, passwordHash);
};
