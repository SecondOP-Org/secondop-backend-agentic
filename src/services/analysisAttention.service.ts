/**
 * Per-case attention signals (SEC-122 / PC2). Complements fleet SLO alerting.
 * Priority on success: low_confidence > slow > retried. Failures: failed_terminal.
 */

import { LOW_CONFIDENCE_THRESHOLD } from '../evals/contractChecks';

export type AttentionReason = 'low_confidence' | 'slow' | 'failed_terminal' | 'retried';

export const PER_CASE_LATENCY_WARN_MS = (() => {
  const raw = Number(process.env.PER_CASE_LATENCY_WARN_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 180_000;
})();

export interface AttentionReasonInput {
  outcome: 'succeeded' | 'failed';
  confidenceScore?: number | null;
  latencyMs?: number | null;
  attemptCount?: number | null;
}

export const computeAttentionReason = (input: AttentionReasonInput): AttentionReason | null => {
  if (input.outcome === 'failed') {
    return 'failed_terminal';
  }

  if (
    typeof input.confidenceScore === 'number' &&
    Number.isFinite(input.confidenceScore) &&
    input.confidenceScore < LOW_CONFIDENCE_THRESHOLD
  ) {
    return 'low_confidence';
  }

  if (
    typeof input.latencyMs === 'number' &&
    Number.isFinite(input.latencyMs) &&
    input.latencyMs > PER_CASE_LATENCY_WARN_MS
  ) {
    return 'slow';
  }

  if ((input.attemptCount ?? 1) >= 2) {
    return 'retried';
  }

  return null;
};

export const ATTENTION_REASON_LABELS: Record<AttentionReason, string> = {
  low_confidence: 'Low confidence',
  slow: 'Slow run',
  failed_terminal: 'Terminal failure',
  retried: 'Succeeded after retry',
};
