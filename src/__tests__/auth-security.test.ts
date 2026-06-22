import bcrypt from 'bcryptjs';
import { resetPassword } from '../controllers/auth.controller';
import { query } from '../database/connection';

jest.mock('../database/connection', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockHash = bcrypt.hash as jest.MockedFunction<typeof bcrypt.hash>;

describe('auth security hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('invalidates all outstanding password reset tokens for a user after reset', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-123' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockHash.mockResolvedValueOnce('new-password-hash' as never);

    const req = {
      body: {
        token: 'valid-reset-token',
        newPassword: 'new-secure-password',
      },
    };
    const res = {
      json: jest.fn(),
    };
    const next = jest.fn();

    await resetPassword(req as never, res as never, next);

    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      ['new-password-hash', 'user-123']
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('WHERE user_id = $1 AND purpose = \'password_reset\' AND is_used = false'),
      ['user-123']
    );
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      message: 'Password reset successfully',
    });
    expect(next).not.toHaveBeenCalled();
  });
});
