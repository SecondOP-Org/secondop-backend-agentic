import { query } from '../database/connection';
import { AppError } from '../middleware/errorHandler';

export type CaseInternalNoteVisibility = 'team' | 'coordinator_only';

export interface CaseInternalNoteRecord {
  id: string;
  caseId: string;
  authorDoctorId: string;
  authorName: string;
  note: string;
  visibility: CaseInternalNoteVisibility;
  createdAt: string;
}

const ensureDoctorAssignedToCase = async (caseId: string, doctorUserId: string): Promise<string> => {
  const result = await query(
    `SELECT d.id AS doctor_id
     FROM cases c
     JOIN case_assignments ca ON ca.case_id = c.id
     JOIN doctors d ON d.id = ca.doctor_id
     WHERE c.id = $1 AND d.user_id = $2
     LIMIT 1`,
    [caseId, doctorUserId]
  );

  if (result.rows.length === 0) {
    throw new AppError('You do not have access to this case', 403);
  }

  return result.rows[0].doctor_id as string;
};

export const listCaseInternalNotes = async (
  caseId: string,
  doctorUserId: string
): Promise<CaseInternalNoteRecord[]> => {
  await ensureDoctorAssignedToCase(caseId, doctorUserId);

  const result = await query(
    `SELECT n.id,
            n.case_id,
            n.author_doctor_id,
            n.note,
            n.visibility,
            n.created_at,
            d.first_name,
            d.last_name
     FROM case_internal_notes n
     JOIN doctors d ON d.id = n.author_doctor_id
     WHERE n.case_id = $1
     ORDER BY n.created_at DESC`,
    [caseId]
  );

  return result.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    caseId: row.case_id as string,
    authorDoctorId: row.author_doctor_id as string,
    authorName: `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Doctor',
    note: row.note as string,
    visibility: row.visibility as CaseInternalNoteVisibility,
    createdAt: new Date(row.created_at as string).toISOString(),
  }));
};

export const createCaseInternalNote = async (
  caseId: string,
  doctorUserId: string,
  note: string,
  visibility: CaseInternalNoteVisibility = 'team'
): Promise<CaseInternalNoteRecord> => {
  const trimmed = note.trim();
  if (!trimmed) {
    throw new AppError('note is required', 400);
  }

  const authorDoctorId = await ensureDoctorAssignedToCase(caseId, doctorUserId);

  const result = await query(
    `INSERT INTO case_internal_notes (case_id, author_doctor_id, note, visibility)
     VALUES ($1, $2, $3, $4)
     RETURNING id, case_id, author_doctor_id, note, visibility, created_at`,
    [caseId, authorDoctorId, trimmed, visibility]
  );

  const row = result.rows[0];
  const authorResult = await query(
    `SELECT first_name, last_name FROM doctors WHERE id = $1`,
    [authorDoctorId]
  );
  const author = authorResult.rows[0] || {};

  return {
    id: row.id as string,
    caseId: row.case_id as string,
    authorDoctorId: row.author_doctor_id as string,
    authorName: `${author.first_name || ''} ${author.last_name || ''}`.trim() || 'Doctor',
    note: row.note as string,
    visibility: row.visibility as CaseInternalNoteVisibility,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
};
