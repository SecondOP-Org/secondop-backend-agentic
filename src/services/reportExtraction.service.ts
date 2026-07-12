import fs from 'fs';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { resolveStoredFilePath } from '../utils/uploadPath';
import { computeFileSha256 } from './fileHash.service';
import { extractTextFromReportFile } from './documentExtraction.service';
import { ExtractionQuality, getOcrConfig } from './ocrConfig.service';
import {
  getReusableMedicalFileExtraction,
  isReportMedicalFile,
  MedicalFilePdfRow,
  persistFreshReportExtraction,
  persistMedicalFileHash,
  updatePdfExtractionStatus,
} from './medicalFileAnalysis.service';

export interface ExtractedReport {
  fileId: string;
  fileName: string;
  text: string;
  charCount: number;
  extractionMethod: 'pdf-parse' | 'raw-fallback' | 'cache' | 'textract' | 'vision-llm';
  extractionQuality: ExtractionQuality;
  ocrConfidence: number | null;
  reused: boolean;
}

export const extractTextFromPdf = async (
  filePath: string
): Promise<{ text: string; method: 'pdf-parse' | 'raw-fallback' }> => {
  const extracted = await extractTextFromReportFile(filePath, 'application/pdf', filePath);
  if (extracted.method !== 'pdf-parse' && extracted.method !== 'raw-fallback') {
    return { text: extracted.text, method: 'pdf-parse' };
  }

  return {
    text: extracted.text,
    method: extracted.method,
  };
};

export const validatePdfUpload = async (
  filePath: string
): Promise<{ valid: boolean; error: string | null }> => {
  try {
    const buffer = await fs.promises.readFile(filePath);
    if (!buffer.slice(0, 5).toString('utf8').startsWith('%PDF')) {
      return { valid: false, error: 'File is not a readable PDF document.' };
    }

    return { valid: true, error: null };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unable to read uploaded PDF.',
    };
  }
};

export const validateImageUpload = async (
  filePath: string,
  mimeType: string
): Promise<{ valid: boolean; error: string | null }> => {
  try {
    const buffer = await fs.promises.readFile(filePath);
    if (buffer.length < 32) {
      return { valid: false, error: 'Image file is too small to be a valid report.' };
    }

    if (mimeType === 'image/png' && buffer.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      return { valid: false, error: 'File does not appear to be a valid PNG image.' };
    }

    if (
      (mimeType === 'image/jpeg' || mimeType === 'image/jpg') &&
      buffer[0] !== 0xff &&
      buffer[1] !== 0xd8
    ) {
      return { valid: false, error: 'File does not appear to be a valid JPEG image.' };
    }

    return { valid: true, error: null };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unable to read uploaded image.',
    };
  }
};

const normalizeExtractionError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);

  if (/Invalid number: \{ \(charCode 123\)/i.test(message)) {
    return 'PDF parser failed on malformed numeric object. Re-export the PDF (Print to PDF) and upload again.';
  }

  if (/bad XRef entry/i.test(message)) {
    return 'PDF has malformed cross-reference entries (bad XRef). Re-export/print-to-PDF and upload again.';
  }

  if (/password|encrypted/i.test(message)) {
    return 'PDF appears encrypted/password-protected. Please upload an unlocked PDF.';
  }

  return message;
};

const ensureFileSha256 = async (row: MedicalFilePdfRow, filePath: string): Promise<string> => {
  if (row.file_sha256) {
    return row.file_sha256;
  }

  const fileSha256 = await computeFileSha256(filePath);
  await persistMedicalFileHash(row.id, fileSha256);
  return fileSha256;
};

const loadReportMedicalFiles = async (caseId: string): Promise<MedicalFilePdfRow[]> => {
  const filesResult = await query(
    `SELECT id, file_name, file_type, file_url, file_sha256,
            pdf_validation_status, pdf_validation_error,
            pdf_extraction_status, pdf_extraction_error, pdf_extracted_at
     FROM medical_files
     WHERE case_id = $1
     ORDER BY created_at ASC`,
    [caseId]
  );

  return (filesResult.rows as MedicalFilePdfRow[]).filter((row) =>
    isReportMedicalFile(row.file_type, row.file_name)
  );
};

