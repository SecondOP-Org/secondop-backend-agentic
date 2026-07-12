export type ExtractionQuality = 'high' | 'medium' | 'low';

const parseBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
};

const parseNumber = (value: string | undefined, defaultValue: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

export interface OcrConfig {
  enabled: boolean;
  textractEnabled: boolean;
  visionFallbackEnabled: boolean;
  minChars: number;
  textractMinConfidence: number;
  visionModel: string;
  visionFallbackMaxPages: number;
}

export const getOcrConfig = (): OcrConfig => ({
  enabled: parseBoolean(process.env.OCR_ENABLED, true),
  textractEnabled: parseBoolean(process.env.OCR_TEXTRACT_ENABLED, true),
  visionFallbackEnabled: parseBoolean(process.env.OCR_VISION_FALLBACK_ENABLED, true),
  minChars: parseNumber(process.env.OCR_MIN_CHARS, 40),
  textractMinConfidence: parseNumber(process.env.OCR_TEXTRACT_MIN_CONFIDENCE, 0.75),
  visionModel: process.env.OCR_VISION_MODEL?.trim() || 'gpt-4o',
  visionFallbackMaxPages: parseNumber(process.env.OCR_VISION_FALLBACK_MAX_PAGES, 10),
});

export const resolveExtractionQuality = (input: {
  method: 'pdf-parse' | 'raw-fallback' | 'textract' | 'vision-llm';
  charCount: number;
  ocrConfidence: number | null;
  hasHandwriting: boolean;
}): ExtractionQuality => {
  if (input.method === 'pdf-parse') {
    return 'high';
  }

  if (input.method === 'raw-fallback') {
    return input.charCount >= 200 ? 'medium' : 'low';
  }

  if (input.hasHandwriting || input.method === 'vision-llm') {
    if (input.charCount < 80 || (input.ocrConfidence !== null && input.ocrConfidence < 0.6)) {
      return 'low';
    }
    return 'medium';
  }

  if (input.ocrConfidence !== null && input.ocrConfidence >= 0.85 && input.charCount >= 120) {
    return 'high';
  }

  if (input.ocrConfidence !== null && input.ocrConfidence >= 0.7) {
    return 'medium';
  }

  return 'low';
};
