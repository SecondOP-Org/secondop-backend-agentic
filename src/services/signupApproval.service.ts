import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../middleware/errorHandler';
import {
  buildSignupApprovalNotifyEmail,
  buildWelcomeVerifyEmail,
  getApiPublicUrl,
  getAppPublicUrl,
  isEmailConfigured,
  queueEmail,
} from './email.service';
import logger from '../utils/logger';
import * as signupApprovalRepo from '../repositories/signupApproval.repository';

const APPROVAL_PURPOSE = 'signup_approval';
const APPROVAL_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const hashSecret = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex');

/**
 * Production defaults to requiring human approval (by-request beta).
 * Set SIGNUP_REQUIRES_APPROVAL=false to open signup; =true to force the gate in any env.
 */
export const signupRequiresApproval = (): boolean => {
  const raw = process.env.SIGNUP_REQUIRES_APPROVAL?.trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') {
    return true;
  }
  if (raw === 'false' || raw === '0' || raw === 'no') {
    return false;
  }
  return process.env.NODE_ENV === 'production';
};

export const getSignupApprovalNotifyEmail = (): string => {
  const configured = process.env.SIGNUP_APPROVAL_NOTIFY_EMAIL?.trim();
  return configured || 'vinodhpeddi@gmail.com';
};

export const createSignupApprovalToken = async (input: {
  userId: string;
  email: string;
}): Promise<string> => {
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS);
  await signupApprovalRepo.insertSignupApprovalToken({
    userId: input.userId,
    email: input.email,
    tokenHash: hashSecret(token),
    purpose: APPROVAL_PURPOSE,
    expiresAt,
  });
  return token;
};

export const queueSignupApprovalNotify = (input: {
  token: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  userType: string;
}): void => {
  if (!isEmailConfigured()) {
    logger.warn('Signup approval notify skipped: SMTP not configured', {
      userId: input.userId,
      email: input.email,
    });
    return;
  }

  const apiBase = getApiPublicUrl();
  const approveUrl = `${apiBase}/api/v1/auth/signup-approvals/${encodeURIComponent(input.token)}/approve`;
  const rejectUrl = `${apiBase}/api/v1/auth/signup-approvals/${encodeURIComponent(input.token)}/reject`;
  const mail = buildSignupApprovalNotifyEmail({
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    userType: input.userType,
    userId: input.userId,
    approveUrl,
    rejectUrl,
  });

  queueEmail({
    to: getSignupApprovalNotifyEmail(),
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
};

const queueWelcomeVerifyForUser = async (input: {
  userId: string;
  email: string;
  firstName: string;
}): Promise<boolean> => {
  const verifyToken = uuidv4();
  const verifyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await signupApprovalRepo.insertEmailVerifyToken({
    userId: input.userId,
    email: input.email,
    tokenHash: hashSecret(verifyToken),
    expiresAt: verifyExpiresAt,
  });

  if (!isEmailConfigured()) {
    return false;
  }

  const verifyUrl = `${getAppPublicUrl()}/verify-email?token=${encodeURIComponent(verifyToken)}`;
  const mail = buildWelcomeVerifyEmail({
    firstName: input.firstName,
    verifyUrl,
  });
  queueEmail({
    to: input.email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  return true;
};

type ApprovalDecision = 'approve' | 'reject';

const resolveApprovalToken = async (token: string) => {
  const trimmed = token?.trim();
  if (!trimmed) {
    throw new AppError('Approval token is required', 400);
  }

  const row = await signupApprovalRepo.findValidApprovalToken(
    hashSecret(trimmed),
    APPROVAL_PURPOSE
  );

  if (!row) {
    throw new AppError('Approval link is invalid or has expired', 400);
  }

  return row as { id: string; user_id: string; email: string };
};

export const decideSignupApproval = async (
  token: string,
  decision: ApprovalDecision
): Promise<{ email: string; userId: string; welcomeQueued: boolean }> => {
  const row = await resolveApprovalToken(token);

  await signupApprovalRepo.markOtpVerificationUsed(row.id);
  // Invalidate any other outstanding approval tokens for this user.
  await signupApprovalRepo.invalidateRemainingApprovalTokens(row.user_id, APPROVAL_PURPOSE);

  if (decision === 'reject') {
    await signupApprovalRepo.deactivateUser(row.user_id);
    logger.info('Signup rejected', { userId: row.user_id, email: row.email });
    return { email: row.email, userId: row.user_id, welcomeQueued: false };
  }

  const user = await signupApprovalRepo.activateUser(row.user_id);

  if (!user) {
    throw new AppError('User not found', 404);
  }

  let firstName = 'there';
  if (user.user_type === 'patient') {
    firstName = (await signupApprovalRepo.findPatientFirstNameByUserId(user.id as string)) || firstName;
  } else if (user.user_type === 'doctor') {
    firstName = (await signupApprovalRepo.findDoctorFirstNameByUserId(user.id as string)) || firstName;
  } else if (user.user_type === 'organization') {
    firstName =
      (await signupApprovalRepo.findOrganizationContactFirstNameByUserId(user.id as string)) ||
      firstName;
  }

  let welcomeQueued = false;
  try {
    welcomeQueued = await queueWelcomeVerifyForUser({
      userId: user.id as string,
      email: user.email as string,
      firstName: String(firstName),
    });
  } catch (error) {
    logger.error('Failed to queue welcome email after signup approval', {
      userId: user.id,
      email: user.email,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('Signup approved', { userId: user.id, email: user.email, welcomeQueued });
  return { email: user.email as string, userId: user.id as string, welcomeQueued };
};

export const renderSignupApprovalHtml = (
  decision: ApprovalDecision,
  detail: { email: string; welcomeQueued: boolean }
): string => {
  const title = decision === 'approve' ? 'Signup approved' : 'Signup rejected';
  const body =
    decision === 'approve'
      ? `Account <strong>${escapeHtml(detail.email)}</strong> is now active.${
          detail.welcomeQueued
            ? ' A welcome / email-confirmation message was queued to the user.'
            : ' Welcome email was not queued (SMTP may be unconfigured).'
        }`
      : `Account <strong>${escapeHtml(detail.email)}</strong> remains inactive. No welcome email was sent.`;

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><title>${title} — SecondOp</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; color: #1a1a1a;">
  <h1 style="font-size: 1.35rem;">${title}</h1>
  <p>${body}</p>
  <p style="color:#666;font-size:0.9rem;">You can close this tab.</p>
</body>
</html>`;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
