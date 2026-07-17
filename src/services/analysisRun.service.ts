import { query } from '../database/connection';
import { AgenticCriticScore } from '../agentic/core/types';
import { normalizeExecutionMode, AnalysisExecutionMode } from '../agentic/core/executionMode';
import { getAnalysisRunVersionMetadata } from './analysisVersioning';
import { CaseAnalysisArtifact } from './analysisArtifact.service';
import {
  computeAttentionReason,
  type AttentionReason,
} from './analysisAttention.service';

export type { AnalysisExecutionMode } from '../agentic/core/executionMode';
export type { AttentionReason } from './analysisAttention.service';

export type AnalysisRunStatus = 'queued' | 'processing' | 'succeeded' | 'failed';
export type AnalysisRunEngine = 'baseline' | 'agentic';

export interface AnalysisRun {
  id: string;
  case_id: string;
  status: AnalysisRunStatus;
  engine: AnalysisRunEngine;
  execution_mode: AnalysisExecutionMode;
  started_at: Date | null;
  completed_at: Date | null;
  model: string | null;
  error: string | null;
  error_message: string | null;
  pipeline_version: string | null;
  model_version: string | null;
  prompt_version: string | null;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  critic_score: number | null;
  contract_pass: boolean | null;
  attempt_count: number;
  attention_reason: AttentionReason | null;
  created_at: Date;
}

export interface ShadowResult {
  id: string;
  case_id: string;
  run_id: string;
  mode: AnalysisExecutionMode;
  summary: string;
  questions_json: string[];
  observations_json: string[];
  artifact_json: CaseAnalysisArtifact | null;
  critic_score_json: AgenticCriticScore | null;
  final_status: 'succeeded' | 'failed';
  error: string | null;
  created_at: Date;
}

export type AnalysisEventStatus = 'started' | 'completed' | 'failed';

interface AnalysisEventInput {
  runId: string;
  caseId: string;
  stepName: string;
  stepStatus: AnalysisEventStatus;
  startedAt: Date;
  completedAt?: Date;
  metadata?: Record<string, unknown> | null;
  errorText?: string | null;
}

interface CreateShadowResultInput {
  caseId: string;
  runId: string;
  mode: AnalysisExecutionMode;
  summary: string;
  questions: string[];
  observations: string[];
  artifact: CaseAnalysisArtifact;
  criticScore: AgenticCriticScore | null;
  finalStatus: 'succeeded' | 'failed';
  error?: string;
}

export interface AnalysisRunCompletionMetadata {
  model: string;
  modelVersion?: string | null;
  pipelineVersion?: string | null;
  promptVersion?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  estimatedCostUsd?: number | null;
  criticScore?: number | null;
  contractPass?: boolean | null;
  confidenceScore?: number | null;
}

const ANALYSIS_RUN_SELECT_FIELDS = `
  id, case_id, status, engine, execution_mode, started_at, completed_at, model, error, error_message,
  pipeline_version, model_version, prompt_version, latency_ms, prompt_tokens, completion_tokens,
  total_tokens, estimated_cost_usd, critic_score, contract_pass, attempt_count, attention_reason, created_at
`;

const toNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const mapAnalysisRunRow = (row: Record<string, unknown>): AnalysisRun => {
  const errorMessage =
    typeof row.error_message === 'string'
      ? row.error_message
      : typeof row.error === 'string'
        ? row.error
        : null;

  return {
    id: String(row.id),
    case_id: String(row.case_id),
    status: row.status as AnalysisRunStatus,
    engine: (row.engine as AnalysisRunEngine) || 'baseline',
    execution_mode: normalizeExecutionMode(String(row.execution_mode || 'baseline')),
    started_at: row.started_at instanceof Date ? row.started_at : null,
    completed_at: row.completed_at instanceof Date ? row.completed_at : null,
    model: typeof row.model === 'string' ? row.model : null,
    error: typeof row.error === 'string' ? row.error : errorMessage,
    error_message: errorMessage,
    pipeline_version: typeof row.pipeline_version === 'string' ? row.pipeline_version : null,
    model_version: typeof row.model_version === 'string' ? row.model_version : null,
    prompt_version: typeof row.prompt_version === 'string' ? row.prompt_version : null,
    latency_ms: toNullableNumber(row.latency_ms),
    prompt_tokens: toNullableNumber(row.prompt_tokens),
    completion_tokens: toNullableNumber(row.completion_tokens),
    total_tokens: toNullableNumber(row.total_tokens),
    estimated_cost_usd: toNullableNumber(row.estimated_cost_usd),
    critic_score: toNullableNumber(row.critic_score),
    contract_pass:
      typeof row.contract_pass === 'boolean'
        ? row.contract_pass
        : row.contract_pass === null || row.contract_pass === undefined
          ? null
          : Boolean(row.contract_pass),
    attempt_count: Math.max(1, toNullableNumber(row.attempt_count) ?? 1),
    attention_reason:
      typeof row.attention_reason === 'string' ? (row.attention_reason as AttentionReason) : null,
    created_at: row.created_at as Date,
  };
};

