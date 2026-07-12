import { query } from '../database/connection';
import { ExtractionQuality } from './ocrConfig.service';

export type PdfValidationStatus = 'pending' | 'succeeded' | 'failed';
export type PdfExtractionStatus = 'pending' | 'succeeded' | 'failed' | 'reused';
export type ExtractionMethod =
  | 'pdf-parse'
  | 'raw-fallback'
  | 'cache'
  | 'textract'
  | 'vision-llm';

export interface StoredMedicalFileExtraction {
  id: string;
  file_id: string;
  case_id: string;
  file_sha256: string;
  extraction_method: ExtractionMethod;
  extracted_text: string;
  char_count: number;
  extraction_quality: ExtractionQuality | null;
  ocr_confidence: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface MedicalFilePdfRow {
  id: string;
  file_name: string;
  file_type: string;
  file_url: string;
  file_sha256: string | null;
  pdf_validation_status: PdfValidationStatus | null;
  pdf_validation_error: string | null;
  pdf_extraction_status: PdfExtractionStatus | null;
  pdf_extraction_error: string | null;
  pdf_extracted_at: Date | null;
}

export const isPdfMedicalFile = (fileType: string, fileName: string): boolean => {
  if (fileType === 'application/pdf') {
    return true;
  }

  return fileName.toLowerCase().endsWith('.pdf');
};

export const isImageMedicalFile = (fileType: string, fileName: string): boolean => {
  const normalizedType = fileType.toLowerCase();
  if (normalizedType.startsWith('image/')) {
    return true;
  }

  return /\.(jpe?g|png|gif|webp)$/i.test(fileName);
};

export const isReportMedicalFile = (fileType: string, fileName: string): boolean => {
  return isPdfMedicalFile(fileType, fileName) || isImageMedicalFile(fileType, fileName);
};

export const persistMedicalFileHash = async (fileId: string, fileSha256: string): Promise<void> => {
  await query(
    `UPDATE medical_files
     SET file_sha256 = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [fileId, fileSha256]
  );
};

export const updatePdfValidationStatus = async (
  fileId: string,
  status: PdfValidationStatus,
  error: string | null = null
): Promise<void> => {
  await query(
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
  status: PdfExtractionStatus,
  options: {
    error?: string | null;
    extractedAt?: Date | null;
  } = {}
): Promise<void> => {
  await query(
    `UPDATE medical_files
     SET pdf_extraction_status = $2,
         pdf_extraction_error = $3,
         pdf_extracted_at = COALESCE($4, pdf_extracted_at),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [fileId, status, options.error ?? null, options.extractedAt ?? null]
  );
};

const mapExtractionRow = (row: Record<string, unknown>): StoredMedicalFileExtraction => ({
  id: String(row.id),
  file_id: String(row.file_id),
  case_id: String(row.case_id),
  file_sha256: String(row.file_sha256),
  extraction_method: String(row.extraction_method) as ExtractionMethod,
  extracted_text: String(row.extracted_text),
  char_count: Number(row.char_count),
  extraction_quality: row.extraction_quality
    ? (String(row.extraction_quality) as ExtractionQuality)
    : null,
  ocr_confidence:
    row.ocr_confidence === null || row.ocr_confidence === undefined
      ? null
      : Number(row.ocr_confidence),
  created_at: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
  updated_at: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
});

export const getReusableMedicalFileExtraction = async (
  fileId: string,
  fileSha256: string
): Promise<StoredMedicalFileExtraction | null> => {
  const result = await query(
    `SELECT id, file_id, case_id, file_sha256, extraction_method, extracted_text, char_count,
            extraction_quality, ocr_confidence, created_at, updated_at
     FROM medical_file_extractions
     WHERE file_id = $1
       AND file_sha256 = $2
     LIMIT 1`,
    [fileId, fileSha256]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapExtractionRow(result.rows[0] as Record<string, unknown>);
};

export const upsertMedicalFileExtraction = async (input: {
  fileId: string;
  caseId: string;
  fileSha256: string;
  extractionMethod: Exclude<ExtractionMethod, 'cache'>;
  extractedText: string;
  extractionQuality?: ExtractionQuality | null;
  ocrConfidence?: number | null;
}): Promise<StoredMedicalFileExtraction> => {
  const result = await query(
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
      input.extractedText.length,
      input.extractionQuality ?? null,
      input.ocrConfidence ?? null,
    ]
  );

  return mapExtractionRow(result.rows[0] as Record<string, unknown>);
};

export const persistFreshReportExtraction = async (input: {
  caseId: string;
  row: MedicalFilePdfRow;
  fileSha256: string;
  text: string;
  method: Exclude<ExtractionMethod, 'cache'>;
  extractionQuality: ExtractionQuality;
  ocrConfidence: number | null;
}): Promise<void> => {
  await upsertMedicalFileExtraction({
    fileId: input.row.id,
    caseId: input.caseId,
    fileSha256: input.fileSha256,
    extractionMethod: input.method,
    extractedText: input.text,
    extractionQuality: input.extractionQuality,
    ocrConfidence: input.ocrConfidence,
  });
};

export const invalidateCaseAnalysisAfterPdfChange = async (caseId: string): Promise<boolean> => {
  const result = await query(
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

  return result.rows.length > 0;
};
