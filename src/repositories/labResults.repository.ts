import { QueryResultRow } from 'pg';
import { dbQuery } from './db';

export const findPatientIdByUserId = async (userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery('SELECT id FROM patients WHERE user_id = $1', [userId]);
  return result.rows;
};

export interface InsertLabResultInput {
  patientId: string;
  caseId: string;
  orderedBy: string;
  testName: string;
  testType: string;
  results: unknown;
  referenceRange: string;
  unit: string;
  status: string;
  notes: string;
}

export const insertLabResult = async (input: InsertLabResultInput): Promise<QueryResultRow> => {
  const result = await dbQuery(
    `INSERT INTO lab_results (patient_id, case_id, ordered_by, test_name, test_type, results, reference_range, unit, status, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.patientId,
      input.caseId,
      input.orderedBy,
      input.testName,
      input.testType,
      input.results,
      input.referenceRange,
      input.unit,
      input.status,
      input.notes,
    ]
  );
  return result.rows[0];
};

export const findLabResultsByPatientId = async (patientId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    'SELECT * FROM lab_results WHERE patient_id = $1 ORDER BY test_date DESC',
    [patientId]
  );
  return result.rows;
};

export const findLabResultById = async (labResultId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT lr.*, 
            p.first_name as patient_first_name,
            p.last_name as patient_last_name,
            u.email as ordered_by_email
     FROM lab_results lr
     JOIN patients p ON lr.patient_id = p.id
     JOIN users u ON lr.ordered_by = u.id
     WHERE lr.id = $1`,
    [labResultId]
  );
  return result.rows;
};

export interface UpdateLabResultInput {
  labResultId: string;
  results?: unknown;
  status?: string;
  notes?: string;
}

export const updateLabResult = async (input: UpdateLabResultInput): Promise<void> => {
  await dbQuery(
    `UPDATE lab_results SET 
     results = COALESCE($1, results),
     status = COALESCE($2, status),
     notes = COALESCE($3, notes),
     updated_at = CURRENT_TIMESTAMP
     WHERE id = $4`,
    [input.results, input.status, input.notes, input.labResultId]
  );
};

export const deleteLabResult = async (labResultId: string): Promise<void> => {
  await dbQuery('DELETE FROM lab_results WHERE id = $1', [labResultId]);
};
