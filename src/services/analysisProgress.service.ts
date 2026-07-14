import { query } from '../database/connection';
import { getLatestAnalysisRun, type AnalysisRun } from './analysisRun.service';

export const ANALYSIS_PROGRESS_STAGES = [
  'queued',
  'validating_files',
  'extracting_reports',
  'synthesizing_summary',
  'guardrail_check',
  'persisting_result',
  'complete',
  'failed',
] as const;

export type AnalysisProgressStage = (typeof ANALYSIS_PROGRESS_STAGES)[number];

export interface AnalysisProgressEvent {
  event: AnalysisProgressStage;
  runId: string;
  caseId: string;
  at: string;
}

const STEP_NAME_TO_STAGE: Record<string, AnalysisProgressStage> = {
  'intake-validation': 'validating_files',
  'report-extraction': 'extracting_reports',
  'clinical-synthesis': 'synthesizing_summary',
  'question-guard': 'guardrail_check',
  'persist-results': 'persisting_result',
  'agentic:validate_intake': 'validating_files',
  'agentic:extract_reports': 'extracting_reports',
  'agentic:synthesize_summary': 'synthesizing_summary',
  'agentic:guard_questions': 'guardrail_check',
  'agentic:finalize': 'persisting_result',
};

const TERMINAL_STAGES = new Set<AnalysisProgressStage>(['complete', 'failed']);

export const mapStepNameToProgressStage = (stepName: string): AnalysisProgressStage | null => {
  const normalized = String(stepName || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return STEP_NAME_TO_STAGE[normalized] || null;
};

export const buildSafeProgressEvent = (input: {
  event: AnalysisProgressStage;
  runId: string;
  caseId: string;
  at?: Date | string;
}): AnalysisProgressEvent => ({
  event: input.event,
  runId: input.runId,
  caseId: input.caseId,
  at: input.at
    ? new Date(input.at).toISOString()
    : new Date().toISOString(),
});

interface AnalysisEventRow {
  id: string;
  step_name: string;
  step_status: string;
  started_at: Date | string;
  completed_at: Date | string | null;
}

const listRunEvents = async (runId: string): Promise<AnalysisEventRow[]> => {
  const result = await query(
    `SELECT id, step_name, step_status, started_at, completed_at
     FROM case_analysis_events
     WHERE run_id = $1
     ORDER BY started_at ASC, created_at ASC, id ASC`,
    [runId]
  );
  return result.rows as AnalysisEventRow[];
};

const resolveRun = async (caseId: string, runId?: string): Promise<AnalysisRun | null> => {
  if (runId) {
    const result = await query(
      `SELECT id, case_id, status, engine, execution_mode, started_at, completed_at, model,
              error, error_message, pipeline_version, model_version, prompt_version,
              latency_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, created_at
       FROM case_analysis_runs
       WHERE id = $1 AND case_id = $2
       LIMIT 1`,
      [runId, caseId]
    );
    return (result.rows[0] as AnalysisRun | undefined) || null;
  }

  return getLatestAnalysisRun(caseId);
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Authenticated NDJSON progress iterator: replays DB events, then polls until terminal.
 * Payloads contain only safe stage names — never clinical text or error bodies.
 */
export async function* iterateAnalysisProgress(input: {
  caseId: string;
  runId?: string;
  pollIntervalMs?: number;
  maxWaitMs?: number;
}): AsyncGenerator<AnalysisProgressEvent> {
  const pollIntervalMs = input.pollIntervalMs ?? 400;
  const maxWaitMs = input.maxWaitMs ?? 15 * 60 * 1000;
  const startedAt = Date.now();

  let run = await resolveRun(input.caseId, input.runId);
  if (!run) {
    return;
  }

  const emitted = new Set<AnalysisProgressStage>();
  const seenEventIds = new Set<string>();

  const emitOnce = function* (event: AnalysisProgressEvent): Generator<AnalysisProgressEvent> {
    if (emitted.has(event.event)) {
      return;
    }
    emitted.add(event.event);
    yield event;
  };

  yield* emitOnce(
    buildSafeProgressEvent({
      event: 'queued',
      runId: run.id,
      caseId: input.caseId,
      at: run.created_at,
    })
  );

  while (Date.now() - startedAt < maxWaitMs) {
    run = (await resolveRun(input.caseId, run.id)) || run;
    const rows = await listRunEvents(run.id);

    for (const row of rows) {
      if (seenEventIds.has(row.id)) {
        continue;
      }
      seenEventIds.add(row.id);

      const stage = mapStepNameToProgressStage(row.step_name);
      if (!stage) {
        continue;
      }

      // Public progress advances on step start (and on failed terminal).
      if (row.step_status === 'started' || row.step_status === 'failed') {
        yield* emitOnce(
          buildSafeProgressEvent({
            event: row.step_status === 'failed' ? 'failed' : stage,
            runId: run.id,
            caseId: input.caseId,
            at: row.started_at,
          })
        );
      }

      if (row.step_status === 'failed') {
        return;
      }
    }

    if (run.status === 'succeeded') {
      yield* emitOnce(
        buildSafeProgressEvent({
          event: 'complete',
          runId: run.id,
          caseId: input.caseId,
          at: run.completed_at || new Date(),
        })
      );
      return;
    }

    if (run.status === 'failed') {
      yield* emitOnce(
        buildSafeProgressEvent({
          event: 'failed',
          runId: run.id,
          caseId: input.caseId,
          at: run.completed_at || new Date(),
        })
      );
      return;
    }

    if ([...emitted].some((stage) => TERMINAL_STAGES.has(stage))) {
      return;
    }

    await sleep(pollIntervalMs);
  }

  // Timed out waiting — emit failed without clinical detail.
  yield* emitOnce(
    buildSafeProgressEvent({
      event: 'failed',
      runId: run.id,
      caseId: input.caseId,
    })
  );
}
