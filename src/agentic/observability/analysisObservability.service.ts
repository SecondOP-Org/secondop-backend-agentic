import { query } from '../../database/connection';
import { normalizeExecutionMode, toLegacyExecutionMode } from '../core/executionMode';
import { listArtifactsByRunId } from '../../services/caseAnalysisRunArtifact.service';

interface TokenUsageAggregate {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface RunTokenUsageSummary {
  modelTokenUsage: TokenUsageAggregate;
  plannerTokenUsage: TokenUsageAggregate;
  totalTokenUsage: TokenUsageAggregate;
}

const createTokenUsage = (): TokenUsageAggregate => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
});

const coerceMetadata = (raw: unknown): Record<string, unknown> => {
  if (!raw) {
    return {};
  }

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }

  if (typeof raw === 'object') {
    return raw as Record<string, unknown>;
  }

  return {};
};

const addUsage = (target: TokenUsageAggregate, usage: unknown): void => {
  const safe = (usage || {}) as {
    promptTokens?: unknown;
    completionTokens?: unknown;
    totalTokens?: unknown;
  };

  target.promptTokens += Number(safe.promptTokens || 0);
  target.completionTokens += Number(safe.completionTokens || 0);
  target.totalTokens += Number(safe.totalTokens || 0);
};

const aggregateEventTokenUsage = (
  rows: Array<{ run_id?: string; metadata_json?: unknown }>
): Record<string, RunTokenUsageSummary> => {
  const byRunId: Record<string, RunTokenUsageSummary> = {};

  for (const row of rows) {
    const runId = row.run_id;
    if (!runId) {
      continue;
    }

    if (!byRunId[runId]) {
      byRunId[runId] = {
        modelTokenUsage: createTokenUsage(),
        plannerTokenUsage: createTokenUsage(),
        totalTokenUsage: createTokenUsage(),
      };
    }

    const metadata = coerceMetadata(row.metadata_json);
    addUsage(byRunId[runId].modelTokenUsage, metadata.modelTokenUsage);
    addUsage(byRunId[runId].plannerTokenUsage, metadata.plannerTokenUsage);

    byRunId[runId].totalTokenUsage.promptTokens =
      byRunId[runId].modelTokenUsage.promptTokens + byRunId[runId].plannerTokenUsage.promptTokens;
    byRunId[runId].totalTokenUsage.completionTokens =
      byRunId[runId].modelTokenUsage.completionTokens + byRunId[runId].plannerTokenUsage.completionTokens;
    byRunId[runId].totalTokenUsage.totalTokens =
      byRunId[runId].modelTokenUsage.totalTokens + byRunId[runId].plannerTokenUsage.totalTokens;
  }

  return byRunId;
};

export const getCaseRunTrace = async (caseId: string, runId?: string) => {
  const runsResult = await query(
    `SELECT id, case_id, status, engine, execution_mode, started_at, completed_at, model, error, error_message,
            pipeline_version, model_version, prompt_version, latency_ms, prompt_tokens, completion_tokens,
            total_tokens, estimated_cost_usd, created_at
     FROM case_analysis_runs
     WHERE case_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [caseId]
  );

  const selectedRunId = runId || (runsResult.rows[0]?.id as string | undefined);

  const eventsResult = selectedRunId
    ? await query(
        `SELECT id, run_id, case_id, step_name, step_status, started_at, completed_at, metadata_json, error_text, created_at
         FROM case_analysis_events
         WHERE run_id = $1
         ORDER BY started_at ASC, created_at ASC`,
        [selectedRunId]
      )
    : { rows: [] };

  const shadowResult = selectedRunId
    ? await query(
        `SELECT id, case_id, run_id, mode, summary, questions_json, observations_json, critic_score_json, final_status, error, created_at
         FROM case_analysis_shadow_results
         WHERE run_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [selectedRunId]
      )
    : { rows: [] };

  const runIds = (runsResult.rows as Array<{ id?: string }>)
    .map((row) => row.id)
    .filter((id): id is string => Boolean(id));

  const usageEventRows = runIds.length
    ? await query(
        `SELECT run_id, metadata_json
         FROM case_analysis_events
         WHERE run_id = ANY($1::uuid[])`,
        [runIds]
      )
    : { rows: [] };

  const runTokenUsageByRunId = aggregateEventTokenUsage(
    usageEventRows.rows as Array<{ run_id?: string; metadata_json?: unknown }>
  );

  const artifacts = selectedRunId ? await listArtifactsByRunId(selectedRunId) : [];

  return {
    runs: (runsResult.rows as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      execution_mode: normalizeExecutionMode(String(row.execution_mode || 'baseline')),
      legacy_execution_mode: toLegacyExecutionMode(normalizeExecutionMode(String(row.execution_mode || 'baseline'))),
      error_message: row.error_message ?? row.error ?? null,
    })),
    selectedRunId: selectedRunId || null,
    events: eventsResult.rows,
    shadow: shadowResult.rows[0] || null,
    artifacts,
    runTokenUsageByRunId,
    selectedRunTokenUsage: selectedRunId ? runTokenUsageByRunId[selectedRunId] || null : null,
  };
};