export const extractCaseReports = async (
  caseId: string,
  maxCharsPerFile: number,
  maxTotalChars: number
): Promise<ExtractedReport[]> => {
  const reportRows = await loadReportMedicalFiles(caseId);
  const minChars = getOcrConfig().minChars;

  if (reportRows.length === 0) {
    throw new Error('At least one medical report (PDF or image) is required for analysis.');
  }

  const reports: ExtractedReport[] = [];
  const extractionIssues: string[] = [];
  let totalChars = 0;

  for (const row of reportRows) {
    if (totalChars >= maxTotalChars) {
      break;
    }

    const filePath = resolveStoredFilePath(row.file_url);
    if (!fs.existsSync(filePath)) {
      extractionIssues.push(`${row.file_name}: file not found on server.`);
      await updatePdfExtractionStatus(row.id, 'failed', {
        error: 'File not found on server.',
      });
      continue;
    }

    const fileSha256 = await ensureFileSha256(row, filePath);
    const reusable = await getReusableMedicalFileExtraction(row.id, fileSha256);

    let text = '';
    let method: ExtractedReport['extractionMethod'] = 'pdf-parse';
    let extractionQuality: ExtractionQuality = 'high';
    let ocrConfidence: number | null = null;
    let reused = false;

    if (reusable && reusable.extracted_text.length >= minChars) {
      text = reusable.extracted_text;
      method = 'cache';
      extractionQuality = reusable.extraction_quality || 'medium';
      ocrConfidence = reusable.ocr_confidence;
      reused = true;
      await updatePdfExtractionStatus(row.id, 'reused', {
        error: null,
        extractedAt: reusable.updated_at,
      });

      logger.info('Reused cached report extraction for analysis', {
        caseId,
        fileId: row.id,
        fileName: row.file_name,
        charCount: reusable.char_count,
      });
    } else {
      try {
        const extracted = await extractTextFromReportFile(filePath, row.file_type, row.file_name);
        text = extracted.text;
        method = extracted.method;
        extractionQuality = extracted.extractionQuality;
        ocrConfidence = extracted.ocrConfidence;
      } catch (error) {
        const normalized = normalizeExtractionError(error);
        extractionIssues.push(`${row.file_name}: ${normalized}`);
        await updatePdfExtractionStatus(row.id, 'failed', { error: normalized });
        logger.warn('Report extraction failed for file', {
          caseId,
          fileId: row.id,
          fileName: row.file_name,
          error: normalized,
        });
        continue;
      }

      if (!text) {
        const emptyError = 'extracted text was empty.';
        extractionIssues.push(`${row.file_name}: ${emptyError}`);
        await updatePdfExtractionStatus(row.id, 'failed', { error: emptyError });
        continue;
      }

      await persistFreshReportExtraction({
        caseId,
        row,
        fileSha256,
        text,
        method,
        extractionQuality,
        ocrConfidence,
      });

      await updatePdfExtractionStatus(row.id, 'succeeded', {
        error: null,
        extractedAt: new Date(),
      });
    }

    const boundedText = text.slice(0, maxCharsPerFile);
    if (boundedText.length < minChars) {
      const shortError = `extracted text too short (${boundedText.length} chars).`;
      extractionIssues.push(`${row.file_name}: ${shortError}`);
      await updatePdfExtractionStatus(row.id, 'failed', { error: shortError });
      continue;
    }

    const remaining = maxTotalChars - totalChars;
    const finalText = boundedText.slice(0, remaining);

    reports.push({
      fileId: row.id,
      fileName: row.file_name,
      text: finalText,
      charCount: finalText.length,
      extractionMethod: method,
      extractionQuality,
      ocrConfidence,
      reused,
    });

    totalChars += finalText.length;

    if (!reused) {
      logger.info('Report extracted for analysis', {
        caseId,
        fileId: row.id,
        fileName: row.file_name,
        method,
        extractionQuality,
        charCount: finalText.length,
      });
    }
  }

  if (reports.length === 0) {
    const issueSummary = extractionIssues.length > 0 ? extractionIssues[0] : 'No extractable text found.';
    throw new Error(
      `No extractable text found in uploaded medical reports. ${issueSummary} Try a clearer photo, re-export the PDF, or upload an unlocked digital copy.`
    );
  }

  return reports;
};
