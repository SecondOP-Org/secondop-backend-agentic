/**
 * Classify analysis failures as RETRYABLE (transient) vs TERMINAL (deterministic).
 * SEC-121 — never retry grounding/validation; do retry Presidio/de-id outages and timeouts.
 */

export type AnalysisFailureClass = 'RETRYABLE' | 'TERMINAL';

export interface ClassifiedAnalysisFailure {
  classification: AnalysisFailureClass;
  reason: string;
}

const TERMINAL_SUBSTRINGS = [
  'validation_error',
  'analysis contract validation failed',
  'not grounded',
  'caseanalysiscontracterror',
  'at least one medical report',
  'no extractable text found',
  'no_dicom',
  'no dicom',
  'deid_reversible_key',
  'reversible key',
  'unauthorized',
  'forbidden',
  'policy_error',
] as const;

const RETRYABLE_SUBSTRINGS = [
  'de-identification unavailable',
  'analysis halted to avoid sending raw phi',
  'presidio',
  'analysis timed out',
  'timeout_error',
  'etimedout',
  'econnreset',
  'econnrefused',
  'socket hang up',
  'fetch failed',
  'network',
  '503',
  '502',
  '504',
  '429',
  'model_error',
  'extraction_error',
  'persistence_error',
  'serialization failure',
  'deadlock',
  'connection terminated',
] as const;

const extractCode = (message: string): string | null => {
  const match = message.match(/^\[([a-z_]+)\]/i);
  return match ? match[1].toLowerCase() : null;
};

/**
 * Classify a thrown error or persisted `[code] message` string.
 * Prefer explicit AgentError/AgenticError codes when present on the object.
 */
export const classifyAnalysisFailure = (error: unknown): ClassifiedAnalysisFailure => {
  const codeFromObject =
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
      ? String((error as { code: string }).code).toLowerCase()
      : null;

  const messageFromObject =
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
      ? String((error as { message: string }).message)
      : null;

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : messageFromObject || 'Unknown analysis error';
  const normalized = `${codeFromObject ? `[${codeFromObject}] ` : ''}${message}`.toLowerCase();
  const bracketCode = extractCode(normalized) || codeFromObject;

  if (
    bracketCode === 'validation_error' ||
    bracketCode === 'policy_error' ||
    TERMINAL_SUBSTRINGS.some((token) => normalized.includes(token))
  ) {
    return { classification: 'TERMINAL', reason: bracketCode || 'terminal_validation' };
  }

  // Fail-closed de-id halt / Presidio outage: RETRYABLE (must re-check de-id on retry).
  if (
    bracketCode === 'timeout_error' ||
    bracketCode === 'model_error' ||
    bracketCode === 'extraction_error' ||
    bracketCode === 'persistence_error' ||
    RETRYABLE_SUBSTRINGS.some((token) => normalized.includes(token))
  ) {
    return { classification: 'RETRYABLE', reason: bracketCode || 'transient_infra' };
  }

  // Unknown errors: treat as RETRYABLE once (transient infra may surface as unknown).
  return { classification: 'RETRYABLE', reason: bracketCode || 'unknown_transient' };
};

/** Max total attempts including the first (so 2 automatic retries). */
export const ANALYSIS_MAX_ATTEMPTS = 3;

/** Backoff seconds before attempt 2 and attempt 3. */
export const ANALYSIS_RETRY_BACKOFF_SECONDS = [5, 20] as const;

export const getRetryBackoffSeconds = (nextAttemptCount: number): number => {
  // nextAttemptCount is 2 or 3 when scheduling the next try.
  const index = Math.max(0, Math.min(ANALYSIS_RETRY_BACKOFF_SECONDS.length - 1, nextAttemptCount - 2));
  return ANALYSIS_RETRY_BACKOFF_SECONDS[index];
};

export const canRetryAnalysisAttempt = (attemptCount: number): boolean =>
  attemptCount < ANALYSIS_MAX_ATTEMPTS;
