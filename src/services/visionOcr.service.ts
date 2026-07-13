import { getOpenAIClient } from '../ai/llmGateway';
import logger from '../utils/logger';
import { getOcrConfig } from './ocrConfig.service';

export interface VisionOcrResult {
  text: string;
  confidence: number;
  hasHandwriting: boolean;
}

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const buildVisionExtractionPrompt = (): string => {
  return [
    'Extract all legible text from this medical document image.',
    'Preserve section order and line breaks where possible.',
    'Do not interpret, summarize, or add medical conclusions.',
    'Mark unreadable sections as [illegible].',
    'Return plain text only.',
  ].join(' ');
};

const mimeTypeForVision = (mimeType: string): string => {
  const normalized = mimeType.toLowerCase();
  if (normalized === 'image/jpg') {
    return 'image/jpeg';
  }
  return normalized;
};

const extractTextFromVisionResponse = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('```')) {
    return normalizeWhitespace(trimmed.replace(/^```[a-z]*\n?/i, '').replace(/```$/, ''));
  }

  return normalizeWhitespace(trimmed);
};

export const isVisionOcrConfigured = (): boolean => {
  const config = getOcrConfig();
  if (!config.enabled || !config.visionFallbackEnabled) {
    return false;
  }

  return Boolean(getOpenAIClient({ optional: true }));
};

/**
 * Vision OCR extracts text via an image LLM call (raw pixels leave the trust
 * boundary). Post-extraction PHI tokenization for analysis prompts happens in
 * `extractCaseReports` → `deidentifyText` before any case-analysis LLM call.
 */
export const extractTextWithVision = async (
  imageBuffer: Buffer,
  mimeType: string
): Promise<VisionOcrResult | null> => {
  const config = getOcrConfig();
  if (!config.enabled || !config.visionFallbackEnabled) {
    return null;
  }

  const client = getOpenAIClient({ optional: true });
  if (!client) {
    return null;
  }

  const normalizedMimeType = mimeTypeForVision(mimeType);
  if (!normalizedMimeType.startsWith('image/')) {
    return null;
  }

  try {
    const response = await client.chat.completions.create({
      model: config.visionModel,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildVisionExtractionPrompt() },
            {
              type: 'image_url',
              image_url: {
                url: `data:${normalizedMimeType};base64,${imageBuffer.toString('base64')}`,
              },
            },
          ],
        },
      ],
    });

    const raw = response.choices[0]?.message?.content;
    let text = '';
    if (typeof raw === 'string') {
      text = extractTextFromVisionResponse(raw);
    } else if (Array.isArray(raw)) {
      const parts = raw as Array<{ text?: string }>;
      text = extractTextFromVisionResponse(
        parts
          .map((part) => (typeof part.text === 'string' ? part.text : ''))
          .join('\n')
      );
    }

    if (!text) {
      return null;
    }

    const illegibleCount = (text.match(/\[illegible\]/gi) || []).length;
    const hasHandwriting = illegibleCount > 0 || text.length < 120;
    const confidence = illegibleCount > 2 ? 0.45 : illegibleCount > 0 ? 0.62 : 0.78;

    return {
      text,
      confidence,
      hasHandwriting,
    };
  } catch (error) {
    logger.warn('Vision OCR failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};
