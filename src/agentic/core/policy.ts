import { isGroundingEnabled } from '../../config/grounding';
import { estimateTokenCostUsd } from '../../observability/phoenix.service';
import {
  AgenticAction,
  AgenticBudgetStopReason,
  AgenticError,
  AgenticPolicy,
  AgenticTokenUsage,
} from './types';
import { AnalysisExecutionMode, resolveExecutionMode } from './executionMode';

export { resolveExecutionMode, normalizeExecutionMode, toLegacyExecutionMode, isAgenticPrimaryMode, shouldRunShadowAgentic } from './executionMode';
export type { AnalysisExecutionMode, LegacyAnalysisExecutionMode } from './executionMode';

/** @deprecated Use resolveExecutionMode instead. */
export const resolveAgenticMode = (): AnalysisExecutionMode => resolveExecutionMode();

const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
  const parsed = parseInt(raw || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const parseOptionalPositiveNumber = (raw: string | undefined): number | null => {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export const emptyTokenUsage = (): AgenticTokenUsage => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
});

export const addTokenUsage = (
  target: AgenticTokenUsage,
  addition: AgenticTokenUsage | null | undefined
): AgenticTokenUsage => {
  if (!addition) {
    return target;
  }

  return {
    promptTokens: target.promptTokens + (addition.promptTokens || 0),
    completionTokens: target.completionTokens + (addition.completionTokens || 0),
    totalTokens: target.totalTokens + (addition.totalTokens || 0),
  };
};

export const buildAgenticPolicy = (): AgenticPolicy => {
  // Happy path ~5 steps; 8 leaves room for one critic refinement cycle.
  const maxSteps = Math.max(1, parsePositiveInt(process.env.AGENTIC_MAX_STEPS, 8));
  const maxRefinements = Math.max(0, parsePositiveInt(process.env.AGENTIC_MAX_REFINEMENTS, 1));
  const maxWallClockMs = Math.max(1000, parsePositiveInt(process.env.AGENTIC_MAX_WALL_CLOCK_MS, 120000));
  const maxTotalTokens = Math.max(1, parsePositiveInt(process.env.AGENTIC_MAX_TOTAL_TOKENS, 40000));
  // Empty / unset disables cost hard-stop; default 0.25 when set via example/runbook.
  const maxEstimatedCostUsd =
    parseOptionalPositiveNumber(process.env.AGENTIC_MAX_ESTIMATED_COST_USD) ?? 0.25;

  const allowedActions: AgenticAction[] = [
    'VALIDATE_INTAKE',
    'EXTRACT_REPORTS',
    ...(isGroundingEnabled() ? (['GROUND_EVIDENCE'] as AgenticAction[]) : []),
    'SYNTHESIZE_SUMMARY',
    'GUARD_QUESTIONS',
    'FINALIZE',
  ];

  return {
    allowedActions,
    maxSteps,
    maxRefinements,
    maxWallClockMs,
    maxTotalTokens,
    maxEstimatedCostUsd,
  };
};

export const budgetError = (reason: AgenticBudgetStopReason, message: string): AgenticError => {
  const code = reason === 'wall_clock' || reason === 'step' ? 'timeout_error' : 'policy_error';
  return new AgenticError(code, message, reason);
};

export const assertActionAllowed = (policy: AgenticPolicy, action: string): AgenticAction => {
  if (!policy.allowedActions.includes(action as AgenticAction)) {
    throw new AgenticError('policy_error', `Planner selected disallowed action: ${action}`);
  }

  return action as AgenticAction;
};

export const assertStepBudget = (policy: AgenticPolicy, stepCount: number): void => {
  if (stepCount > policy.maxSteps) {
    throw budgetError('step', `Agentic loop exceeded step budget (${policy.maxSteps}).`);
  }
};

export const assertRefinementBudget = (policy: AgenticPolicy, refinementCount: number): void => {
  if (refinementCount > policy.maxRefinements) {
    throw budgetError(
      'refinement',
      `Agentic loop exceeded refinement budget (${policy.maxRefinements}).`
    );
  }
};

export const assertWallClockBudget = (policy: AgenticPolicy, startedAtMs: number): void => {
  const elapsed = Date.now() - startedAtMs;
  if (elapsed > policy.maxWallClockMs) {
    throw budgetError(
      'wall_clock',
      `Agentic loop exceeded wall-clock budget (${policy.maxWallClockMs}ms).`
    );
  }
};

export const assertTokenBudget = (policy: AgenticPolicy, totalTokens: number): void => {
  if (totalTokens > policy.maxTotalTokens) {
    throw budgetError(
      'tokens',
      `Agentic loop exceeded token budget (${policy.maxTotalTokens}).`
    );
  }
};

export const assertCostBudget = (policy: AgenticPolicy, usage: AgenticTokenUsage): void => {
  if (policy.maxEstimatedCostUsd == null) {
    return;
  }

  const estimatedCostUsd = estimateTokenCostUsd(usage.promptTokens, usage.completionTokens);
  if (estimatedCostUsd > policy.maxEstimatedCostUsd) {
    throw budgetError(
      'cost',
      `Agentic loop exceeded estimated cost budget ($${policy.maxEstimatedCostUsd}).`
    );
  }
};

export const assertResourceBudgets = (
  policy: AgenticPolicy,
  startedAtMs: number,
  runningUsage: AgenticTokenUsage
): void => {
  assertWallClockBudget(policy, startedAtMs);
  assertTokenBudget(policy, runningUsage.totalTokens);
  assertCostBudget(policy, runningUsage);
};
