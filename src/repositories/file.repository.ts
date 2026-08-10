import { QueryResultRow } from 'pg';
import { dbQuery } from './db';

export const findAccessibleCasePatientId = async (
  caseId: string,
  userId: string
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT c.patient_id
     FROM cases c
     JOIN patients p ON p.id = c.patient_id
     LEFT JOIN case_assignments ca ON ca.case_id = c.id
     LEFT JOIN doctors d ON d.id = ca.doctor_id
     WHERE c.id = $1
       AND (p.user_id = $2 OR d.user_id = $2)
     LIMIT 1`,
    [caseId, userId]
  );
  return result.rows;
};

export const getAccessibleFileById = async (fileId: string, userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT mf.*,
            di.dicom_extraction_status,
            di.dicom_extraction_error
     FROM medical_files mf
     JOIN patients p ON p.id = mf.patient_id
     LEFT JOIN cases c ON c.id = mf.case_id
     LEFT JOIN case_assignments ca ON ca.case_id = c.id
     LEFT JOIN doctors d ON d.id = ca.doctor_id
     LEFT JOIN dicom_instances di ON di.file_id = mf.id
     WHERE mf.id = $1
       AND (p.user_id = $2 OR d.user_id = $2)
     ORDER BY mf.created_at DESC
     LIMIT 1`,
    [fileId, userId]
  );
  return result.rows;
};

export const findPatientDraftCaseStatus = async (
  caseId: string,
  userId: string
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT c.status
     FROM cases c
     JOIN patients p ON p.id = c.patient_id
     WHERE c.id = $1
       AND p.user_id = $2`,
    [caseId, userId]
  );
  return result.rows;
};

export interface InsertMedicalFileInput {
  caseId: string;
  patientId: string;
  uploadedBy: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  fileUrl: string;
  fileCategory: string | undefined;
  description: string | undefined;
  isDicom: boolean;
  fileSha256: string;
  pdfValidationStatus: string | null;
  pdfExtractionStatus: string | null;
}

export const insertMedicalFile = async (input: InsertMedicalFileInput): Promise<QueryResultRow> => {
  const result = await dbQuery(
    `INSERT INTO medical_files (
      case_id,
      patient_id,
      uploaded_by,
      file_name,
      file_type,
      file_size,
      file_url,
      file_category,
      description,
      is_dicom,
      file_sha256,
      pdf_validation_status,
      pdf_extraction_status
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      input.caseId,
      input.patientId,
      input.uploadedBy,
      input.fileName,
      input.fileType,
      input.fileSize,
      input.fileUrl,
      input.fileCategory,
      input.description,
      input.isDicom,
      input.fileSha256,
      input.pdfValidationStatus,
      input.pdfExtractionStatus,
    ]
  );
  return result.rows[0];
};

export const listMedicalFiles = async (
  userId: string,
  caseId: string | undefined,
  pageSize: number,
  offset: number
): Promise<QueryResultRow[]> => {
  const params: unknown[] = [userId];
  let innerWhere = 'WHERE (p.user_id = $1 OR d.user_id = $1)';

  if (caseId) {
    params.push(caseId);
    innerWhere += ` AND mf.case_id = $${params.length}`;
  }

  params.push(pageSize, offset);
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  const queryStr = `
    SELECT paged.*, COUNT(*) OVER() AS __total_count
    FROM (
      SELECT DISTINCT mf.*,
             di.dicom_extraction_status,
             di.dicom_extraction_error
      FROM medical_files mf
      JOIN patients p ON p.id = mf.patient_id
      LEFT JOIN cases c ON c.id = mf.case_id
      LEFT JOIN case_assignments ca ON ca.case_id = c.id
      LEFT JOIN doctors d ON d.id = ca.doctor_id
      LEFT JOIN dicom_instances di ON di.file_id = mf.id
      ${innerWhere}
    ) paged
    ORDER BY paged.created_at DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

  const result = await dbQuery(queryStr, params);
  return result.rows;
};

export const deleteMedicalFile = async (fileId: string): Promise<void> => {
  await dbQuery('DELETE FROM medical_files WHERE id = $1', [fileId]);
};
