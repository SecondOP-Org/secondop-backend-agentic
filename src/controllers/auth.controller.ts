import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { query, transaction } from '../database/connection';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import {
  buildPasswordResetEmail,
  buildWelcomeVerifyEmail,
  getAppPublicUrl,
  isEmailConfigured,
  queueEmail,
} from '../services/email.service';
import logger from '../utils/logger';
import { normalizeDoctorSpecialty } from '../constants/doctorSpecialties';
import {
  createPendingOrganizationWithOwner,
  markOrganizationInviteAccepted,
  parseOrganizationSignupInput,
  resolveInviteForDoctorRegistration,
} from '../services/organization.service';
import {
  createSignupApprovalToken,
  decideSignupApproval,
  queueSignupApprovalNotify,
  renderSignupApprovalHtml,
  signupRequiresApproval,
} from '../services/signupApproval.service';

// Helper function to generate JWT token
const generateToken = (
  userId: string,
  email: string,
  userType: 'patient' | 'doctor' | 'organization'
) => {
  const expiresIn = (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'];
  return jwt.sign(
    { id: userId, email, type: userType },
    process.env.JWT_SECRET!,
    { expiresIn }
  );
};

// Helper function to generate refresh token
const generateRefreshToken = (userId: string) => {
  const expiresIn = (process.env.JWT_REFRESH_EXPIRES_IN || '30d') as jwt.SignOptions['expiresIn'];
  return jwt.sign(
    { id: userId },
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn }
  );
};

// Helper function to generate OTP
const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const hashSecret = (value: string): string => {
  return crypto.createHash('sha256').update(value).digest('hex');
};

