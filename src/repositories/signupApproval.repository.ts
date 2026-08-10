import { QueryResultRow } from 'pg';
import { dbQuery } from './db';

export const insertSignupApprovalToken = async (input: {
  userId: string;
  email: string;
  tokenHash: string;
  purpose: string;
  expiresAt: Date;
}): Promise<void> => {
  await dbQuery(
    `INSERT INTO otp_verifications (user_id, email, otp_code, purpose, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.userId, input.email, input.tokenHash, input.purpose, input.expiresAt]
  );
};

export const insertEmailVerifyToken = async (input: {
  userId: string;
  email: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> => {
  await dbQuery(
    `INSERT INTO otp_verifications (user_id, email, otp_code, purpose, expires_at)
     VALUES ($1, $2, $3, 'email_verify', $4)`,
    [input.userId, input.email, input.tokenHash, input.expiresAt]
  );
};

export const findValidApprovalToken = async (
  tokenHash: string,
  purpose: string
): Promise<QueryResultRow | null> => {
  const result = await dbQuery(
    `SELECT id, user_id, email
     FROM otp_verifications
     WHERE otp_code = $1
       AND purpose = $2
       AND is_used = false
       AND expires_at > CURRENT_TIMESTAMP`,
    [tokenHash, purpose]
  );
  return result.rows[0] ?? null;
};

export const markOtpVerificationUsed = async (otpId: string): Promise<void> => {
  await dbQuery('UPDATE otp_verifications SET is_used = true WHERE id = $1', [otpId]);
};

export const invalidateRemainingApprovalTokens = async (
  userId: string,
  purpose: string
): Promise<void> => {
  await dbQuery(
    `UPDATE otp_verifications
     SET is_used = true
     WHERE user_id = $1
       AND purpose = $2
       AND is_used = false`,
    [userId, purpose]
  );
};

export const deactivateUser = async (userId: string): Promise<void> => {
  await dbQuery(
    `UPDATE users
     SET is_active = false,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [userId]
  );
};

export const activateUser = async (userId: string): Promise<QueryResultRow | null> => {
  const userResult = await dbQuery(
    `UPDATE users
     SET is_active = true,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING id, email, user_type`,
    [userId]
  );
  return userResult.rows[0] ?? null;
};

export const findPatientFirstNameByUserId = async (userId: string): Promise<string | null> => {
  const profile = await dbQuery(`SELECT first_name FROM patients WHERE user_id = $1`, [userId]);
  return profile.rows[0]?.first_name ?? null;
};

export const findDoctorFirstNameByUserId = async (userId: string): Promise<string | null> => {
  const profile = await dbQuery(`SELECT first_name FROM doctors WHERE user_id = $1`, [userId]);
  return profile.rows[0]?.first_name ?? null;
};

export const findOrganizationContactFirstNameByUserId = async (
  userId: string
): Promise<string | null> => {
  const profile = await dbQuery(
    `SELECT contact_first_name AS first_name
     FROM organizations
     WHERE id = (
       SELECT organization_id FROM organization_members WHERE user_id = $1 LIMIT 1
     )`,
    [userId]
  );
  return profile.rows[0]?.first_name ?? null;
};
