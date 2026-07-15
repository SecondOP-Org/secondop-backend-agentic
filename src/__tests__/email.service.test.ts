import {
  buildPasswordResetEmail,
  buildWelcomeVerifyEmail,
  isEmailConfigured,
  queueEmail,
  resetEmailTransporterForTests,
  sendEmail,
} from '../services/email.service';

const sendMail = jest.fn();

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(() => ({ sendMail })),
  },
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('email.service', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    resetEmailTransporterForTests();
    process.env = { ...originalEnv };
    delete process.env.SMTP_HOST;
    delete process.env.EMAIL_FROM;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('builds welcome and reset message bodies with safe links', () => {
    const welcome = buildWelcomeVerifyEmail({
      firstName: 'Ada',
      verifyUrl: 'https://app.example/verify-email?token=abc',
    });
    expect(welcome.subject).toMatch(/confirm your email/i);
    expect(welcome.text).toContain('https://app.example/verify-email?token=abc');
    expect(welcome.html).toContain('href="https://app.example/verify-email?token=abc"');

    const reset = buildPasswordResetEmail({
      resetUrl: 'https://app.example/reset-password?token=xyz',
    });
    expect(reset.subject).toMatch(/reset/i);
    expect(reset.text).toContain('https://app.example/reset-password?token=xyz');
  });

  it('skips send when SMTP is not configured', async () => {
    expect(isEmailConfigured()).toBe(false);
    const sent = await sendEmail({
      to: 'a@example.com',
      subject: 'Test',
      text: 'hi',
      html: '<p>hi</p>',
    });
    expect(sent).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends when SMTP is configured', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.EMAIL_FROM = 'noreply@secondop.com';
    process.env.SMTP_USER = 'user';
    process.env.SMTP_PASSWORD = 'pass';
    sendMail.mockResolvedValueOnce({ messageId: '1' });

    const sent = await sendEmail({
      to: 'a@example.com',
      subject: 'Test',
      text: 'hi',
      html: '<p>hi</p>',
    });

    expect(sent).toBe(true);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'noreply@secondop.com',
        to: 'a@example.com',
        subject: 'Test',
      })
    );
  });

  it('queueEmail does not reject the caller when SMTP hangs', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.EMAIL_FROM = 'noreply@secondop.com';
    process.env.SMTP_SEND_TIMEOUT_MS = '20';
    sendMail.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ messageId: 'late' }), 200))
    );

    expect(() =>
      queueEmail({
        to: 'a@example.com',
        subject: 'Test',
        text: 'hi',
        html: '<p>hi</p>',
      })
    ).not.toThrow();

    // Allow the background timeout path to settle.
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
});
