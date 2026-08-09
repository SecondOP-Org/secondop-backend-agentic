import { AnalysisEvalFixtures } from '../../evals/analysisEvalFixtures';

export type AgentStepStatus = 'started' | 'completed' | 'failed';

export type AgentErrorCode =
  | 'validation_error'
  | 'extraction_error'
  | 'model_error'
  | 'persistence_error'
  | 'unknown_error';

export interface AgentEvent {
  stepName: string;
  stepStatus: AgentStepStatus;
  startedAt: Date;
  completedAt?: Date;
  metadata?: Record<string, unknown> | null;
  errorCode?: AgentErrorCode;
  errorMessage?: string;
}

export interface AgentContext {
  caseId: string;
  runId: string;
  maxCharsPerFile: number;
  maxTotalChars: number;
  /** When set, intake/extract agents skip DB/disk and use these values. */
  fixtures?: AnalysisEvalFixtures;
  /** When false, skip DB event/artifact/result writes. Defaults to true. */
  persist?: boolean;
  emitEvent: (event: AgentEvent) => Promise<void>;
  /** Nest LLM/tool child spans under the currently started baseline step span. */
  runWithinActiveStep: <T>(fn: () => Promise<T>) => Promise<T>;
}

export interface AgentStep<Input, Output> {
  name: string;
  run: (input: Input, context: AgentContext) => Promise<Output>;
}

export class AgentError extends Error {
  public readonly code: AgentErrorCode;

  constructor(code: AgentErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'AgentError';
  }
}

export const normalizeAgentError = (error: unknown, fallbackCode: AgentErrorCode): AgentError => {
  if (error instanceof AgentError) {
    return error;
  }

  if (error instanceof Error) {
    return new AgentError(fallbackCode, error.message);
  }

  return new AgentError(fallbackCode, 'Unknown agent error');
};
