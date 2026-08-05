import { Request, Response } from 'express';
import { register, approveSignup } from '../controllers/auth.controller';
import { query, transaction } from '../database/connection';
import * as emailService from '../services/email.service';
import * as signupApproval from '../services/signupApproval.service';

jest.mock('../database/connection', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../services/email.service', () => ({
  buildWelcomeVerifyEmail: jest.fn(() => ({
    subject: 'Welcome',
    text: 'welcome',
    html: '<p>welcome</p>',
  })),
  buildPasswordResetEmail: jest.fn(),
  getAppPublicUrl: jest.fn(() => 'https://app.example'),
  getApiPublicUrl: jest.fn(() => 'https://api.example'),
  isEmailConfigured: jest.fn(() => true),
  queueEmail: jest.fn(),
}));

jest.mock('../services/organization.service', () => ({
  createPendingOrganizationWithOwner: jest.fn(),
  markOrganizationInviteAccepted: jest.fn(),
  parseOrganizationSignupInput: jest.fn(),
  resolveInviteForDoctorRegistration: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn(async () => 'hashed'),
  compare: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedTransaction = transaction as jest.MockedFunction<typeof transaction>;
const mockedQueueEmail = emailService.queueEmail as jest.MockedFunction<typeof emailService.queueEmail>;

describe('register signup approval gate (SEC-199)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, NODE_ENV: 'production', JWT_SECRET: 'test', JWT_REFRESH_SECRET: 'test' };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('creates pending account without tokens or welcome email when gate is on', async () => {
    process.env.SIGNUP_REQUIRES_APPROVAL = 'true';

    // existing-user check
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

    mockedTransaction.mockImplementation(async (fn: any) => {
      const client = {
        query: jest
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'user-1',
                email: 'new@example.com',
                user_type: 'patient',
                is_verified: false,
                is_active: false,
              },
            ],
          })
          .mockResolvedValueOnce({ rows: [] }),
      };
      return fn(client);
    });

    const createSpy = jest
      .spyOn(signupApproval, 'createSignupApprovalToken')
      .mockResolvedValue('tok-1');
    const notifySpy = jest
      .spyOn(signupApproval, 'queueSignupApprovalNotify')
      .mockImplementation(() => undefined);

    const req = {
      body: {
        email: 'new@example.com',
        password: 'password123',
        userType: 'patient',
        firstName: 'New',
        lastName: 'User',
      },
    } as Partial<Request>;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;
    const next = jest.fn();

    await register(req as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pendingApproval: true,
          emailVerificationSent: false,
        }),
      })
    );
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.data.token).toBeUndefined();
    expect(mockedQueueEmail).not.toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalled();
    expect(notifySpy).toHaveBeenCalled();
  });

  it('approveSignup returns HTML for GET clicks', async () => {
    jest.spyOn(signupApproval, 'decideSignupApproval').mockResolvedValue({
      email: 'new@example.com',
      userId: 'user-1',
      welcomeQueued: true,
    });

    const req = {
      params: { token: 'tok-1' },
      method: 'GET',
      headers: { accept: 'text/html' },
    } as Partial<Request>;
    const res = {
      status: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      send: jest.fn(),
      json: jest.fn(),
    } as unknown as Response;
    const next = jest.fn();

    await approveSignup(req as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.type).toHaveBeenCalledWith('html');
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Signup approved'));
  });
});
