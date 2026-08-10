import { PoolClient, QueryResultRow } from 'pg';
import { dbQuery } from './db';

export const findExistingUserByEmailOrPhone = async (
  email: string,
  phone: string | null
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    'SELECT id FROM users WHERE email = $1 OR ($2::text IS NOT NULL AND phone = $2)',
    [email, phone]
  );
  return result.rows;
};

export interface InsertUserInput {
  email: string;
  phone: string | null;
  passwordHash: string;
  userType: string;
  isVerified: boolean;
  isActive: boolean;
}

export const insertUser = async (
  input: InsertUserInput,
  client?: PoolClient
): Promise<QueryResultRow> => {
  const result = await dbQuery(
    `INSERT INTO users (email, phone, password_hash, user_type, is_verified, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, email, user_type, is_verified, is_active, created_at`,
    [input.email, input.phone, input.passwordHash, input.userType, input.isVerified, input.isActive],
    client
  );
  return result.rows[0];
};

export const insertPatient = async (
  userId: string,
  firstName: string,
  lastName: string,
  client?: PoolClient
): Promise<void> => {
  await dbQuery(
    `INSERT INTO patients (user_id, first_name, last_name)
     VALUES ($1, $2, $3)`,
    [userId, firstName, lastName],
    client
  );
};

export interface InsertDoctorInput {
  userId: string;
  firstName: string;
  lastName: string;
  specialty: string;
  registrationId: string;
  council: string;
  jurisdiction: string;
  npiValue: string | null;
  organizationId: string | null;
}

export const insertDoctor = async (input: InsertDoctorInput, client?: PoolClient): Promise<void> => {
  await dbQuery(
    `INSERT INTO doctors (
       user_id, first_name, last_name, specialty, license_number,
       registration_council, country, npi, verification_status, is_verified,
       organization_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', false, $9)`,
    [
      input.userId,
      input.firstName,
      input.lastName,
      input.specialty,
      input.registrationId,
      input.council,
      input.jurisdiction,
      input.npiValue,
      input.organizationId,
    ],
    client
  );
};

export const insertOrganizationMember = async (
  organizationId: string,
  userId: string,
  client?: PoolClient
): Promise<void> => {
  await dbQuery(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, 'member')
     ON CONFLICT (organization_id, user_id) DO NOTHING`,
    [organizationId, userId],
    client
  );
};

export interface InsertOtpVerificationInput {
  userId: string;
  email?: string;
  phone?: string;
  otpCodeHash: string;
  purpose: string;
  expiresAt: Date;
}

export const insertOtpVerification = async (input: InsertOtpVerificationInput): Promise<void> => {
  if (input.phone !== undefined) {
    await dbQuery(
      `INSERT INTO otp_verifications (user_id, phone, otp_code, purpose, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.userId, input.phone, input.otpCodeHash, input.purpose, input.expiresAt]
    );
  } else {
    await dbQuery(
      `INSERT INTO otp_verifications (user_id, email, otp_code, purpose, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.userId, input.email, input.otpCodeHash, input.purpose, input.expiresAt]
    );
  }
};

export const findUserByEmailForLogin = async (email: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    'SELECT id, email, password_hash, user_type, is_verified, is_active FROM users WHERE email = $1',
    [email]
  );
  return result.rows;
};

export const updateLastLogin = async (userId: string): Promise<void> => {
  await dbQuery('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [userId]);
};

export const findUserByPhone = async (phone: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    'SELECT id, email, user_type, is_verified FROM users WHERE phone = $1',
    [phone]
  );
  return result.rows;
};

export const insertPhoneUser = async (phone: string): Promise<QueryResultRow> => {
  const result = await dbQuery(
    `INSERT INTO users (phone, user_type, is_verified)
     VALUES ($1, 'patient', false)
     RETURNING id`,
    [phone]
  );
  return result.rows[0];
};

export const findValidOtp = async (userId: string, otpCodeHash: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT * FROM otp_verifications
     WHERE user_id = $1 AND otp_code = $2 AND is_used = false AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [userId, otpCodeHash]
  );
  return result.rows;
};

export const markOtpUsed = async (otpId: string): Promise<void> => {
  await dbQuery('UPDATE otp_verifications SET is_used = true WHERE id = $1', [otpId]);
};

export const findUserById = async (userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    'SELECT id, email, phone, user_type, is_verified FROM users WHERE id = $1',
    [userId]
  );
  return result.rows;
};

export const verifyUserAndUpdateLogin = async (userId: string): Promise<void> => {
  await dbQuery(
    'UPDATE users SET is_verified = true, last_login = CURRENT_TIMESTAMP WHERE id = $1',
    [userId]
  );
};

export const findActiveUserById = async (userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    'SELECT id, email, user_type FROM users WHERE id = $1 AND is_active = true',
    [userId]
  );
  return result.rows;
};

export const findUserIdByEmail = async (email: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery('SELECT id FROM users WHERE email = $1', [email]);
  return result.rows;
};

export const invalidatePasswordResetOtps = async (userId: string): Promise<void> => {
  await dbQuery(
    `UPDATE otp_verifications
     SET is_used = true
     WHERE user_id = $1 AND purpose = 'password_reset' AND is_used = false`,
    [userId]
  );
};

export const findEmailVerifyOtp = async (tokenHash: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT id, user_id FROM otp_verifications
     WHERE otp_code = $1 AND purpose = 'email_verify' AND is_used = false AND expires_at > NOW()`,
    [tokenHash]
  );
  return result.rows;
};

export const verifyUser = async (userId: string): Promise<void> => {
  await dbQuery('UPDATE users SET is_verified = true WHERE id = $1', [userId]);
};

export const invalidateEmailVerifyOtps = async (userId: string): Promise<void> => {
  await dbQuery(
    `UPDATE otp_verifications
     SET is_used = true
     WHERE user_id = $1 AND purpose = 'email_verify' AND is_used = false`,
    [userId]
  );
};

export const findPasswordResetOtp = async (tokenHash: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT user_id FROM otp_verifications
     WHERE otp_code = $1 AND purpose = 'password_reset' AND is_used = false AND expires_at > NOW()`,
    [tokenHash]
  );
  return result.rows;
};

export const updatePasswordHash = async (userId: string, passwordHash: string): Promise<void> => {
  await dbQuery('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
};

export const findPasswordHashByUserId = async (userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery('SELECT password_hash FROM users WHERE id = $1', [userId]);
  return result.rows;
};
