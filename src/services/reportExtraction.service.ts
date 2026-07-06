import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { computeFileSha256 } from './fileHash.service';
import {
  getReusableMedicalFileExtraction,
  isPdfMedicalFile,
  MedicalFilePdfRow,
  persistMedicalFileHash,
  updatePdfExtractionStatus,
  upsertMedicalFileExtraction,
} from './medicalFileAnalysis.service';

export interface ExtractedReport {
  fileId: string;
  fileName: string;
  text: string;
  charCount: number;
  extractionMethod: 'pdf-parse' | 'raw-fallback' | 'cache';
  reused: boolean;
}

const resolveStoredFilePath = (fileUrl: string): string => {
  const normalized = fileUrl.startsWith('/') ? fileUrl.slice(1) : fileUrl;
  return path.resolve(process.cwd(), normalized);
};

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const cleanTextCandidate = (value: string): string => {
  return normalizeWhitespace(
    value
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\n/g, ' ')
      .replace(/\\r/g, ' ')
      .replace(/\\t/g, ' ')
      .replace(/\\\\/g, '\\')
      .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
  );
};

const parseTextWithPdfParse = async (buffer: Buffer): Promise<string> => {
  const parsed = await pdfParse(buffer);
  return normalizeWhitespace(parsed.text || '');
};

const recoverTextFromRawPdf = (buffer: Buffer): string => {
  const latin = buffer.toString('latin1');
  const chunks: string[] = [];

  const literalMatches = latin.match(/\((?:\\.|[^()\\]){8,}\)/g) || [];
  for (const match of literalMatches) {
    const value = match.slice(1, -1);
    const cleaned = cleanTextCandidate(value);
    if (cleaned.length >= 20 && /[A-Za-z]{3,}/.test(cleaned)) {
      chunks.push(cleaned);
    }
  }

  const asciiMatches = latin.match(/[A-Za-z0-9,.;:\-()/%\s]{30,}/g) || [];
  for (const match of asciiMatches) {
    const cleaned = cleanTextCandidate(match);
    if (cleaned.length >= 30 && /[A-Za-z]{5,}/.test(cleaned)) {
      chunks.push(cleaned);
    }
  }

  const combined = normalizeWhitespace(chunks.join(' '));
  if (!combined) {
    return '';
  }

  const uniqueSegments = Array.from(new Set(combined.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean)));
  return normalizeWhitespace(uniqueSegments.join(' '));
};

export const extractTextFromPdf = async (
  filePath: string
): Promise<{ text: string; method: 'pdf-parse' | 'raw-fallback' }> => {
  const buffer = await fs.promises.readFile(filePath);

  try {
    const text = await parseTextWithPdfParse(buffer);
    return { text, method: 'pdf-parse' };
  } catch (error) {
    const fallbackText = recoverTextFromRawPdf(buffer);
    if (fallbackText.length >= 120) {
      logger.warn('pdf-parse failed; using raw PDF text recovery fallback.', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
        recoveredChars: fallbackText.length,
      });
      return { text: fallbackText, method: 'raw-fallback' };
    }

    throw error;
  }
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

const loadPdfMedicalFiles = async (caseId: string): Promise<MedicalFilePdfRow[]> => {
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
    isPdfMedicalFile(row.file_type, row.file_name)
  );
};

const persistFreshExtraction = async (input: {
  caseId: string;
  row: MedicalFilePdfRow;
  fileSha256: string;
  text: string;
  method: 'pdf-parse' | 'raw-fallback';
}): Promise<void> => {
  await upsertMedicalFileExtraction({
    fileId: input.row.id,
    caseId: input.caseId,
    fileSha256: input.fileSha256,
    extractionMethod: input.method,
    extractedText: input.text,
  });

  await updatePdfExtractionStatus(input.row.id, 'succeeded', {
    error: null,
    extractedAt: new Date(),
  });
};

export const extractCaseReports = async (
  caseId: string,
  maxCharsPerFile: number,
  maxTotalChars: number
): Promise<ExtractedReport[]> => {
  const pdfRows = await loadPdfMedicalFiles(caseId);

  if (pdfRows.length === 0) {
    throw new Error('At least one PDF report is required for analysis.');
  }

  const reports: ExtractedReport[] = [];
  const extractionIssues: string[] = [];
  let totalChars = 0;

  for (const row of pdfRows) {
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
    let method: 'pdf-parse' | 'raw-fallback' | 'cache' = 'pdf-parse';
    let reused = false;

    if (reusable && reusable.extracted_text.length >= 40) {
      text = reusable.extracted_text;
      method = 'cache';
      reused = true;
      await updatePdfExtractionStatus(row.id, 'reused', {
        error: null,
        extractedAt: reusable.updated_at,
      });

      logger.info('Reused cached PDF extraction for analysis', {
        caseId,
        fileId: row.id,
        fileName: row.file_name,
        charCount: reusable.char_count,
      });
    } else {
      try {
        const extracted = await extractTextFromPdf(filePath);
        text = extracted.text;
        method = extracted.method;
      } catch (error) {
        const normalized = normalizeExtractionError(error);
        extractionIssues.push(`${row.file_name}: ${normalized}`);
        await updatePdfExtractionStatus(row.id, 'failed', { error: normalized });
        logger.warn('PDF extraction failed for file', {
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

      await persistFreshExtraction({
        caseId,
        row,
        fileSha256,
        text,
        method,
      });
    }

    const boundedText = text.slice(0, maxCharsPerFile);
    if (boundedText.length < 40) {
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
      reused,
    });

    totalChars += finalText.length;

    if (!reused) {
      logger.info('PDF extracted for analysis', {
        caseId,
        fileId: row.id,
        fileName: row.file_name,
        method,
        charCount: finalText.length,
      });
    }
  }

  if (reports.length === 0) {
    const issueSummary = extractionIssues.length > 0 ? extractionIssues[0] : 'No extractable text found.';
    throw new Error(
      `No extractable text found in uploaded PDF reports. ${issueSummary} Scanned-image/malformed/encrypted PDFs are not supported in V1.`
    );
  }

  return reports;
};
