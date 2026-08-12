import { AgenticActionHistoryItem, AgenticLoopState } from '../core/types';
import { emptyTokenUsage } from '../core/policy';

export interface AgenticRunMetrics {
  stepCount: number;
  refinementCount: number;
  actionSequence: string[];
  agentsInvoked: string[];
  observationCount: number;
  questionCount: number;
  modelTokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  plannerTokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  totalTokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export const buildAgenticRunMetrics = (
  state: AgenticLoopState,
  history: AgenticActionHistoryItem[]
): AgenticRunMetrics => {
  const plannerTokenUsage = history.reduce(
    (acc, item) => {
      acc.promptTokens += item.usage?.promptTokens || 0;
      acc.completionTokens += item.usage?.completionTokens || 0;
      acc.totalTokens += item.usage?.totalTokens || 0;
      return acc;
    },
    emptyTokenUsage()
  );

  const modelTokenUsage = state.modelTokenUsageAccumulated || {
    promptTokens: state.analysis?.usage?.promptTokens || 0,
    completionTokens: state.analysis?.usage?.completionTokens || 0,
    totalTokens: state.analysis?.usage?.totalTokens || 0,
  };

  const totalFromRunning = state.runningTokenUsage;
  const totalTokenUsage = totalFromRunning || {
    promptTokens: modelTokenUsage.promptTokens + plannerTokenUsage.promptTokens,
    completionTokens: modelTokenUsage.completionTokens + plannerTokenUsage.completionTokens,
    totalTokens: modelTokenUsage.totalTokens + plannerTokenUsage.totalTokens,
  };

  const agentsInvoked = ['planner'];
  if (history.some((item) => item.action === 'FINALIZE')) {
    agentsInvoked.push('finalizer', 'critic');
  }

  return {
    stepCount: state.stepCount,
    refinementCount: state.refinementCount,
    actionSequence: history.map((item) => item.action),
    agentsInvoked,
    observationCount: state.observations.length,
    questionCount: state.analysis?.topQuestions.length || 0,
    modelTokenUsage,
    plannerTokenUsage,
    totalTokenUsage,
  };
};
