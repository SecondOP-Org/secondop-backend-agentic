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
    });
  }

  return transporter;
};

/** Test helper — resets cached transporter. */
export const resetEmailTransporterForTests = (): void => {
  transporter = null;
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
    await transport.sendMail({
      from: process.env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
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

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const escapeAttr = (value: string): string => escapeHtml(value).replace(/'/g, '&#39;');