const mapShadowRow = (row: Record<string, unknown>): ShadowResult => {
  return {
    id: String(row.id),
    case_id: String(row.case_id),
    run_id: String(row.run_id),
    mode: normalizeExecutionMode(String(row.mode || 'shadow')),
    summary: typeof row.summary === 'string' ? row.summary : '',
    questions_json: Array.isArray(row.questions_json) ? (row.questions_json as string[]) : [],
    observations_json: Array.isArray(row.observations_json) ? (row.observations_json as string[]) : [],
    artifact_json: (row.artifact_json as CaseAnalysisArtifact | null) || null,
    critic_score_json: (row.critic_score_json as AgenticCriticScore | null) || null,
    final_status: row.final_status as 'succeeded' | 'failed',
    error: typeof row.error === 'string' ? row.error : null,
    created_at: row.created_at as Date,
  };
};

export const createAnalysisRun = async (
  caseId: string,
  status: AnalysisRunStatus = 'queued',
  engine: AnalysisRunEngine = 'baseline',
  executionMode: AnalysisExecutionMode = 'baseline'
): Promise<AnalysisRun> => {
  const versions = getAnalysisRunVersionMetadata();

  try {
    const result = await query(
      `INSERT INTO case_analysis_runs (
         case_id, status, engine, execution_mode, pipeline_version, prompt_version
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${ANALYSIS_RUN_SELECT_FIELDS}`,
      [caseId, status, engine, executionMode, versions.pipelineVersion, versions.promptVersion]
    );

    return mapAnalysisRunRow(result.rows[0] as Record<string, unknown>);
  } catch (error) {
    const dbError = error as { code?: string };
    if (dbError.code === '23505') {
      const existing = await getLatestActiveAnalysisRun(caseId, engine);
      if (existing) {
        return existing;
      }
    }

    throw error;
  }
};

