import crypto from 'crypto';
import { getPresidioConfig } from './presidioConfig.service';

export interface PresidioAnalyzerResult {
  start: number;
  end: number;
  score: number;
  entity_type: string;
  analysis_explanation?: string | null;
  recognition_metadata?: Record<string, unknown>;
}

export interface PresidioAnonymizeOperator {
  type: 'replace' | 'redact' | 'mask' | 'hash' | 'encrypt';
  new_value?: string;
  masking_char?: string;
  chars_to_mask?: number;
  from_end?: boolean;
  hash_type?: string;
  key?: string;
}

export interface PresidioAnonymizeResponse {
  text: string;
  items: Array<{
    start: number;
    end: number;
    entity_type: string;
    text: string;
    operator: string;
  }>;
}

export interface PresidioAdHocRecognizer {
  name: string;
  supported_language: string;
  supported_entity: string;
  patterns?: Array<{
    name: string;
    regex: string;
    score: number;
  }>;
  context?: string[];
  deny_list?: string[];
}

export class PresidioClientError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'PresidioClientError';
  }
}

const fetchJson = async <T>(
  url: string,
  body: unknown,
  timeoutMs: number
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new PresidioClientError(
        `Presidio request failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
        response.status
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof PresidioClientError) {
      throw error;
    }

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? `Presidio request timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : 'Presidio request failed';

    throw new PresidioClientError(message, undefined, error);
  } finally {
    clearTimeout(timeout);
  }
};

export const analyzeText = async (
  text: string,
  options?: {
    language?: string;
    scoreThreshold?: number;
    adHocRecognizers?: PresidioAdHocRecognizer[];
  }
): Promise<PresidioAnalyzerResult[]> => {
  const config = getPresidioConfig();
  const body: Record<string, unknown> = {
    text,
    language: options?.language || config.language,
    score_threshold: options?.scoreThreshold ?? config.minScore,
  };

  if (options?.adHocRecognizers && options.adHocRecognizers.length > 0) {
    body.ad_hoc_recognizers = options.adHocRecognizers;
  }

  const results = await fetchJson<PresidioAnalyzerResult[]>(
    `${config.analyzerUrl}/analyze`,
    body,
    config.timeoutMs
  );

  if (!Array.isArray(results)) {
    throw new PresidioClientError('Presidio analyzer returned a non-array payload.');
  }

  return results;
};

export const anonymizeText = async (
  text: string,
  analyzerResults: PresidioAnalyzerResult[],
  operators: Record<string, PresidioAnonymizeOperator>
): Promise<PresidioAnonymizeResponse> => {
  const config = getPresidioConfig();
  const response = await fetchJson<PresidioAnonymizeResponse>(
    `${config.anonymizerUrl}/anonymize`,
    {
      text,
      analyzer_results: analyzerResults,
      operators,
    },
    config.timeoutMs
  );

  if (!response || typeof response.text !== 'string') {
    throw new PresidioClientError('Presidio anonymizer returned an invalid payload.');
  }

  return response;
};

/** Derive a 32-byte AES key from the configured reversible secret. */
export const deriveReversibleKey = (secret: string): Buffer => {
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
};

export const encryptPayload = (plaintext: string, secret: string): string => {
  const key = deriveReversibleKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
};

export const decryptPayload = (sealed: string, secret: string): string => {
  const key = deriveReversibleKey(secret);
  const raw = Buffer.from(sealed, 'base64');
  if (raw.length < 28) {
    throw new Error('Invalid sealed de-identification payload.');
  }

  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
};
