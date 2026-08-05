import {
  buildSignupApprovalNotifyEmail,
  buildWelcomeVerifyEmail,
  getApiPublicUrl,
} from '../services/email.service';
import {
  getSignupApprovalNotifyEmail,
  signupRequiresApproval,
} from '../services/signupApproval.service';

describe('signup approval gate (SEC-199)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to requiring approval in production', () => {
    delete process.env.SIGNUP_REQUIRES_APPROVAL;
    process.env.NODE_ENV = 'production';
    expect(signupRequiresApproval()).toBe(true);
  });

  it('defaults to open signup outside production', () => {
    delete process.env.SIGNUP_REQUIRES_APPROVAL;
    process.env.NODE_ENV = 'development';
    expect(signupRequiresApproval()).toBe(false);
  });

  it('honors explicit SIGNUP_REQUIRES_APPROVAL overrides', () => {
    process.env.NODE_ENV = 'development';
    process.env.SIGNUP_REQUIRES_APPROVAL = 'true';
    expect(signupRequiresApproval()).toBe(true);

    process.env.NODE_ENV = 'production';
    process.env.SIGNUP_REQUIRES_APPROVAL = 'false';
    expect(signupRequiresApproval()).toBe(false);
  });

  it('defaults ops notify email to Vinodh', () => {
    delete process.env.SIGNUP_APPROVAL_NOTIFY_EMAIL;
    expect(getSignupApprovalNotifyEmail()).toBe('vinodhpeddi@gmail.com');
  });

  it('builds ops notify mail with approve/reject links', () => {
    const mail = buildSignupApprovalNotifyEmail({
      firstName: 'Pat',
      lastName: 'Patient',
      email: 'pat@example.com',
      userType: 'patient',
      userId: 'user-1',
      approveUrl: 'https://api.example/approve',
      rejectUrl: 'https://api.example/reject',
    });
    expect(mail.subject).toContain('pat@example.com');
    expect(mail.text).toContain('https://api.example/approve');
    expect(mail.html).toContain('Approve signup');
  });

  it('keeps welcome email copy for post-approval send', () => {
    const mail = buildWelcomeVerifyEmail({
      firstName: 'Pat',
      verifyUrl: 'https://app.example/verify-email?token=abc',
    });
    expect(mail.subject).toMatch(/Welcome to SecondOp/i);
    expect(mail.text).toContain('https://app.example/verify-email?token=abc');
  });

  it('resolves API public URL for one-click links', () => {
    process.env.API_PUBLIC_URL = 'https://secondop-backend-production.up.railway.app/';
    expect(getApiPublicUrl()).toBe('https://secondop-backend-production.up.railway.app');
  });
});
