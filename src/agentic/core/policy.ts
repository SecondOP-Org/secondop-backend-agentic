import { isGroundingEnabled } from '../../config/grounding';
import { AgenticAction, AgenticError, AgenticPolicy } from './types';
import { AnalysisExecutionMode, resolveExecutionMode } from './executionMode';

export { resolveExecutionMode, normalizeExecutionMode, toLegacyExecutionMode, isAgenticPrimaryMode, shouldRunShadowAgentic } from './executionMode';
export type { AnalysisExecutionMode, LegacyAnalysisExecutionMode } from './executionMode';

/** @deprecated Use resolveExecutionMode instead. */
export const resolveAgenticMode = (): AnalysisExecutionMode => resolveExecutionMode();

export const buildAgenticPolicy = (): AgenticPolicy => {
  const maxSteps = Math.max(1, parseInt(process.env.AGENTIC_MAX_STEPS || '10', 10));
  const maxRefinements = Math.max(0, parseInt(process.env.AGENTIC_MAX_REFINEMENTS || '1', 10));

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
  };
};

export const assertActionAllowed = (policy: AgenticPolicy, action: string): AgenticAction => {
  if (!policy.allowedActions.includes(action as AgenticAction)) {
    throw new AgenticError('policy_error', `Planner selected disallowed action: ${action}`);
  }

  return action as AgenticAction;
};

export const assertStepBudget = (policy: AgenticPolicy, stepCount: number): void => {
  if (stepCount > policy.maxSteps) {
    throw new AgenticError('timeout_error', `Agentic loop exceeded step budget (${policy.maxSteps}).`);
  }
};

export const assertRefinementBudget = (policy: AgenticPolicy, refinementCount: number): void => {
  if (refinementCount > policy.maxRefinements) {
    throw new AgenticError('policy_error', `Agentic loop exceeded refinement budget (${policy.maxRefinements}).`);
  }
};
