import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../database/connection';
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
  await query(
    `INSERT INTO otp_verifications (user_id, email, otp_code, purpose, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.userId, input.email, hashSecret(token), APPROVAL_PURPOSE, expiresAt]
  );
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
  await query(
    `INSERT INTO otp_verifications (user_id, email, otp_code, purpose, expires_at)
     VALUES ($1, $2, $3, 'email_verify', $4)`,
    [input.userId, input.email, hashSecret(verifyToken), verifyExpiresAt]
  );

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

  const result = await query(
    `SELECT id, user_id, email
     FROM otp_verifications
     WHERE otp_code = $1
       AND purpose = $2
       AND is_used = false
       AND expires_at > CURRENT_TIMESTAMP`,
    [hashSecret(trimmed), APPROVAL_PURPOSE]
  );

  if (result.rows.length === 0) {
    throw new AppError('Approval link is invalid or has expired', 400);
  }

  return result.rows[0] as { id: string; user_id: string; email: string };
};

export const decideSignupApproval = async (
  token: string,
  decision: ApprovalDecision
): Promise<{ email: string; userId: string; welcomeQueued: boolean }> => {
  const row = await resolveApprovalToken(token);

  await query('UPDATE otp_verifications SET is_used = true WHERE id = $1', [row.id]);
  // Invalidate any other outstanding approval tokens for this user.
  await query(
    `UPDATE otp_verifications
     SET is_used = true
     WHERE user_id = $1
       AND purpose = $2
       AND is_used = false`,
    [row.user_id, APPROVAL_PURPOSE]
  );

  if (decision === 'reject') {
    await query(
      `UPDATE users
       SET is_active = false,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [row.user_id]
    );
    logger.info('Signup rejected', { userId: row.user_id, email: row.email });
    return { email: row.email, userId: row.user_id, welcomeQueued: false };
  }

  const userResult = await query(
    `UPDATE users
     SET is_active = true,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING id, email, user_type`,
    [row.user_id]
  );

  if (userResult.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  const user = userResult.rows[0] as { id: string; email: string; user_type: string };
  let firstName = 'there';
  if (user.user_type === 'patient') {
    const profile = await query(`SELECT first_name FROM patients WHERE user_id = $1`, [user.id]);
    firstName = profile.rows[0]?.first_name || firstName;
  } else if (user.user_type === 'doctor') {
    const profile = await query(`SELECT first_name FROM doctors WHERE user_id = $1`, [user.id]);
    firstName = profile.rows[0]?.first_name || firstName;
  } else if (user.user_type === 'organization') {
    const profile = await query(
      `SELECT contact_first_name AS first_name
       FROM organizations
       WHERE id = (
         SELECT organization_id FROM organization_members WHERE user_id = $1 LIMIT 1
       )`,
      [user.id]
    );
    firstName = profile.rows[0]?.first_name || firstName;
  }

  let welcomeQueued = false;
  try {
    welcomeQueued = await queueWelcomeVerifyForUser({
      userId: user.id,
      email: user.email,
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
  return { email: user.email, userId: user.id, welcomeQueued };
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
