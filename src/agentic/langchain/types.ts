import {
  AgenticAction,
  AgenticFinalArtifact,
  AgenticLoopState,
  AgenticRuntimeContext,
  AgenticTokenUsage,
} from '../core/types';

export interface LangChainRunResult {
  state: AgenticLoopState;
  history: Array<{
    step: number;
    action: AgenticAction;
    rationale: string;
    timestamp: string;
    usage?: AgenticTokenUsage;
  }>;
  artifact: AgenticFinalArtifact;
}

export interface LangChainAgentAdapter {
  run(context: AgenticRuntimeContext, initialState: AgenticLoopState): Promise<LangChainRunResult>;
}
