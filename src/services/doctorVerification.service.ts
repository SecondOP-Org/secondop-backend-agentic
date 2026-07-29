import { query } from '../database/connection';
import { AppError } from '../middleware/errorHandler';

export type DoctorVerificationStatus = 'pending' | 'verified' | 'rejected';

export const DOCTOR_NOT_CREDENTIAL_VERIFIED_MESSAGE =
  'Doctor account is not credential-verified. Cases cannot be assigned and opinions cannot be signed until verification is complete.';

type DoctorVerificationRow = {
  id: string;
  verification_status: DoctorVerificationStatus;
};

export const isCredentialVerified = (status: string | null | undefined): boolean => {
  return status === 'verified';
};

/** Load doctor by user id and refuse when not credential-verified. */
export const ensureDoctorCredentialVerifiedByUserId = async (userId: string): Promise<void> => {
  const result = await query(
    `SELECT id, verification_status
     FROM doctors
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Doctor profile not found', 404);
  }

  const row = result.rows[0] as DoctorVerificationRow;
  if (!isCredentialVerified(row.verification_status)) {
    throw new AppError(DOCTOR_NOT_CREDENTIAL_VERIFIED_MESSAGE, 403);
  }
};

/** Load doctor by doctors.id and refuse when not credential-verified. */
export const ensureDoctorCredentialVerifiedByDoctorId = async (doctorId: string): Promise<void> => {
  const result = await query(
    `SELECT id, verification_status
     FROM doctors
     WHERE id = $1
     LIMIT 1`,
    [doctorId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Doctor not found', 404);
  }

  const row = result.rows[0] as DoctorVerificationRow;
  if (!isCredentialVerified(row.verification_status)) {
    throw new AppError(DOCTOR_NOT_CREDENTIAL_VERIFIED_MESSAGE, 403);
  }
};

export const listDoctorsForVerification = async (status?: DoctorVerificationStatus) => {
  const params: string[] = [];
  let where = '';
  if (status) {
    params.push(status);
    where = `WHERE d.verification_status = $1`;
  }

  const result = await query(
    `SELECT d.id, d.user_id, d.first_name, d.last_name, d.specialty,
            d.license_number, d.registration_council, d.country, d.npi,
            d.verification_status, d.verification_reason, d.verified_at, d.verified_by,
            d.created_at, u.email
     FROM doctors d
     JOIN users u ON u.id = d.user_id
     ${where}
     ORDER BY
       CASE d.verification_status
         WHEN 'pending' THEN 0
         WHEN 'rejected' THEN 1
         ELSE 2
       END,
       d.created_at ASC`,
    params
  );

  return result.rows;
};

export const setDoctorVerificationStatus = async (input: {
  doctorId: string;
  toStatus: 'verified' | 'rejected';
  actorUserId: string;
  reason?: string | null;
}) => {
  const { doctorId, toStatus, actorUserId } = input;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';

  if (toStatus === 'rejected' && !reason) {
    throw new AppError('A reason is required when rejecting a doctor', 400);
  }

  const existing = await query(
    `SELECT id, verification_status
     FROM doctors
     WHERE id = $1
     LIMIT 1`,
    [doctorId]
  );

  if (existing.rows.length === 0) {
    throw new AppError('Doctor not found', 404);
  }

  const fromStatus = (existing.rows[0] as DoctorVerificationRow).verification_status;
  const isVerifiedFlag = toStatus === 'verified';

  const updated = await query(
    `UPDATE doctors
     SET verification_status = $1,
         verification_reason = $2,
         verified_at = CASE WHEN $1 = 'verified' THEN CURRENT_TIMESTAMP ELSE verified_at END,
         verified_by = $3,
         is_verified = $4,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $5
     RETURNING id, user_id, first_name, last_name, specialty, license_number,
               registration_council, country, npi, verification_status, verification_reason,
               verified_at, verified_by, is_verified`,
    [toStatus, reason || null, actorUserId, isVerifiedFlag, doctorId]
  );

  await query(
    `INSERT INTO doctor_verification_events (doctor_id, actor_user_id, from_status, to_status, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [doctorId, actorUserId, fromStatus, toStatus, reason || null]
  );

  return updated.rows[0];
};
