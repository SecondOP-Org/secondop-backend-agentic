import { QueryResultRow } from 'pg';
import { dbQuery } from './db';

export interface FindDoctorsFilters {
  specialty?: string;
  country?: string;
  minRating?: string;
}

export const findDoctors = async (filters: FindDoctorsFilters): Promise<QueryResultRow[]> => {
  let queryStr = `SELECT d.*, u.email, u.phone 
                  FROM doctors d 
                  JOIN users u ON d.user_id = u.id 
                  WHERE d.verification_status = 'verified'
                    AND d.is_verified = true
                    AND d.is_available = true`;
  const params: unknown[] = [];

  if (filters.specialty) {
    params.push(filters.specialty);
    queryStr += ` AND d.specialty = $${params.length}`;
  }

  if (filters.country) {
    params.push(filters.country);
    queryStr += ` AND d.country = $${params.length}`;
  }

  if (filters.minRating) {
    params.push(filters.minRating);
    queryStr += ` AND d.rating >= $${params.length}`;
  }

  queryStr += ' ORDER BY d.rating DESC, d.review_count DESC';

  const result = await dbQuery(queryStr, params);
  return result.rows;
};

export const findDoctorById = async (doctorId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT d.*, u.email, u.phone, u.is_verified as user_verified
     FROM doctors d
     JOIN users u ON d.user_id = u.id
     WHERE d.id = $1`,
    [doctorId]
  );
  return result.rows;
};

export const searchDoctors = async (searchQuery: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT d.*, u.email 
     FROM doctors d
     JOIN users u ON d.user_id = u.id
     WHERE d.verification_status = 'verified'
     AND d.is_verified = true
     AND (
       d.first_name ILIKE $1 OR 
       d.last_name ILIKE $1 OR 
       d.specialty ILIKE $1 OR 
       d.bio ILIKE $1
     )
     ORDER BY d.rating DESC
     LIMIT 20`,
    [`%${searchQuery}%`]
  );
  return result.rows;
};

const DOCTOR_SIGN_ELIGIBILITY_SELECT = `
  SELECT d.id,
         d.verification_status,
         d.organization_id,
         o.verification_status AS organization_verification_status
  FROM doctors d
  LEFT JOIN organizations o ON o.id = d.organization_id
`;

export const findDoctorSignEligibilityByUserId = async (userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `${DOCTOR_SIGN_ELIGIBILITY_SELECT}
     WHERE d.user_id = $1
     LIMIT 1`,
    [userId]
  );
  return result.rows;
};

export const findDoctorSignEligibilityByDoctorId = async (doctorId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `${DOCTOR_SIGN_ELIGIBILITY_SELECT}
     WHERE d.id = $1
     LIMIT 1`,
    [doctorId]
  );
  return result.rows;
};

export const findDoctorsForVerification = async (status?: string): Promise<QueryResultRow[]> => {
  const params: string[] = [];
  let where = '';
  if (status) {
    params.push(status);
    where = `WHERE d.verification_status = $1`;
  }

  const result = await dbQuery(
    `SELECT d.id, d.user_id, d.first_name, d.last_name, d.specialty,
            d.license_number, d.registration_council, d.country, d.npi,
            d.organization_id, d.verification_status, d.verification_reason,
            d.verified_at, d.verified_by, d.created_at, u.email,
            o.verification_status AS organization_verification_status,
            o.name AS organization_name
     FROM doctors d
     JOIN users u ON u.id = d.user_id
     LEFT JOIN organizations o ON o.id = d.organization_id
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

export const findDoctorVerificationStatusById = async (doctorId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT id, verification_status
     FROM doctors
     WHERE id = $1
     LIMIT 1`,
    [doctorId]
  );
  return result.rows;
};

export const updateDoctorVerificationStatus = async (input: {
  toStatus: 'verified' | 'rejected';
  reason: string | null;
  actorUserId: string;
  isVerifiedFlag: boolean;
  doctorId: string;
}): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `UPDATE doctors
     SET verification_status = $1,
         verification_reason = $2,
         verified_at = CASE WHEN $1 = 'verified' THEN CURRENT_TIMESTAMP ELSE verified_at END,
         verified_by = $3,
         is_verified = $4,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $5
     RETURNING id, user_id, first_name, last_name, specialty, license_number,
               registration_council, country, npi, organization_id, verification_status,
               verification_reason, verified_at, verified_by, is_verified`,
    [input.toStatus, input.reason, input.actorUserId, input.isVerifiedFlag, input.doctorId]
  );
  return result.rows;
};

export const insertDoctorVerificationEvent = async (input: {
  doctorId: string;
  actorUserId: string;
  fromStatus: string;
  toStatus: string;
  reason: string | null;
}): Promise<void> => {
  await dbQuery(
    `INSERT INTO doctor_verification_events (doctor_id, actor_user_id, from_status, to_status, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.doctorId, input.actorUserId, input.fromStatus, input.toStatus, input.reason]
  );
};
