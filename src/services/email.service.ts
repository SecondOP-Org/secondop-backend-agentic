import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import logger from '../utils/logger';

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

let transporter: nodemailer.Transporter<SMTPTransport.SentMessageInfo> | null = null;

/** Keep SMTP attempts short so auth APIs never stall behind mail delivery. */
const SMTP_CONNECTION_TIMEOUT_MS = Number.parseInt(
  process.env.SMTP_CONNECTION_TIMEOUT_MS || '8000',
  10
);
const SMTP_SOCKET_TIMEOUT_MS = Number.parseInt(process.env.SMTP_SOCKET_TIMEOUT_MS || '10000', 10);
const SMTP_SEND_TIMEOUT_MS = Number.parseInt(process.env.SMTP_SEND_TIMEOUT_MS || '12000', 10);

export const isEmailConfigured = (): boolean => {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.EMAIL_FROM?.trim());
};

export const getAppPublicUrl = (): string => {
  const raw =
    process.env.APP_PUBLIC_URL?.trim() ||
    process.env.FRONTEND_URL?.trim() ||
    'http://localhost:8080';
  return raw.replace(/\/$/, '');
};

/** Public API origin for one-click ops links (signup approve/reject). */
export const getApiPublicUrl = (): string => {
  const configured = process.env.API_PUBLIC_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railwayDomain) {
    return `https://${railwayDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  }
  const port = process.env.PORT || '8081';
  return `http://localhost:${port}`;
};

const getTransporter = () => {
  if (!isEmailConfigured()) {
    return null;
  }

  if (!transporter) {
    const port = Number.parseInt(process.env.SMTP_PORT || '587', 10);
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASSWORD;

    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      auth: user ? { user, pass: pass || '' } : undefined,
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    });
  }

  return transporter;
};

