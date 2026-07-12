import fs from 'fs';
import pdfParse from 'pdf-parse';
import logger from '../utils/logger';
import { getOcrConfig, resolveExtractionQuality, ExtractionQuality } from './ocrConfig.service';
import { extractTextWithTextract } from './textractOcr.service';
import {
  extractTextWithVision,
  isVisionOcrConfigured,
} from './visionOcr.service';

export type DocumentExtractionMethod =
  | 'pdf-parse'
  | 'raw-fallback'
  | 'textract'
  | 'vision-llm';

export interface DocumentExtractionResult {
  text: string;
  method: DocumentExtractionMethod;
  extractionQuality: ExtractionQuality;
  ocrConfidence: number | null;
  hasHandwriting: boolean;
}

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

  const uniqueSegments = Array.from(
    new Set(combined.split(/(?<=[.?!])\s+/).map((segment) => segment.trim()).filter(Boolean))
  );
  return normalizeWhitespace(uniqueSegments.join(' '));
};

const isImageMimeType = (mimeType: string): boolean => mimeType.toLowerCase().startsWith('image/');

const isPdfMimeType = (mimeType: string, fileName: string): boolean => {
  if (mimeType === 'application/pdf') {
    return true;
  }
  return fileName.toLowerCase().endsWith('.pdf');
};

const buildResult = (input: {
  text: string;
  method: DocumentExtractionMethod;
  ocrConfidence: number | null;
  hasHandwriting: boolean;
}): DocumentExtractionResult => {
  const text = normalizeWhitespace(input.text);
  return {
    text,
    method: input.method,
    ocrConfidence: input.ocrConfidence,
    hasHandwriting: input.hasHandwriting,
    extractionQuality: resolveExtractionQuality({
      method: input.method,
      charCount: text.length,
      ocrConfidence: input.ocrConfidence,
      hasHandwriting: input.hasHandwriting,
    }),
  };
};

const shouldUseVisionFallback = (input: {
  text: string;
  confidence: number;
  hasHandwriting: boolean;
}): boolean => {
  const config = getOcrConfig();
  if (!config.visionFallbackEnabled || !isVisionOcrConfigured()) {
    return false;
  }

  if (input.text.length < config.minChars) {
    return true;
  }

  if (input.hasHandwriting) {
    return true;
  }

  return input.confidence < config.textractMinConfidence;
};

const runOcrFallback = async (
  buffer: Buffer,
  mimeType: string,
  _fileName: string
): Promise<DocumentExtractionResult | null> => {
  const config = getOcrConfig();
  if (!config.enabled) {
    return null;
  }

  let textractText = '';
  let textractConfidence = 0;
  let hasHandwriting = false;

  const textractResult = await extractTextWithTextract(buffer);
  if (textractResult) {
    textractText = textractResult.text;
    textractConfidence = textractResult.confidence;
    hasHandwriting = textractResult.hasHandwriting;
  }

  if (textractText.length >= config.minChars && !shouldUseVisionFallback({
    text: textractText,
    confidence: textractConfidence,
    hasHandwriting,
  })) {
    return buildResult({
      text: textractText,
      method: 'textract',
      ocrConfidence: textractConfidence,
      hasHandwriting,
    });
  }

  const visionResult = isImageMimeType(mimeType)
    ? await extractTextWithVision(buffer, mimeType)
    : null;

  if (visionResult?.text) {
    return buildResult({
      text: visionResult.text,
      method: 'vision-llm',
      ocrConfidence: visionResult.confidence,
      hasHandwriting: visionResult.hasHandwriting,
    });
  }

  if (textractText) {
    return buildResult({
      text: textractText,
      method: 'textract',
      ocrConfidence: textractConfidence,
      hasHandwriting,
    });
  }

  return null;
};

export const extractTextFromReportFile = async (
  filePath: string,
  mimeType: string,
  fileName: string
): Promise<DocumentExtractionResult> => {
  const buffer = await fs.promises.readFile(filePath);
  const config = getOcrConfig();

  if (isImageMimeType(mimeType)) {
    const ocrResult = await runOcrFallback(buffer, mimeType, fileName);
    if (ocrResult && ocrResult.text.length >= config.minChars) {
      return ocrResult;
    }

    throw new Error('Unable to extract readable text from the uploaded image report.');
  }

  if (isPdfMimeType(mimeType, fileName)) {
    try {
      const parsedText = await parseTextWithPdfParse(buffer);
      if (parsedText.length >= config.minChars) {
        return buildResult({
          text: parsedText,
          method: 'pdf-parse',
          ocrConfidence: null,
          hasHandwriting: false,
        });
      }
    } catch (error) {
      const fallbackText = recoverTextFromRawPdf(buffer);
      if (fallbackText.length >= 120) {
        logger.warn('pdf-parse failed; using raw PDF text recovery fallback.', {
          filePath,
          error: error instanceof Error ? error.message : String(error),
          recoveredChars: fallbackText.length,
        });
        return buildResult({
          text: fallbackText,
          method: 'raw-fallback',
          ocrConfidence: null,
          hasHandwriting: false,
        });
      }
    }

    const ocrResult = await runOcrFallback(buffer, mimeType, fileName);
    if (ocrResult && ocrResult.text.length >= config.minChars) {
      return ocrResult;
    }

    throw new Error(
      'No extractable text found in uploaded PDF report. Scanned, handwritten, encrypted, or blurry documents may need a clearer upload.'
    );
  }

  throw new Error('Unsupported report file type for text extraction.');
};
