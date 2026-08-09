import { GROUNDING_HTTP_TIMEOUT_MS } from '../../config/grounding';
import logger from '../../utils/logger';

export class GroundingHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroundingHttpError';
  }
}

/**
 * Fetch with hard timeout. Never logs URL query strings that might contain PHI —
 * callers must pass only normalized entity terms.
 */
export const groundingFetch = async (
  url: string,
  options: RequestInit = {},
  timeoutMs: number = GROUNDING_HTTP_TIMEOUT_MS
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Grounding HTTP request failed';
    logger.warn('Grounding HTTP call failed (fail-soft)', {
      host: safeHost(url),
      message,
    });
    throw new GroundingHttpError(message);
  } finally {
    clearTimeout(timer);
  }
};

const safeHost = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown';
  }
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
