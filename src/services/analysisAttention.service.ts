/**
 * Per-case attention signals (SEC-122 / PC2). Complements fleet SLO alerting.
 * Priority on success: low_confidence > slow > retried. Failures: failed_terminal.
 * SEC-123: emit structured warn + span attrs when a single run is slow (no webhook).
 */

import { LOW_CONFIDENCE_THRESHOLD } from '../evals/contractChecks';
import { query } from '../database/connection';
import logger from '../utils/logger';
import type { SpanHandle } from '../observability/phoenix.service';

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

export interface StepLatencyBreakdown {
  stepName: string;
  durationMs: number;
}

/** Aggregate step durations from case_analysis_events (started→completed). */
export const getRunStepLatencyBreakdown = async (runId: string): Promise<StepLatencyBreakdown[]> => {
  const result = await query(
    `SELECT step_name,
            GREATEST(
              0,
              FLOOR(
                EXTRACT(EPOCH FROM (COALESCE(completed_at, CURRENT_TIMESTAMP) - started_at)) * 1000
              )
            ) AS duration_ms
     FROM case_analysis_events
     WHERE run_id = $1
       AND started_at IS NOT NULL
     ORDER BY duration_ms DESC NULLS LAST
     LIMIT 12`,
    [runId]
  );

  return (result.rows as Array<{ step_name?: unknown; duration_ms?: unknown }>).map((row) => ({
    stepName: String(row.step_name || 'unknown'),
    durationMs: Number(row.duration_ms) || 0,
  }));
};

/**
 * SEC-123: one structured warn + optional Phoenix attrs when a single case is slow.
 * No webhook — fleet A2 still pages fail-closed / SLO breaches separately.
 */
export const emitPerCaseLatencyWarnIfNeeded = async (params: {
  runId: string;
  caseId: string;
  latencyMs: number | null;
  attentionReason?: AttentionReason | null;
  runSpan?: SpanHandle | null;
}): Promise<void> => {
  const { runId, caseId, latencyMs, attentionReason, runSpan } = params;
  if (typeof latencyMs !== 'number' || !Number.isFinite(latencyMs) || latencyMs <= PER_CASE_LATENCY_WARN_MS) {
    return;
  }

  let stepBreakdown: StepLatencyBreakdown[] = [];
  try {
    stepBreakdown = await getRunStepLatencyBreakdown(runId);
  } catch (error) {
    logger.warn('Failed to load step breakdown for slow analysis run', {
      runId,
      caseId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const slowest = stepBreakdown[0] || null;

  logger.warn('Per-case analysis latency warning', {
    runId,
    caseId,
    latencyMs,
    thresholdMs: PER_CASE_LATENCY_WARN_MS,
    attentionReason: attentionReason || 'slow',
    slowestStep: slowest?.stepName || null,
    slowestStepMs: slowest?.durationMs ?? null,
    stepBreakdown,
  });

  runSpan?.addAttributes({
    'per_case.latency_warn': true,
    'per_case.latency_ms': latencyMs,
    'per_case.latency_threshold_ms': PER_CASE_LATENCY_WARN_MS,
    'per_case.slowest_step': slowest?.stepName || 'unknown',
    'per_case.slowest_step_ms': slowest?.durationMs ?? 0,
    'per_case.attention_reason': attentionReason || 'slow',
  });
};
