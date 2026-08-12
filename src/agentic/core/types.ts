import { CaseAnalysisArtifact } from '../../services/analysisArtifact.service';
import { CaseAnalysisResult, CaseIntakeData } from '../../services/analysis.service';
import {
  Citation,
  CitationLink,
  NormalizedEntities,
  TrialMatch,
} from '../../services/grounding/types';
import { ExtractedReport } from '../../services/reportExtraction.service';
import { AnalysisEvalFixtures } from '../../evals/analysisEvalFixtures';
import { AnalysisExecutionMode } from './executionMode';

/** @deprecated Use AnalysisExecutionMode instead. */
export type AgenticMode = AnalysisExecutionMode;
export type AgenticAction =
  | 'VALIDATE_INTAKE'
  | 'EXTRACT_REPORTS'
  | 'GROUND_EVIDENCE'
  | 'SYNTHESIZE_SUMMARY'
  | 'GUARD_QUESTIONS'
  | 'FINALIZE';

export type AgenticErrorCode =
  | 'policy_error'
  | 'validation_error'
  | 'extraction_error'
  | 'model_error'
  | 'persistence_error'
  | 'timeout_error'
  | 'unknown_error';

export type AgenticBudgetStopReason = 'step' | 'refinement' | 'wall_clock' | 'tokens' | 'cost';

export interface AgenticPolicy {
  allowedActions: AgenticAction[];
  maxSteps: number;
  maxRefinements: number;
  maxWallClockMs: number;
  maxTotalTokens: number;
  /** Null disables estimated-cost hard stop. */
  maxEstimatedCostUsd: number | null;
}

export interface AgenticTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AgenticCriticScore {
  passed: boolean;
  needsRefinement: boolean;
  score: number;
  reasons: string[];
  checks: {
    hasThreeQuestions: boolean;
    hasUniqueQuestions: boolean;
    hasObservations: boolean;
    hasCaveatLanguage: boolean;
  };
}

export interface AgenticFinalArtifact {
  summary: string;
  questions: string[];
  observations: string[];
  artifact: CaseAnalysisArtifact;
  model: string;
}

export interface AgenticLoopState {
  caseId: string;
  runId: string;
  mode: AnalysisExecutionMode;
  stepCount: number;
  refinementCount: number;
  criticFeedback: string | null;
  intake: CaseIntakeData | null;
  reports: ExtractedReport[];
  analysis: CaseAnalysisResult | null;
  observations: string[];
  finalArtifact: AgenticFinalArtifact | null;
  criticScore: AgenticCriticScore | null;
  /** Wall-clock start for run budget enforcement. */
  startedAtMs?: number;
  /** Cumulative planner + model token usage for mid-loop budgets. */
  runningTokenUsage?: AgenticTokenUsage;
  /** Accumulated synthesis/model token usage across refinements. */
  modelTokenUsageAccumulated?: AgenticTokenUsage;
  /** De-identified entities for external grounding APIs (SEC-206). */
  normalizedEntities?: NormalizedEntities | null;
  citations?: Citation[];
  trialMatches?: TrialMatch[];
  citationLinks?: CitationLink[];
  /** True after GROUND_EVIDENCE ran (or was skipped when grounding disabled). */
  groundingCompleted?: boolean;
}

export interface AgenticPlannerDecision {
  action: AgenticAction;
  rationale: string;
  usage?: AgenticTokenUsage;
}

export interface AgenticActionHistoryItem {
  step: number;
  action: AgenticAction;
  rationale: string;
  timestamp: string;
  usage?: AgenticTokenUsage;
}

export interface AgenticRuntimeContext {
  caseId: string;
  runId: string;
  mode: AnalysisExecutionMode;
  maxCharsPerFile: number;
  maxTotalChars: number;
  policy: AgenticPolicy;
  model: string;
  /** When set, intake/extract tools skip DB/disk and use these values. */
  fixtures?: AnalysisEvalFixtures;
  /** When false, skip DB event/artifact/shadow writes. Defaults to true. */
  persist?: boolean;
}

export interface AgenticErrorDetails {
  stepCount?: number;
  refinementCount?: number;
  actionSequence?: string[];
  agentsInvoked?: string[];
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  plannerPromptTokens?: number;
  plannerCompletionTokens?: number;
  modelPromptTokens?: number;
  modelCompletionTokens?: number;
  estimatedCostUsd?: number;
}

export class AgenticError extends Error {
  public readonly code: AgenticErrorCode;
  public readonly budgetStopReason?: AgenticBudgetStopReason;
  public readonly details?: AgenticErrorDetails;

  constructor(
    code: AgenticErrorCode,
    message: string,
    budgetStopReason?: AgenticBudgetStopReason,
    details?: AgenticErrorDetails
  ) {
    super(message);
    this.code = code;
    this.budgetStopReason = budgetStopReason;
    this.details = details;
    this.name = 'AgenticError';
  }
}

export const normalizeAgenticError = (error: unknown, fallbackCode: AgenticErrorCode): AgenticError => {
  if (error instanceof AgenticError) {
    return error;
  }

  if (error instanceof Error) {
    return new AgenticError(fallbackCode, error.message);
  }

  return new AgenticError(fallbackCode, 'Unknown agentic runtime error');
};
