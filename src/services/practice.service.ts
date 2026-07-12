import { query } from '../database/connection';
import { AppError } from '../middleware/errorHandler';

export type PracticeMemberRole = 'coordinator' | 'clinician' | 'attending';

export interface PracticeMemberRecord {
  doctorId: string;
  firstName: string;
  lastName: string;
  specialty: string;
  role: PracticeMemberRole;
}

export interface PracticeRecord {
  id: string;
  name: string;
  slug: string;
  members: PracticeMemberRecord[];
}

export const getPracticeForDoctorUser = async (doctorUserId: string): Promise<PracticeRecord | null> => {
  const practiceResult = await query(
    `SELECT p.id, p.name, p.slug
     FROM practices p
     JOIN practice_members pm ON pm.practice_id = p.id
     JOIN doctors d ON d.id = pm.doctor_id
     WHERE d.user_id = $1
       AND pm.is_active = TRUE
     LIMIT 1`,
    [doctorUserId]
  );

  if (practiceResult.rows.length === 0) {
    return null;
  }

  const practice = practiceResult.rows[0] as { id: string; name: string; slug: string };

  const membersResult = await query(
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
    [practice.id]
  );

  return {
    id: practice.id,
    name: practice.name,
    slug: practice.slug,
    members: membersResult.rows.map((row: Record<string, unknown>) => ({
      doctorId: row.doctor_id as string,
      firstName: row.first_name as string,
      lastName: row.last_name as string,
      specialty: row.specialty as string,
      role: row.role as PracticeMemberRole,
    })),
  };
};

export const ensureDoctorInPractice = async (
  doctorUserId: string,
  practiceId: string
): Promise<void> => {
  const result = await query(
    `SELECT pm.id
     FROM practice_members pm
     JOIN doctors d ON d.id = pm.doctor_id
     WHERE d.user_id = $1
       AND pm.practice_id = $2
       AND pm.is_active = TRUE
     LIMIT 1`,
    [doctorUserId, practiceId]
  );

  if (result.rows.length === 0) {
    throw new AppError('You are not a member of this practice', 403);
  }
};
