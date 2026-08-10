import { QueryResultRow } from 'pg';
import { dbQuery } from './db';

export const findPracticeForDoctorUser = async (doctorUserId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT p.id, p.name, p.slug
     FROM practices p
     JOIN practice_members pm ON pm.practice_id = p.id
     JOIN doctors d ON d.id = pm.doctor_id
     WHERE d.user_id = $1
       AND pm.is_active = TRUE
     LIMIT 1`,
    [doctorUserId]
  );
  return result.rows;
};

export const findPracticeMembers = async (practiceId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT d.id AS doctor_id,
            d.first_name,
            d.last_name,
            d.specialty,
            pm.role
     FROM practice_members pm
     JOIN doctors d ON d.id = pm.doctor_id
     WHERE pm.practice_id = $1
       AND pm.is_active = TRUE
     ORDER BY
       CASE pm.role
         WHEN 'coordinator' THEN 0
         WHEN 'attending' THEN 1
         ELSE 2
       END,
       d.last_name,
       d.first_name`,
    [practiceId]
  );
  return result.rows;
};

export const findActivePracticeMembership = async (
  doctorUserId: string,
  practiceId: string
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT pm.id
     FROM practice_members pm
     JOIN doctors d ON d.id = pm.doctor_id
     WHERE d.user_id = $1
       AND pm.practice_id = $2
       AND pm.is_active = TRUE
     LIMIT 1`,
    [doctorUserId, practiceId]
  );
  return result.rows;
};
