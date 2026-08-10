import { AppError } from '../middleware/errorHandler';
import {
  findCaseInternalNotes,
  findDoctorIdAssignedToCase,
  findDoctorNameById,
  insertCaseInternalNote as insertCaseInternalNoteRow,
} from '../repositories/caseInternalNotes.repository';

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
  const rows = await findDoctorIdAssignedToCase(caseId, doctorUserId);

  if (rows.length === 0) {
    throw new AppError('You do not have access to this case', 403);
  }

  return rows[0].doctor_id as string;
};

export const listCaseInternalNotes = async (
  caseId: string,
  doctorUserId: string
): Promise<CaseInternalNoteRecord[]> => {
  await ensureDoctorAssignedToCase(caseId, doctorUserId);

  const rows = await findCaseInternalNotes(caseId);

  return rows.map((row: Record<string, unknown>) => ({
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

  const row = await insertCaseInternalNoteRow({
    caseId,
    authorDoctorId,
    note: trimmed,
    visibility,
  });

  const authorRows = await findDoctorNameById(authorDoctorId);
  const author = authorRows[0] || {};

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
