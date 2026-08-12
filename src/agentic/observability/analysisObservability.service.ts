import { query } from '../../database/connection';
import { normalizeExecutionMode, toLegacyExecutionMode } from '../core/executionMode';
import { listArtifactsByRunId } from '../../services/caseAnalysisRunArtifact.service';
import { buildAgenticPolicy } from '../core/policy';

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

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
    } catch {
      return [];
    }
  }
  return [];
};

const usageTotal = (usage: unknown): number | null => {
  const safe = (usage || {}) as { totalTokens?: unknown; promptTokens?: unknown; completionTokens?: unknown };
  const total = Number(safe.totalTokens);
  if (Number.isFinite(total) && total > 0) {
    return total;
  }
  const prompt = Number(safe.promptTokens || 0);
  const completion = Number(safe.completionTokens || 0);
  const sum = prompt + completion;
  return sum > 0 ? sum : null;
};

type ActionCatalogEntry = {
  action: string;
  actionLabel: string;
  decidedBy: string;
  tool: string;
  executedBy: string;
  agents: string[];
};

const AGENTIC_ACTION_CATALOG: Record<string, ActionCatalogEntry> = {
  validate_intake: {
    action: 'VALIDATE_INTAKE',
    actionLabel: 'Validate intake',
    decidedBy: 'Planner',
    tool: 'Intake validation',
    executedBy: 'Intake validation tool',
    agents: ['Planner'],
  },
  extract_reports: {
    action: 'EXTRACT_REPORTS',
    actionLabel: 'Extract reports',
    decidedBy: 'Planner',
    tool: 'Report extraction',
    executedBy: 'Report extraction tool',
    agents: ['Planner'],
  },
  ground_evidence: {
    action: 'GROUND_EVIDENCE',
    actionLabel: 'Ground evidence',
    decidedBy: 'Planner',
    tool: 'Evidence grounding',
    executedBy: 'Evidence grounding tool',
    agents: ['Planner'],
  },
  synthesize_summary: {
    action: 'SYNTHESIZE_SUMMARY',
    actionLabel: 'Synthesize summary',
    decidedBy: 'Planner',
    tool: 'Clinical synthesis',
    executedBy: 'Clinical synthesis tool',
    agents: ['Planner'],
  },
  guard_questions: {
    action: 'GUARD_QUESTIONS',
    actionLabel: 'Guard questions',
    decidedBy: 'Planner',
    tool: 'Question guard',
    executedBy: 'Question guard tool',
    agents: ['Planner'],
  },
  finalize: {
    action: 'FINALIZE',
    actionLabel: 'Finalize + critic check',
    decidedBy: 'Planner',
    tool: '—',
    executedBy: 'Finalizer, Critic',
    agents: ['Planner', 'Finalizer', 'Critic'],
  },
};

const BASELINE_STEP_CATALOG: Record<string, ActionCatalogEntry> = {
  'intake-validation': {
    action: 'INTAKE_VALIDATION',
    actionLabel: 'Validate intake',
    decidedBy: 'Baseline pipeline',
    tool: 'Intake validation',
    executedBy: 'IntakeValidationAgent',
    agents: ['IntakeValidationAgent'],
  },
  'report-extraction': {
    action: 'REPORT_EXTRACTION',
    actionLabel: 'Extract reports',
    decidedBy: 'Baseline pipeline',
    tool: 'Report extraction',
    executedBy: 'ReportExtractionAgent',
    agents: ['ReportExtractionAgent'],
  },
  'clinical-synthesis': {
    action: 'CLINICAL_SYNTHESIS',
    actionLabel: 'Synthesize summary',
    decidedBy: 'Baseline pipeline',
    tool: 'Clinical synthesis',
    executedBy: 'ClinicalSynthesisAgent',
    agents: ['ClinicalSynthesisAgent'],
  },
  'question-guard': {
    action: 'QUESTION_GUARD',
    actionLabel: 'Guard questions',
    decidedBy: 'Baseline pipeline',
    tool: 'Question guard',
    executedBy: 'QuestionGuardAgent',
    agents: ['QuestionGuardAgent'],
  },
  'persist-results': {
    action: 'PERSIST_RESULTS',
    actionLabel: 'Persist results',
    decidedBy: 'Baseline pipeline',
    tool: 'Persist results',
    executedBy: 'PersistResultsAgent',
    agents: ['PersistResultsAgent'],
  },
};

const resolveCatalogEntry = (stepName: string): ActionCatalogEntry => {
  const normalized = stepName.trim().toLowerCase();
  if (normalized.startsWith('agentic:')) {
    const actionKey = normalized.slice('agentic:'.length);
    return (
      AGENTIC_ACTION_CATALOG[actionKey] || {
        action: actionKey.toUpperCase(),
        actionLabel: actionKey.replace(/_/g, ' '),
        decidedBy: 'Planner',
        tool: actionKey,
        executedBy: actionKey,
        agents: ['Planner'],
      }
    );
  }

  return (
    BASELINE_STEP_CATALOG[normalized] || {
      action: normalized.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
      actionLabel: stepName,
      decidedBy: 'Pipeline',
      tool: stepName,
      executedBy: stepName,
      agents: [],
    }
  );
};

