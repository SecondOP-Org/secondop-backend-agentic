import { QueryResultRow } from 'pg';
import { dbQuery } from './db';

export const findDoctorIdAssignedToCase = async (
  caseId: string,
  doctorUserId: string
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT d.id AS doctor_id
     FROM cases c
     JOIN case_assignments ca ON ca.case_id = c.id
     JOIN doctors d ON d.id = ca.doctor_id
     WHERE c.id = $1 AND d.user_id = $2
     LIMIT 1`,
    [caseId, doctorUserId]
  );
  return result.rows;
};

export const findCaseInternalNotes = async (caseId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
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
  return result.rows;
};

export interface InsertCaseInternalNoteInput {
  caseId: string;
  authorDoctorId: string;
  note: string;
  visibility: string;
}

export const insertCaseInternalNote = async (
  input: InsertCaseInternalNoteInput
): Promise<QueryResultRow> => {
  const result = await dbQuery(
    `INSERT INTO case_internal_notes (case_id, author_doctor_id, note, visibility)
     VALUES ($1, $2, $3, $4)
     RETURNING id, case_id, author_doctor_id, note, visibility, created_at`,
    [input.caseId, input.authorDoctorId, input.note, input.visibility]
  );
  return result.rows[0];
};

export const findDoctorNameById = async (doctorId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(`SELECT first_name, last_name FROM doctors WHERE id = $1`, [doctorId]);
  return result.rows;
};
