import { QueryResultRow } from 'pg';
import { dbQuery } from './db';

export const updateMedicalFileHash = async (fileId: string, fileSha256: string): Promise<void> => {
  await dbQuery(
    `UPDATE medical_files
     SET file_sha256 = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [fileId, fileSha256]
  );
};

export const updatePdfValidationStatus = async (
  fileId: string,
  status: string,
  error: string | null = null
): Promise<void> => {
  await dbQuery(
    `UPDATE medical_files
     SET pdf_validation_status = $2,
         pdf_validation_error = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [fileId, status, error]
  );
};

export const updatePdfExtractionStatus = async (
  fileId: string,
  status: string,
  error: string | null,
  extractedAt: Date | null
): Promise<void> => {
  await dbQuery(
    `UPDATE medical_files
     SET pdf_extraction_status = $2,
         pdf_extraction_error = $3,
         pdf_extracted_at = COALESCE($4, pdf_extracted_at),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [fileId, status, error, extractedAt]
  );
};

export const findReusableMedicalFileExtraction = async (
  fileId: string,
  fileSha256: string
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT id, file_id, case_id, file_sha256, extraction_method, extracted_text, char_count,
            extraction_quality, ocr_confidence, created_at, updated_at
     FROM medical_file_extractions
     WHERE file_id = $1
       AND file_sha256 = $2
     LIMIT 1`,
    [fileId, fileSha256]
  );
  return result.rows;
};

export interface UpsertMedicalFileExtractionInput {
  fileId: string;
  caseId: string;
  fileSha256: string;
  extractionMethod: string;
  extractedText: string;
  charCount: number;
  extractionQuality: string | null;
  ocrConfidence: number | null;
}

export const upsertMedicalFileExtraction = async (
  input: UpsertMedicalFileExtractionInput
): Promise<QueryResultRow> => {
  const result = await dbQuery(
    `INSERT INTO medical_file_extractions (
      file_id,
      case_id,
      file_sha256,
      extraction_method,
      extracted_text,
      char_count,
      extraction_quality,
      ocr_confidence
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (file_id, file_sha256)
    DO UPDATE SET
      extraction_method = EXCLUDED.extraction_method,
      extracted_text = EXCLUDED.extracted_text,
      char_count = EXCLUDED.char_count,
      extraction_quality = EXCLUDED.extraction_quality,
      ocr_confidence = EXCLUDED.ocr_confidence,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, file_id, case_id, file_sha256, extraction_method, extracted_text, char_count,
              extraction_quality, ocr_confidence, created_at, updated_at`,
    [
      input.fileId,
      input.caseId,
      input.fileSha256,
      input.extractionMethod,
      input.extractedText,
      input.charCount,
      input.extractionQuality,
      input.ocrConfidence,
    ]
  );
  return result.rows[0];
};

export const resetCaseAnalysisAfterPdfChange = async (caseId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `UPDATE cases
     SET analysis_status = 'not_started',
         analysis_summary = NULL,
         analysis_questions = NULL,
         analysis_artifact = NULL,
         analysis_model = NULL,
         analysis_error = NULL,
         analysis_started_at = NULL,
         analysis_completed_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND analysis_status IN ('succeeded', 'failed')
     RETURNING id`,
    [caseId]
  );
  return result.rows;
};
