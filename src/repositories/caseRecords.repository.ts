import { QueryResultRow } from 'pg';
import { dbQuery } from './db';

export type RecordsConnectionRow = {
  id: string;
  case_id: string;
  connection_id: string;
  provider: string;
  status: string;
  document_count: number;
  medications_count: number;
  conditions_count: number;
  labs_count: number;
  identity_verified_at: string | null;
  fetch_started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};

export const findConnectionByCaseId = async (
  caseId: string
): Promise<RecordsConnectionRow | null> => {
  const result = await dbQuery<RecordsConnectionRow>(
    `SELECT id, case_id, connection_id, provider, status,
            document_count, medications_count, conditions_count, labs_count,
            identity_verified_at, fetch_started_at, completed_at, error_code,
            created_at, updated_at
     FROM case_records_connections
     WHERE case_id = $1
     LIMIT 1`,
    [caseId]
  );
  return result.rows[0] || null;
};

export const upsertConnection = async (input: {
  caseId: string;
  connectionId: string;
  provider: string;
  status: string;
}): Promise<RecordsConnectionRow> => {
  const result = await dbQuery<RecordsConnectionRow>(
    `INSERT INTO case_records_connections (
       case_id, connection_id, provider, status, updated_at
     ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (case_id) DO UPDATE SET
       connection_id = EXCLUDED.connection_id,
       provider = EXCLUDED.provider,
       status = EXCLUDED.status,
       document_count = 0,
       medications_count = 0,
       conditions_count = 0,
       labs_count = 0,
       identity_verified_at = NULL,
       fetch_started_at = NULL,
       completed_at = NULL,
       error_code = NULL,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, case_id, connection_id, provider, status,
               document_count, medications_count, conditions_count, labs_count,
               identity_verified_at, fetch_started_at, completed_at, error_code,
               created_at, updated_at`,
    [input.caseId, input.connectionId, input.provider, input.status]
  );
  return result.rows[0];
};

export const markIdentityVerified = async (
  caseId: string
): Promise<RecordsConnectionRow | null> => {
  const result = await dbQuery<RecordsConnectionRow>(
    `UPDATE case_records_connections
     SET status = 'pending',
         identity_verified_at = CURRENT_TIMESTAMP,
         fetch_started_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE case_id = $1
     RETURNING id, case_id, connection_id, provider, status,
               document_count, medications_count, conditions_count, labs_count,
               identity_verified_at, fetch_started_at, completed_at, error_code,
               created_at, updated_at`,
    [caseId]
  );
  return result.rows[0] || null;
};

export const markConnectionComplete = async (input: {
  caseId: string;
  status: 'partial' | 'complete' | 'failed';
  documentCount: number;
  medications: number;
  conditions: number;
  labs: number;
  errorCode?: string | null;
}): Promise<RecordsConnectionRow | null> => {
  const result = await dbQuery<RecordsConnectionRow>(
    `UPDATE case_records_connections
     SET status = $2,
         document_count = $3,
         medications_count = $4,
         conditions_count = $5,
         labs_count = $6,
         error_code = $7,
         completed_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE case_id = $1
     RETURNING id, case_id, connection_id, provider, status,
               document_count, medications_count, conditions_count, labs_count,
               identity_verified_at, fetch_started_at, completed_at, error_code,
               created_at, updated_at`,
    [
      input.caseId,
      input.status,
      input.documentCount,
      input.medications,
      input.conditions,
      input.labs,
      input.errorCode ?? null,
    ]
  );
  return result.rows[0] || null;
};

export const updateCaseRecordsStatus = async (
  caseId: string,
  status: string
): Promise<void> => {
  await dbQuery(`UPDATE cases SET records_status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [
    caseId,
    status,
  ]);
};

export const findPatientIdForCase = async (caseId: string): Promise<string | null> => {
  const result = await dbQuery<QueryResultRow>(`SELECT patient_id FROM cases WHERE id = $1 LIMIT 1`, [
    caseId,
  ]);
  return (result.rows[0]?.patient_id as string) || null;
};