/** Test helper — resets cached transporter. */
export const resetEmailTransporterForTests = (): void => {
  transporter = null;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

export const sendEmail = async (input: SendEmailInput): Promise<boolean> => {
  const transport = getTransporter();
  if (!transport) {
    logger.warn('Email skipped: SMTP is not configured', {
      to: input.to,
      subject: input.subject,
    });
    return false;
  }

  try {
    await withTimeout(
      transport.sendMail({
        from: process.env.EMAIL_FROM,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
      SMTP_SEND_TIMEOUT_MS,
      'SMTP sendMail'
    );
    logger.info('Email sent', { to: input.to, subject: input.subject });
    return true;
  } catch (error) {
    logger.error('Email send failed', {
      to: input.to,
      subject: input.subject,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

/**
 * Queue outbound email without blocking the caller.
 * Auth endpoints must return before SMTP completes.
 */
export const queueEmail = (input: SendEmailInput): void => {
  void sendEmail(input).catch((error) => {
    logger.error('Queued email failed', {
      to: input.to,
      subject: input.subject,
      error: error instanceof Error ? error.message : String(error),
    });
  });
};

export const buildWelcomeVerifyEmail = (input: {
  firstName: string;
  verifyUrl: string;
}): { subject: string; text: string; html: string } => {
  const name = input.firstName.trim() || 'there';
  const subject = 'Welcome to SecondOp — confirm your email';
  const text = [
    `Hi ${name},`,
    '',
    'Welcome to SecondOp. Please confirm your email address:',
    input.verifyUrl,
    '',
    'If you did not create this account, you can ignore this message.',
    '',
    '— The SecondOp team',
  ].join('\n');
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Welcome to SecondOp. Please confirm your email address:</p>
    <p><a href="${escapeAttr(input.verifyUrl)}">Confirm email</a></p>
    <p>Or paste this link into your browser:<br/>${escapeHtml(input.verifyUrl)}</p>
    <p>If you did not create this account, you can ignore this message.</p>
    <p>— The SecondOp team</p>
  `.trim();
  return { subject, text, html };
};

export const buildSignupApprovalNotifyEmail = (input: {
  firstName: string;
  lastName: string;
  email: string;
  userType: string;
  userId: string;
  approveUrl: string;
  rejectUrl: string;
}): { subject: string; text: string; html: string } => {
  const name = `${input.firstName.trim()} ${input.lastName.trim()}`.trim() || 'Unknown';
  const subject = `[SecondOp] Approve signup — ${input.userType}: ${input.email}`;
  const text = [
    'A new SecondOp signup is awaiting approval (by-request beta).',
    '',
    `Name: ${name}`,
    `Email: ${input.email}`,
    `Type: ${input.userType}`,
    `User ID: ${input.userId}`,
    '',
    `Approve (activates account + sends welcome email):`,
    input.approveUrl,
    '',
    `Reject (keeps account inactive, no welcome email):`,
    input.rejectUrl,
    '',
    '— SecondOp signup gate',
  ].join('\n');
  const html = `
    <p>A new SecondOp signup is awaiting approval (by-request beta).</p>
    <ul>
      <li><strong>Name:</strong> ${escapeHtml(name)}</li>
      <li><strong>Email:</strong> ${escapeHtml(input.email)}</li>
      <li><strong>Type:</strong> ${escapeHtml(input.userType)}</li>
      <li><strong>User ID:</strong> ${escapeHtml(input.userId)}</li>
    </ul>
    <p>
      <a href="${escapeAttr(input.approveUrl)}" style="display:inline-block;padding:10px 16px;background:#2563FF;color:#fff;text-decoration:none;border-radius:6px;">
        Approve signup
      </a>
    </p>
    <p style="font-size:0.9rem;">
      Or <a href="${escapeAttr(input.rejectUrl)}">reject</a> (keeps account inactive; no welcome email).
    </p>
    <p style="color:#666;font-size:0.85rem;">Approve activates the account and queues the welcome / email-confirmation message to the user.</p>
  `.trim();
  return { subject, text, html };
};

export const buildPasswordResetEmail = (input: {
  resetUrl: string;
}): { subject: string; text: string; html: string } => {
  const subject = 'Reset your SecondOp password';
  const text = [
    'We received a request to reset your SecondOp password.',
    '',
    'Use this link within the next hour:',
    input.resetUrl,
    '',
    'If you did not request a reset, you can ignore this message.',
    '',
    '— The SecondOp team',
  ].join('\n');
  const html = `
    <p>We received a request to reset your SecondOp password.</p>
    <p><a href="${escapeAttr(input.resetUrl)}">Reset password</a></p>
    <p>This link expires in one hour.</p>
    <p>Or paste this link into your browser:<br/>${escapeHtml(input.resetUrl)}</p>
    <p>If you did not request a reset, you can ignore this message.</p>
    <p>— The SecondOp team</p>
  `.trim();
  return { subject, text, html };
};

export const buildOrganizationInviteEmail = (input: {
  organizationName: string;
  inviteUrl: string;
}): { subject: string; text: string; html: string } => {
  const org = input.organizationName.trim() || 'a SecondOp partner organization';
  const subject = `You're invited to join ${org} on SecondOp`;
  const text = [
    `You have been invited to join ${org} as a specialist on SecondOp.`,
    '',
    'Accept the invitation and complete your credential profile:',
    input.inviteUrl,
    '',
    'This link expires in 7 days. Credential verification is still required before you can review cases.',
    '',
    'If you were not expecting this invite, you can ignore this message.',
    '',
    '— The SecondOp team',
  ].join('\n');
  const html = `
    <p>You have been invited to join <strong>${escapeHtml(org)}</strong> as a specialist on SecondOp.</p>
    <p><a href="${escapeAttr(input.inviteUrl)}">Accept invitation</a></p>
    <p>This link expires in 7 days. Credential verification is still required before you can review cases.</p>
    <p>Or paste this link into your browser:<br/>${escapeHtml(input.inviteUrl)}</p>
    <p>If you were not expecting this invite, you can ignore this message.</p>
    <p>— The SecondOp team</p>
  `.trim();
  return { subject, text, html };
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const escapeAttr = (value: string): string => escapeHtml(value).replace(/'/g, '&#39;');
