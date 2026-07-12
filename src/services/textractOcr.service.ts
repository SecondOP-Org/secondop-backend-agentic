import AWS from 'aws-sdk';
import logger from '../utils/logger';
import { getOcrConfig } from './ocrConfig.service';

export interface TextractOcrResult {
  text: string;
  confidence: number;
  hasHandwriting: boolean;
}

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

let textractClient: AWS.Textract | null = null;

const getTextractClient = (): AWS.Textract | null => {
  const region = process.env.AWS_REGION?.trim();
  if (!region) {
    return null;
  }

  if (!textractClient) {
    textractClient = new AWS.Textract({ region });
  }

  return textractClient;
};

export const isTextractConfigured = (): boolean => {
  const config = getOcrConfig();
  if (!config.enabled || !config.textractEnabled) {
    return false;
  }

  return Boolean(getTextractClient());
};

export const extractTextWithTextract = async (buffer: Buffer): Promise<TextractOcrResult | null> => {
  const config = getOcrConfig();
  if (!config.enabled || !config.textractEnabled) {
    return null;
  }

  const client = getTextractClient();
  if (!client) {
    return null;
  }

  try {
    const response = await client
      .detectDocumentText({
        Document: { Bytes: buffer },
      })
      .promise();

    const lineBlocks =
      response.Blocks?.filter((block) => block.BlockType === 'LINE' && block.Text) ?? [];
    const confidences = lineBlocks
      .map((block) => block.Confidence ?? 0)
      .filter((confidence) => confidence > 0);
    const averageConfidence =
      confidences.length > 0
        ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length / 100
        : 0;
    const hasHandwriting = lineBlocks.some((block) => block.TextType === 'HANDWRITING');
    const text = normalizeWhitespace(lineBlocks.map((block) => block.Text || '').join('\n'));

    if (!text) {
      return null;
    }

    return {
      text,
      confidence: averageConfidence,
      hasHandwriting,
    };
  } catch (error) {
    logger.warn('Textract OCR failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};
