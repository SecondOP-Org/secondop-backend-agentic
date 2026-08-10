import { QueryResultRow } from 'pg';
import { dbQuery } from './db';

export const findDoctorIdByUserId = async (userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery('SELECT id FROM doctors WHERE user_id = $1', [userId]);
  return result.rows;
};

export const findCaseRowForDoctor = async (
  caseId: string,
  doctorUserId: string
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT c.id,
            c.specialist_questions,
            c.analysis_questions,
            c.analysis_artifact,
            c.analysis_summary,
            c.analysis_model,
            c.share_ai_analysis_with_specialists,
            ca.response_draft
     FROM cases c
     JOIN case_assignments ca ON ca.case_id = c.id
     JOIN doctors d ON d.id = ca.doctor_id
     WHERE c.id = $1 AND d.user_id = $2
     LIMIT 1`,
    [caseId, doctorUserId]
  );
  return result.rows;
};

export const findResponseDraftByCaseAndDoctor = async (
  caseId: string,
  doctorId: string
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT response_draft
     FROM case_assignments
     WHERE case_id = $1 AND doctor_id = $2`,
    [caseId, doctorId]
  );
  return result.rows;
};

export const updateResponseDraft = async (
  caseId: string,
  doctorId: string,
  responseDraftJson: string
): Promise<void> => {
  await dbQuery(
    `UPDATE case_assignments
     SET response_draft = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE case_id = $1 AND doctor_id = $2`,
    [caseId, doctorId, responseDraftJson]
  );
};

export const clearResponseDraftByCaseAndDoctor = async (
  caseId: string,
  doctorId: string
): Promise<void> => {
  await dbQuery(
    `UPDATE case_assignments
     SET response_draft = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE case_id = $1 AND doctor_id = $2`,
    [caseId, doctorId]
  );
};