export const getLatestAnalysisRun = async (caseId: string): Promise<AnalysisRun | null> => {
  const result = await query(
    `SELECT ${ANALYSIS_RUN_SELECT_FIELDS}
     FROM case_analysis_runs
     WHERE case_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [caseId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapAnalysisRunRow(result.rows[0] as Record<string, unknown>);
};

export const getLatestAnalysisRunByEngine = async (
  caseId: string,
  engine: AnalysisRunEngine
): Promise<AnalysisRun | null> => {
  const result = await query(
    `SELECT ${ANALYSIS_RUN_SELECT_FIELDS}
     FROM case_analysis_runs
     WHERE case_id = $1 AND engine = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [caseId, engine]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapAnalysisRunRow(result.rows[0] as Record<string, unknown>);
};

export const getLatestActiveAnalysisRun = async (
  caseId: string,
  engine: AnalysisRunEngine = 'baseline'
): Promise<AnalysisRun | null> => {
  const result = await query(
    `SELECT ${ANALYSIS_RUN_SELECT_FIELDS}
     FROM case_analysis_runs
     WHERE case_id = $1
       AND engine = $2
       AND status IN ('queued', 'processing')
     ORDER BY created_at DESC
     LIMIT 1`,
    [caseId, engine]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapAnalysisRunRow(result.rows[0] as Record<string, unknown>);
};

export const markAnalysisRunProcessing = async (runId: string): Promise<boolean> => {
  const result = await query(
    `UPDATE case_analysis_runs
     SET status = 'processing',
         started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
     WHERE id = $1
       AND status = 'queued'
     RETURNING id`,
    [runId]
  );

  return result.rows.length > 0;
};

export const markAnalysisRunQueued = async (runId: string, errorMessage?: string): Promise<void> => {
  await query(
    `UPDATE case_analysis_runs
     SET status = 'queued',
         error = $2,
         error_message = $2,
         started_at = NULL,
         completed_at = NULL
     WHERE id = $1`,
    [runId, errorMessage || null]
  );
};

export const markAnalysisRunSucceeded = async (
  runId: string,
  metadata: AnalysisRunCompletionMetadata
): Promise<void> => {
  const versions = getAnalysisRunVersionMetadata();

  const result = await query(
    `UPDATE case_analysis_runs
     SET status = 'succeeded',
         model = $2,
         model_version = $3,
         pipeline_version = COALESCE(pipeline_version, $4),
         prompt_version = COALESCE(prompt_version, $5),
         prompt_tokens = $6,
         completion_tokens = $7,
         total_tokens = $8,
         estimated_cost_usd = $9,
         critic_score = $10,
         contract_pass = $11,
         latency_ms = CASE
           WHEN started_at IS NULL THEN NULL
           ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)) * 1000))
         END,
         error = NULL,
         error_message = NULL,
         completed_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING latency_ms, attempt_count`,
    [
      runId,
      metadata.model,
      metadata.modelVersion || metadata.model,
      metadata.pipelineVersion || versions.pipelineVersion,
      metadata.promptVersion || versions.promptVersion,
      metadata.promptTokens ?? null,
      metadata.completionTokens ?? null,
      metadata.totalTokens ?? null,
      metadata.estimatedCostUsd ?? null,
      metadata.criticScore ?? null,
      metadata.contractPass ?? null,
    ]
  );

  const row = result.rows[0] as { latency_ms?: unknown; attempt_count?: unknown } | undefined;
  const attentionReason = computeAttentionReason({
    outcome: 'succeeded',
    confidenceScore: metadata.confidenceScore ?? null,
    latencyMs: toNullableNumber(row?.latency_ms),
    attemptCount: toNullableNumber(row?.attempt_count) ?? 1,
  });

  await query(
    `UPDATE case_analysis_runs
     SET attention_reason = $2
     WHERE id = $1`,
    [runId, attentionReason]
  );
};

export const markAnalysisRunFailed = async (runId: string, errorMessage: string): Promise<void> => {
  await query(
    `UPDATE case_analysis_runs
     SET status = 'failed',
         error = $2,
         error_message = $2,
         attention_reason = 'failed_terminal',
         latency_ms = CASE
           WHEN started_at IS NULL THEN NULL
           ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)) * 1000))
         END,
         completed_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [runId, errorMessage]
  );
};

/**
 * Prepare a run for a delayed retry: bump attempt_count, reset to queued, clear timing.
 * Returns the new attempt_count. Caller must re-enqueue with backoff.
 */
export const prepareAnalysisRunForRetry = async (
  runId: string,
  errorMessage: string
): Promise<number> => {
  const result = await query(
    `UPDATE case_analysis_runs
     SET status = 'queued',
         attempt_count = attempt_count + 1,
         error = $2,
         error_message = $2,
         started_at = NULL,
         completed_at = NULL,
         latency_ms = NULL,
         attention_reason = NULL
     WHERE id = $1
     RETURNING attempt_count`,
    [runId, errorMessage]
  );

  if (result.rows.length === 0) {
    throw new Error(`Analysis run ${runId} not found for retry`);
  }

  return Number(result.rows[0].attempt_count);
};

export const getAnalysisRunById = async (runId: string): Promise<AnalysisRun | null> => {
  const result = await query(
    `SELECT ${ANALYSIS_RUN_SELECT_FIELDS}
     FROM case_analysis_runs
     WHERE id = $1
     LIMIT 1`,
    [runId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapAnalysisRunRow(result.rows[0] as Record<string, unknown>);
};

export const insertAnalysisEvent = async (event: AnalysisEventInput): Promise<void> => {
  await query(
    `INSERT INTO case_analysis_events (
      run_id,
      case_id,
      step_name,
      step_status,
      started_at,
      completed_at,
      metadata_json,
      error_text
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      event.runId,
      event.caseId,
      event.stepName,
      event.stepStatus,
      event.startedAt,
      event.completedAt || null,
      event.metadata ? JSON.stringify(event.metadata) : null,
      event.errorText || null,
    ]
  );
};

export const createShadowResult = async (input: CreateShadowResultInput): Promise<ShadowResult> => {
  const result = await query(
    `INSERT INTO case_analysis_shadow_results (
      case_id,
      run_id,
      mode,
      summary,
      questions_json,
      observations_json,
      artifact_json,
      critic_score_json,
      final_status,
      error
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id, case_id, run_id, mode, summary, questions_json, observations_json, artifact_json, critic_score_json, final_status, error, created_at`,
    [
      input.caseId,
      input.runId,
      input.mode,
      input.summary,
      JSON.stringify(input.questions),
      JSON.stringify(input.observations),
      JSON.stringify(input.artifact),
      input.criticScore ? JSON.stringify(input.criticScore) : null,
      input.finalStatus,
      input.error || null,
    ]
  );

  return mapShadowRow(result.rows[0] as Record<string, unknown>);
};

export const getLatestShadowResultByRunId = async (runId: string): Promise<ShadowResult | null> => {
  const result = await query(
    `SELECT id, case_id, run_id, mode, summary, questions_json, observations_json, artifact_json, critic_score_json, final_status, error, created_at
     FROM case_analysis_shadow_results
     WHERE run_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [runId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapShadowRow(result.rows[0] as Record<string, unknown>);
};

export const getLatestShadowResultByCaseId = async (caseId: string): Promise<ShadowResult | null> => {
  const result = await query(
    `SELECT id, case_id, run_id, mode, summary, questions_json, observations_json, artifact_json, critic_score_json, final_status, error, created_at
     FROM case_analysis_shadow_results
     WHERE case_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [caseId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapShadowRow(result.rows[0] as Record<string, unknown>);
};

export interface FleetAnalysisRunRow {
  id: string;
  case_id: string;
  status: AnalysisRunStatus;
  engine: AnalysisRunEngine;
  execution_mode: AnalysisExecutionMode;
  attention_reason: AttentionReason | null;
  attempt_count: number;
  latency_ms: number | null;
  model: string | null;
  error_message: string | null;
  completed_at: Date | null;
  created_at: Date;
}

export const listFleetAnalysisRuns = async (params: {
  attentionReason?: AttentionReason | null;
  limit?: number;
}): Promise<FleetAnalysisRunRow[]> => {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const attentionReason = params.attentionReason ?? null;

  const result = attentionReason
    ? await query(
        `SELECT ${ANALYSIS_RUN_SELECT_FIELDS}
         FROM case_analysis_runs
         WHERE attention_reason = $1
         ORDER BY COALESCE(completed_at, created_at) DESC
         LIMIT $2`,
        [attentionReason, limit]
      )
    : await query(
        `SELECT ${ANALYSIS_RUN_SELECT_FIELDS}
         FROM case_analysis_runs
         WHERE attention_reason IS NOT NULL
         ORDER BY COALESCE(completed_at, created_at) DESC
         LIMIT $1`,
        [limit]
      );

  return (result.rows as Array<Record<string, unknown>>).map((row) => {
    const mapped = mapAnalysisRunRow(row);
    return {
      id: mapped.id,
      case_id: mapped.case_id,
      status: mapped.status,
      engine: mapped.engine,
      execution_mode: mapped.execution_mode,
      attention_reason: mapped.attention_reason,
      attempt_count: mapped.attempt_count,
      latency_ms: mapped.latency_ms,
      model: mapped.model,
      error_message: mapped.error_message,
      completed_at: mapped.completed_at,
      created_at: mapped.created_at,
    };
  });
};
