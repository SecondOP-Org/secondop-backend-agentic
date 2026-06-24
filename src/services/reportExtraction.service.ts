import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { query } from '../database/connection';
import logger from '../utils/logger';

export interface ExtractedReport {
  fileId: string;
  fileName: string;
  text: string;
  charCount: number;
}

interface MedicalFileRow {
  id: string;
  file_name: string;
  file_type: string;
  file_url: string;
}

const isPdfFile = (fileType: string, fileName: string): boolean => {
  if (fileType === 'application/pdf') {
    return true;
  }

  return fileName.toLowerCase().endsWith('.pdf');
};

const resolveStoredFilePath = (fileUrl: string): string => {
  const normalized = fileUrl.startsWith('/') ? fileUrl.slice(1) : fileUrl;
  return path.resolve(process.cwd(), normalized);
};

const normalizeWhitespace = (value: string): string => {
  return value.replace(/\s+/g, ' ').trim();
};

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

// Fallback for malformed PDFs where xref/parser fails:
// recover text-like payloads directly from bytes and PDF literal strings.
const recoverTextFromRawPdf = (buffer: Buffer): string => {
  const latin = buffer.toString('latin1');
  const chunks: string[] = [];

  // PDF literal strings in parentheses can contain visible report text.
  const literalMatches = latin.match(/\((?:\\.|[^()\\]){8,}\)/g) || [];
  for (const match of literalMatches) {
    const value = match.slice(1, -1);
    const cleaned = cleanTextCandidate(value);
    if (cleaned.length >= 20 && /[A-Za-z]{3,}/.test(cleaned)) {
      chunks.push(cleaned);
    }
  }

  // ASCII "strings" extraction as a second fallback.
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

  // Deduplicate repeated segments.
  const uniqueSegments = Array.from(new Set(combined.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean)));
  return normalizeWhitespace(uniqueSegments.join(' '));
};

const extractTextFromPdf = async (filePath: string): Promise<{ text: string; method: 'pdf-parse' | 'raw-fallback' }> => {
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

export const extractCaseReports = async (
  caseId: string,
  maxCharsPerFile: number,
  maxTotalChars: number
): Promise<ExtractedReport[]> => {
  const filesResult = await query(
    `SELECT id, file_name, file_type, file_url
     FROM medical_files
     WHERE case_id = $1
     ORDER BY created_at ASC`,
    [caseId]
  );

  const rows = filesResult.rows as MedicalFileRow[];
  const pdfRows = rows.filter((row) => isPdfFile(row.file_type, row.file_name));

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
      continue;
    }

    let text = '';
    let method: 'pdf-parse' | 'raw-fallback' = 'pdf-parse';
    try {
      const extracted = await extractTextFromPdf(filePath);
      text = extracted.text;
      method = extracted.method;
    } catch (error) {
      const normalized = normalizeExtractionError(error);
      extractionIssues.push(`${row.file_name}: ${normalized}`);
      logger.warn('PDF extraction failed for file', {
        caseId,
        fileId: row.id,
        fileName: row.file_name,
        error: normalized,
      });
      continue;
    }

    if (!text) {
      extractionIssues.push(`${row.file_name}: extracted text was empty.`);
      continue;
    }

    const boundedText = text.slice(0, maxCharsPerFile);
    if (boundedText.length < 40) {
      extractionIssues.push(`${row.file_name}: extracted text too short (${boundedText.length} chars).`);
      continue;
    }

    const remaining = maxTotalChars - totalChars;
    const finalText = boundedText.slice(0, remaining);

    reports.push({
      fileId: row.id,
      fileName: row.file_name,
      text: finalText,
      charCount: finalText.length,
    });

    totalChars += finalText.length;

    logger.info('PDF extracted for analysis', {
      caseId,
      fileId: row.id,
      fileName: row.file_name,
      method,
      charCount: finalText.length,
    });
  }

  if (reports.length === 0) {
    const issueSummary = extractionIssues.length > 0 ? extractionIssues[0] : 'No extractable text found.';
    throw new Error(
      `No extractable text found in uploaded PDF reports. ${issueSummary} Scanned-image/malformed/encrypted PDFs are not supported in V1.`
    );
  }

  return reports;
};