const bcryptRounds = Number.isFinite(Number(process.env.BCRYPT_ROUNDS))
  ? Math.max(12, parseInt(process.env.BCRYPT_ROUNDS as string, 10))
  : 12;

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, phone, password, userType, firstName, lastName } = req.body;

    // Validation
    if (!email || !password || !userType || !firstName || !lastName) {
      throw new AppError('Missing required fields', 400);
    }

    if (!['patient', 'doctor', 'organization'].includes(userType)) {
      throw new AppError('Invalid user type', 400);
    }

    if (
      typeof req.body.inviteToken === 'string' &&
      req.body.inviteToken.trim() &&
      userType !== 'doctor'
    ) {
      throw new AppError('Organization invites can only be accepted by doctor accounts', 400);
    }

    // Check if user already exists
    const existingUser = await query(
      'SELECT id FROM users WHERE email = $1 OR ($2::text IS NOT NULL AND phone = $2)',
      [email, phone || null]
    );

    if (existingUser.rows.length > 0) {
      throw new AppError('User already exists with this email or phone', 409);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, bcryptRounds);
    const requiresApproval = signupRequiresApproval();

    // Create user and profile in transaction
    const result = await transaction(async (client) => {
      // Create user — pending approval keeps is_active false (SEC-199).
      const userResult = await client.query(
        `INSERT INTO users (email, phone, password_hash, user_type, is_verified, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email, user_type, is_verified, is_active, created_at`,
        [email, phone || null, passwordHash, userType, false, !requiresApproval]
      );

      const user = userResult.rows[0];

      // Create patient, doctor, or organization profile
      if (userType === 'patient') {
        await client.query(
          `INSERT INTO patients (user_id, first_name, last_name)
           VALUES ($1, $2, $3)`,
          [user.id, firstName, lastName]
        );
      } else if (userType === 'organization') {
        const orgInput = parseOrganizationSignupInput(req.body as Record<string, unknown>);
        // Contact email on the org must match the account email used to sign in.
        if (orgInput.contactEmail.toLowerCase() !== String(email).toLowerCase()) {
          throw new AppError('Organization contact email must match the account email', 400);
        }
        await createPendingOrganizationWithOwner(client, orgInput, user.id);
      } else {
        // Credential fields for manual verification (SEC-169). New doctors start pending.
        // Invite token (SEC-170) attaches organization_id + member role (stance A: still pending).
        const {
          specialty,
          licenseNumber,
          registrationNumber,
          registrationCouncil,
          country,
          npi,
          inviteToken,
        } = req.body;
        const registrationId =
          typeof registrationNumber === 'string' && registrationNumber.trim()
            ? registrationNumber.trim()
            : typeof licenseNumber === 'string'
              ? licenseNumber.trim()
              : '';
        const council =
          typeof registrationCouncil === 'string' ? registrationCouncil.trim() : '';
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

        await client.query(
          `INSERT INTO doctors (
             user_id, first_name, last_name, specialty, license_number,
             registration_council, country, npi, verification_status, is_verified,
             organization_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', false, $9)`,
          [
            user.id,
            firstName,
            lastName,
            normalizedSpecialty,
            registrationId,
            council,
            jurisdiction,
            npiValue,
            organizationId,
          ]
        );

        if (organizationId && inviteId) {
          await client.query(
            `INSERT INTO organization_members (organization_id, user_id, role)
             VALUES ($1, $2, 'member')
             ON CONFLICT (organization_id, user_id) DO NOTHING`,
            [organizationId, user.id]
          );
          await markOrganizationInviteAccepted(client, inviteId, user.id);
        }
      }

      return user;
    });

    logger.info(`User registered: ${result.email}`, {
      requiresApproval,
      isActive: result.is_active,
    });

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

      res.status(201).json({
        status: 'success',
        message:
          'Registration received. Your account is pending approval — we will email you when it is ready.',
        data: {
          pendingApproval: true,
          user: {
            id: result.id,
            email: result.email,
            userType: result.user_type,
            isVerified: result.is_verified,
          },
          emailVerificationSent: false,
        },
      });
      return;
    }

    // Generate tokens (open signup / non-production)
    const token = generateToken(result.id, result.email, result.user_type);
    const refreshToken = generateRefreshToken(result.id);

    // Persist verify token synchronously; SMTP must not block the HTTP response.
    let emailVerificationQueued = false;
    const verifyToken = uuidv4();
    const verifyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    try {
      await query(
        `INSERT INTO otp_verifications (user_id, email, otp_code, purpose, expires_at)
         VALUES ($1, $2, $3, 'email_verify', $4)`,
        [result.id, result.email, hashSecret(verifyToken), verifyExpiresAt]
      );
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

    res.status(201).json({
      status: 'success',
      message: 'User registered successfully',
      data: {
        pendingApproval: false,
        user: {
          id: result.id,
          email: result.email,
          userType: result.user_type,
          isVerified: result.is_verified,
        },
        token,
        refreshToken,
        emailVerificationSent: emailVerificationQueued,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const approveSignup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.params;
    const result = await decideSignupApproval(String(token || ''), 'approve');
    const acceptsHtml =
      req.method === 'GET' || String(req.headers.accept || '').includes('text/html');
    if (acceptsHtml) {
      res
        .status(200)
        .type('html')
        .send(renderSignupApprovalHtml('approve', result));
      return;
    }
    res.status(200).json({
      status: 'success',
      message: 'Signup approved',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const rejectSignup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.params;
    const result = await decideSignupApproval(String(token || ''), 'reject');
    const acceptsHtml =
      req.method === 'GET' || String(req.headers.accept || '').includes('text/html');
    if (acceptsHtml) {
      res
        .status(200)
        .type('html')
        .send(renderSignupApprovalHtml('reject', result));
      return;
    }
    res.status(200).json({
      status: 'success',
      message: 'Signup rejected',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError('Email and password are required', 400);
    }

    // Find user
    const result = await query(
      'SELECT id, email, password_hash, user_type, is_verified, is_active FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      throw new AppError('Invalid credentials', 401);
    }

    const user = result.rows[0];

    if (!user.is_active) {
      throw new AppError('Account is deactivated', 403);
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      throw new AppError('Invalid credentials', 401);
    }

    // Update last login
    await query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

    // Generate tokens
    const token = generateToken(user.id, user.email, user.user_type);
    const refreshToken = generateRefreshToken(user.id);

    logger.info(`User logged in: ${user.email}`);

    res.json({
      status: 'success',
      data: {
        user: {
          id: user.id,
          email: user.email,
          userType: user.user_type,
          isVerified: user.is_verified,
        },
        token,
        refreshToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const loginWithPhone = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      throw new AppError('Phone number is required', 400);
    }

    // Find or create user
    const result = await query(
      'SELECT id, email, user_type, is_verified FROM users WHERE phone = $1',
      [phone]
    );

    let userId: string;
    if (result.rows.length === 0) {
      // Create new user
      const newUser = await query(
        `INSERT INTO users (phone, user_type, is_verified)
         VALUES ($1, 'patient', false)
         RETURNING id`,
        [phone]
      );
      userId = newUser.rows[0].id;
    } else {
      userId = result.rows[0].id;
    }

    // Generate OTP
    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP
    await query(
      `INSERT INTO otp_verifications (user_id, phone, otp_code, purpose, expires_at)
       VALUES ($1, $2, $3, 'login', $4)`,
      [userId, phone, hashSecret(otpCode), expiresAt]
    );

    // TODO: Send OTP via SMS (Twilio integration)
    logger.info(`OTP generated for phone ${phone}`);

    res.json({
      status: 'success',
      message: 'OTP sent successfully',
      data: {
        userId,
        // In development, return OTP for testing
        ...(process.env.NODE_ENV === 'development' && { otp: otpCode }),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const verifyOTP = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      throw new AppError('User ID and OTP are required', 400);
    }

    // Verify OTP
    const result = await query(
      `SELECT * FROM otp_verifications
       WHERE user_id = $1 AND otp_code = $2 AND is_used = false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [userId, hashSecret(otp)]
    );

    if (result.rows.length === 0) {
      throw new AppError('Invalid or expired OTP', 401);
    }

    // Mark OTP as used
    await query(
      'UPDATE otp_verifications SET is_used = true WHERE id = $1',
      [result.rows[0].id]
    );

    // Get user details
    const userResult = await query(
      'SELECT id, email, phone, user_type, is_verified FROM users WHERE id = $1',
      [userId]
    );

    const user = userResult.rows[0];

    // Update user as verified
    await query(
      'UPDATE users SET is_verified = true, last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [userId]
    );

    // Generate tokens
    const token = generateToken(user.id, user.email || user.phone, user.user_type);
    const refreshToken = generateRefreshToken(user.id);

    res.json({
      status: 'success',
      message: 'OTP verified successfully',
      data: {
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          userType: user.user_type,
          isVerified: true,
        },
        token,
        refreshToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const refreshToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new AppError('Refresh token is required', 400);
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as { id: string };

    const result = await query(
      'SELECT id, email, user_type FROM users WHERE id = $1 AND is_active = true',
      [decoded.id]
    );

    if (result.rows.length === 0) {
      throw new AppError('User not found', 404);
    }

    const user = result.rows[0];
    const newToken = generateToken(user.id, user.email, user.user_type);
    const newRefreshToken = generateRefreshToken(user.id);

    res.json({
      status: 'success',
      data: {
        token: newToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({
      status: 'success',
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new AppError('Email is required', 400);
    }

    const genericMessage = 'If the email exists, a reset link has been sent';
    const result = await query('SELECT id FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      res.json({
        status: 'success',
        message: genericMessage,
      });
      return;
    }

    const userId = result.rows[0].id;
    const resetToken = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await query(
      `UPDATE otp_verifications
       SET is_used = true
       WHERE user_id = $1 AND purpose = 'password_reset' AND is_used = false`,
      [userId]
    );

    await query(
      `INSERT INTO otp_verifications (user_id, email, otp_code, purpose, expires_at)
       VALUES ($1, $2, $3, 'password_reset', $4)`,
      [userId, email, hashSecret(resetToken), expiresAt]
    );

    const resetUrl = `${getAppPublicUrl()}/reset-password?token=${encodeURIComponent(resetToken)}`;
    const mail = buildPasswordResetEmail({ resetUrl });
    queueEmail({
      to: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });

    logger.info(`Password reset requested for ${email}`);

    res.json({
      status: 'success',
      message: genericMessage,
    });
    return;
  } catch (error) {
    next(error);
    return;
  }
};

export const verifyEmail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== 'string') {
      throw new AppError('Verification token is required', 400);
    }

    const result = await query(
      `SELECT id, user_id FROM otp_verifications
       WHERE otp_code = $1 AND purpose = 'email_verify' AND is_used = false AND expires_at > NOW()`,
      [hashSecret(token)]
    );

    if (result.rows.length === 0) {
      throw new AppError('Invalid or expired verification token', 401);
    }

    const { id: verificationId, user_id: userId } = result.rows[0];

    await query('UPDATE users SET is_verified = true WHERE id = $1', [userId]);
    await query('UPDATE otp_verifications SET is_used = true WHERE id = $1', [verificationId]);
    await query(
      `UPDATE otp_verifications
       SET is_used = true
       WHERE user_id = $1 AND purpose = 'email_verify' AND is_used = false`,
      [userId]
    );

    res.json({
      status: 'success',
      message: 'Email verified successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      throw new AppError('Token and new password are required', 400);
    }

    const result = await query(
      `SELECT user_id FROM otp_verifications
       WHERE otp_code = $1 AND purpose = 'password_reset' AND is_used = false AND expires_at > NOW()`,
      [hashSecret(token)]
    );

    if (result.rows.length === 0) {
      throw new AppError('Invalid or expired reset token', 401);
    }

    const userId = result.rows[0].user_id;
    const passwordHash = await bcrypt.hash(newPassword, bcryptRounds);

    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
    await query(
      `UPDATE otp_verifications
       SET is_used = true
       WHERE user_id = $1 AND purpose = 'password_reset' AND is_used = false`,
      [userId]
    );

    res.json({
      status: 'success',
      message: 'Password reset successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw new AppError('Current and new password are required', 400);
    }

    const result = await query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user!.id]
    );

    const isPasswordValid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);

    if (!isPasswordValid) {
      throw new AppError('Current password is incorrect', 401);
    }

    const passwordHash = await bcrypt.hash(newPassword, bcryptRounds);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, req.user!.id]);

    res.json({
      status: 'success',
      message: 'Password changed successfully',
    });
  } catch (error) {
    next(error);
  }
};
