import { query } from '../database/connection';
import logger from '../utils/logger';

const TRAILING_RUN_WINDOW = 20;
const SUCCESS_RATE_FLOOR = 0.95;
const P95_LATENCY_MS_CEILING = 180_000;

export type FailClosedErrorClass =
  | 'presidio_unavailable'
  | 'missing_reversible_key'
  | 'deid_halt'
  | 'phi_guard';

export type CompletedRunRow = {
  id: string;
  case_id: string;
  status: 'succeeded' | 'failed' | string;
  latency_ms: number | null;
};

/** Classify fail-closed safety halts from persisted/thrown error text. */
export const classifyFailClosedError = (message: string): FailClosedErrorClass | null => {
  const normalized = message.toLowerCase();

  if (normalized.includes('deid_reversible_key') || normalized.includes('reversible key')) {
    return 'missing_reversible_key';
  }
  if (normalized.includes('presidio')) {
    return 'presidio_unavailable';
  }
  if (
    normalized.includes('de-identification unavailable') ||
    normalized.includes('analysis halted to avoid sending raw phi')
  ) {
    return 'deid_halt';
  }
  if (normalized.includes('phi guard') || normalized.includes('phi leak')) {
    return 'phi_guard';
  }

  return null;
};

export const computeP95LatencyMs = (latencyMsValues: number[]): number | null => {
  if (latencyMsValues.length === 0) {
    return null;
  }

  const sorted = [...latencyMsValues].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1));
  return sorted[index] ?? null;
};

export const evaluateTrailingSloBreaches = (
  runs: CompletedRunRow[]
): Array<{ kind: 'success_rate' | 'p95_latency'; detail: string }> => {
  if (runs.length === 0) {
    return [];
  }

  const breaches: Array<{ kind: 'success_rate' | 'p95_latency'; detail: string }> = [];
  const succeeded = runs.filter((run) => run.status === 'succeeded').length;
  const successRate = succeeded / runs.length;

  if (successRate < SUCCESS_RATE_FLOOR) {
    breaches.push({
      kind: 'success_rate',
      detail: `success_rate=${(successRate * 100).toFixed(1)}% over trailing ${runs.length} runs (floor ${SUCCESS_RATE_FLOOR * 100}%)`,
    });
  }

  const latencies = runs
    .map((run) => run.latency_ms)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  const p95 = computeP95LatencyMs(latencies);

  if (p95 !== null && p95 > P95_LATENCY_MS_CEILING) {
    breaches.push({
      kind: 'p95_latency',
      detail: `p95_latency_ms=${p95} over trailing ${latencies.length} timed runs (ceiling ${P95_LATENCY_MS_CEILING})`,
    });
  }

  return breaches;
};

export const postAlertWebhook = async (text: string): Promise<boolean> => {
  const url = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!url) {
    return false;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      logger.warn('Analysis alert webhook returned non-OK status', {
        status: response.status,
      });
      return false;
    }

    return true;
  } catch (error) {
    logger.warn('Analysis alert webhook request failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

const formatAlert = (parts: {
  severity: string;
  errorClass: string;
  runId: string;
  caseId: string;
  detail?: string;
}): string => {
  const base = `[SecondOp ${parts.severity}] errorClass=${parts.errorClass} caseId=${parts.caseId} runId=${parts.runId}`;
  if (!parts.detail) {
    return base;
  }
  const clipped = parts.detail.replace(/\s+/g, ' ').trim().slice(0, 240);
  return `${base} detail=${clipped}`;
};

/** Immediate alert for fail-closed safety events (no threshold). */
export const alertFailClosed = async (params: {
  runId: string;
  caseId: string;
  errorClass: string;
  detail?: string;
}): Promise<void> => {
  await postAlertWebhook(
    formatAlert({
      severity: 'FAIL-CLOSED',
      errorClass: params.errorClass,
      runId: params.runId,
      caseId: params.caseId,
      detail: params.detail,
    })
  );
};

const loadTrailingCompletedRuns = async (): Promise<CompletedRunRow[]> => {
  const result = await query(
    `SELECT id, case_id, status, latency_ms
     FROM case_analysis_runs
     WHERE status IN ('succeeded', 'failed')
       AND completed_at IS NOT NULL
     ORDER BY completed_at DESC
     LIMIT $1`,
    [TRAILING_RUN_WINDOW]
  );

  return result.rows as CompletedRunRow[];
};

export const evaluateTrailingSloAlerts = async (params: {
  runId: string;
  caseId: string;
}): Promise<void> => {
  const runs = await loadTrailingCompletedRuns();
  const breaches = evaluateTrailingSloBreaches(runs);

  for (const breach of breaches) {
    await postAlertWebhook(
      formatAlert({
        severity: 'SLO',
        errorClass: breach.kind,
        runId: params.runId,
        caseId: params.caseId,
        detail: breach.detail,
      })
    );
  }
};

/**
 * After a run reaches a terminal state: fail-closed fires immediately when
 * applicable; trailing-window SLOs are always evaluated.
 */
export const notifyAnalysisRunTerminal = async (params: {
  runId: string;
  caseId: string;
  errorMessage?: string | null;
}): Promise<void> => {
  if (params.errorMessage) {
    const errorClass = classifyFailClosedError(params.errorMessage);
    if (errorClass) {
      await alertFailClosed({
        runId: params.runId,
        caseId: params.caseId,
        errorClass,
        detail: params.errorMessage,
      });
    }
  }

  await evaluateTrailingSloAlerts({
    runId: params.runId,
    caseId: params.caseId,
  });
};