export const buildStepTimeline = (
  events: Array<Record<string, unknown>>
): Array<{
  id: string;
  step: number | null;
  refinement: number | null;
  decidedBy: string;
  agents: string[];
  action: string;
  actionLabel: string;
  tool: string;
  executedBy: string;
  status: string;
  plannerTokens: number | null;
  modelTokens: number | null;
  rationale: string | null;
  budgetStopReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  rawStepName: string;
}> => {
  const terminal = events.filter((row) => {
    const status = String(row.step_status || '');
    return status === 'completed' || status === 'failed';
  });

  const source = terminal.length > 0 ? terminal : events;

  return source.map((row, index) => {
    const metadata = coerceMetadata(row.metadata_json);
    const stepName = String(row.step_name || '');
    const catalog = resolveCatalogEntry(stepName);
    const step =
      metadata.step == null || metadata.step === ''
        ? index + 1
        : Number(metadata.step);
    const refinement =
      metadata.refinement == null || metadata.refinement === ''
        ? null
        : Number(metadata.refinement);

    return {
      id: String(row.id || `${stepName}-${index}`),
      step: Number.isFinite(step) ? step : index + 1,
      refinement: refinement != null && Number.isFinite(refinement) ? refinement : null,
      decidedBy: catalog.decidedBy,
      agents: catalog.agents,
      action: catalog.action,
      actionLabel: catalog.actionLabel,
      tool: catalog.tool,
      executedBy: catalog.executedBy,
      status: String(row.step_status || ''),
      plannerTokens: usageTotal(metadata.plannerTokenUsage),
      modelTokens: usageTotal(metadata.modelTokenUsage),
      rationale: typeof metadata.rationale === 'string' ? metadata.rationale : null,
      budgetStopReason:
        typeof metadata.budgetStopReason === 'string' ? metadata.budgetStopReason : null,
      startedAt: row.started_at ? String(row.started_at) : null,
      completedAt: row.completed_at ? String(row.completed_at) : null,
      error: typeof row.error_text === 'string' ? row.error_text : null,
      rawStepName: stepName,
    };
  });
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

const buildRunSummary = (row: Record<string, unknown> | undefined, policy = buildAgenticPolicy()) => {
  if (!row) {
    return null;
  }

  return {
    runId: String(row.id),
    status: String(row.status || ''),
    engine: String(row.engine || ''),
    executionMode: normalizeExecutionMode(String(row.execution_mode || 'baseline')),
    agentsInvoked: toStringArray(row.agents_invoked),
    actionSequence: toStringArray(row.action_sequence),
    stepCount: row.step_count == null ? null : Number(row.step_count),
    refinementCount: row.refinement_count == null ? null : Number(row.refinement_count),
    latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
    estimatedCostUsd: row.estimated_cost_usd == null ? null : Number(row.estimated_cost_usd),
    promptTokens: row.prompt_tokens == null ? null : Number(row.prompt_tokens),
    completionTokens: row.completion_tokens == null ? null : Number(row.completion_tokens),
    totalTokens: row.total_tokens == null ? null : Number(row.total_tokens),
    plannerPromptTokens: row.planner_prompt_tokens == null ? null : Number(row.planner_prompt_tokens),
    plannerCompletionTokens:
      row.planner_completion_tokens == null ? null : Number(row.planner_completion_tokens),
    modelPromptTokens: row.model_prompt_tokens == null ? null : Number(row.model_prompt_tokens),
    modelCompletionTokens:
      row.model_completion_tokens == null ? null : Number(row.model_completion_tokens),
    budgetStopReason: typeof row.budget_stop_reason === 'string' ? row.budget_stop_reason : null,
    budgets: {
      maxSteps: policy.maxSteps,
      maxRefinements: policy.maxRefinements,
      maxWallClockMs: policy.maxWallClockMs,
      maxTotalTokens: policy.maxTotalTokens,
      maxEstimatedCostUsd: policy.maxEstimatedCostUsd,
    },
  };
};

export const getCaseRunTrace = async (caseId: string, runId?: string) => {
  const runsResult = await query(
    `SELECT id, case_id, status, engine, execution_mode, started_at, completed_at, model, error, error_message,
            pipeline_version, model_version, prompt_version, latency_ms, prompt_tokens, completion_tokens,
            total_tokens, estimated_cost_usd, attempt_count, attention_reason,
            step_count, refinement_count, action_sequence, agents_invoked,
            planner_prompt_tokens, planner_completion_tokens, model_prompt_tokens, model_completion_tokens,
            budget_stop_reason, created_at
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
  const selectedRunRow = (runsResult.rows as Array<Record<string, unknown>>).find(
    (row) => String(row.id) === String(selectedRunId)
  );

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
    runSummary: buildRunSummary(selectedRunRow),
    stepTimeline: buildStepTimeline(eventsResult.rows as Array<Record<string, unknown>>),
  };
};
