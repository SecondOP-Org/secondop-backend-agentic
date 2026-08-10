import * as medicalFileAnalysisRepo from '../repositories/medicalFileAnalysis.repository';
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
  await medicalFileAnalysisRepo.updateMedicalFileHash(fileId, fileSha256);
};

export const updatePdfValidationStatus = async (
  fileId: string,
  status: PdfValidationStatus,
  error: string | null = null
): Promise<void> => {
  await medicalFileAnalysisRepo.updatePdfValidationStatus(fileId, status, error);
};

export const updatePdfExtractionStatus = async (
  fileId: string,
  status: PdfExtractionStatus,
  options: {
    error?: string | null;
    extractedAt?: Date | null;
  } = {}
): Promise<void> => {
  await medicalFileAnalysisRepo.updatePdfExtractionStatus(
    fileId,
    status,
    options.error ?? null,
    options.extractedAt ?? null
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
  const rows = await medicalFileAnalysisRepo.findReusableMedicalFileExtraction(fileId, fileSha256);

  if (rows.length === 0) {
    return null;
  }

  return mapExtractionRow(rows[0] as Record<string, unknown>);
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
  const row = await medicalFileAnalysisRepo.upsertMedicalFileExtraction({
    fileId: input.fileId,
    caseId: input.caseId,
    fileSha256: input.fileSha256,
    extractionMethod: input.extractionMethod,
    extractedText: input.extractedText,
    charCount: input.extractedText.length,
    extractionQuality: input.extractionQuality ?? null,
    ocrConfidence: input.ocrConfidence ?? null,
  });

  return mapExtractionRow(row as Record<string, unknown>);
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
  const rows = await medicalFileAnalysisRepo.resetCaseAnalysisAfterPdfChange(caseId);
  return rows.length > 0;
};
