import { AppError } from '../middleware/errorHandler';
import {
  findActivePracticeMembership,
  findPracticeForDoctorUser,
  findPracticeMembers,
} from '../repositories/practice.repository';

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
  const practiceRows = await findPracticeForDoctorUser(doctorUserId);

  if (practiceRows.length === 0) {
    return null;
  }

  const practice = practiceRows[0] as { id: string; name: string; slug: string };

  const memberRows = await findPracticeMembers(practice.id);

  return {
    id: practice.id,
    name: practice.name,
    slug: practice.slug,
    members: memberRows.map((row: Record<string, unknown>) => ({
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
  const rows = await findActivePracticeMembership(doctorUserId, practiceId);

  if (rows.length === 0) {
    throw new AppError('You are not a member of this practice', 403);
  }
};
