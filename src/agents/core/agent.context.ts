import { insertAnalysisEvent } from '../../services/analysisRun.service';
import { SpanHandle, startPhoenixSpan } from '../../observability/phoenix.service';
import { AgentContext, AgentEvent } from './agent.types';
import { AnalysisEvalFixtures, shouldPersistAnalysisSideEffects } from '../../evals/analysisEvalFixtures';

import { AnalysisExecutionMode, toLegacyExecutionMode } from '../../agentic/core/executionMode';

interface CreateAgentContextOptions {
  caseId: string;
  runId: string;
  maxCharsPerFile: number;
  maxTotalChars: number;
  executionMode: AnalysisExecutionMode;
  fixtures?: AnalysisEvalFixtures;
  persist?: boolean;
}

export const createAgentContext = (options: CreateAgentContextOptions): AgentContext => {
  const stepSpanMap = new Map<string, SpanHandle>();
  let activeStepKey: string | null = null;
  const persist = shouldPersistAnalysisSideEffects(options.persist);

  const emitEvent = async (event: AgentEvent): Promise<void> => {
    const stepSpanKey = `${event.stepName}:${event.startedAt.toISOString()}`;
    if (event.stepStatus === 'started') {
      const span = startPhoenixSpan(
        `baseline.step.${event.stepName}`,
        {
          caseId: options.caseId,
          runId: options.runId,
          mode: options.executionMode,
          executionMode: options.executionMode,
          step: event.stepName,
          rationale: event.metadata?.rationale ?? null,
          plannerTokenUsage: event.metadata?.plannerTokenUsage ?? null,
        },
        // Pipeline steps are tools; synthesis/final persist remain AGENT-ish via name.
        event.stepName === 'clinical-synthesis' || event.stepName === 'persist-results' ? 'AGENT' : 'TOOL'
      );
      stepSpanMap.set(stepSpanKey, span);
      activeStepKey = stepSpanKey;
    }

    const errorText =
      event.stepStatus === 'failed' && event.errorMessage
        ? `[${event.errorCode || 'unknown_error'}] ${event.errorMessage}`
        : null;

    const metadata: Record<string, unknown> = {
      engine: 'baseline',
      executionMode: options.executionMode,
      legacyExecutionMode: toLegacyExecutionMode(options.executionMode),
      caseId: options.caseId,
      runId: options.runId,
      mode: options.executionMode,
      ...(event.metadata || {}),
    };

    if (event.errorCode) {
      metadata.errorCode = event.errorCode;
    }

    const span = stepSpanMap.get(stepSpanKey);
    if (span) {
      span.addAttributes(metadata);
      if (event.stepStatus !== 'started') {
        span.end(event.stepStatus === 'failed' ? 'ERROR' : 'OK', event.errorMessage);
        stepSpanMap.delete(stepSpanKey);
        if (activeStepKey === stepSpanKey) {
          activeStepKey = null;
        }
      }
    }

    if (!persist) {
      return;
    }

    await insertAnalysisEvent({
      runId: options.runId,
      caseId: options.caseId,
      stepName: event.stepName,
      stepStatus: event.stepStatus,
      startedAt: event.startedAt,
      completedAt: event.completedAt,
      metadata,
      errorText,
    });
  };

  const runWithinActiveStep = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (!activeStepKey) {
      return fn();
    }
    const span = stepSpanMap.get(activeStepKey);
    if (!span) {
      return fn();
    }
    return span.run(fn);
  };

  return {
    caseId: options.caseId,
    runId: options.runId,
    maxCharsPerFile: options.maxCharsPerFile,
    maxTotalChars: options.maxTotalChars,
    fixtures: options.fixtures,
    persist: options.persist,
    emitEvent,
    runWithinActiveStep,
  };
};
