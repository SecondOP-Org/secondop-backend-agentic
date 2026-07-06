import { insertAnalysisEvent } from '../../services/analysisRun.service';
import { SpanHandle, startPhoenixSpan } from '../../observability/phoenix.service';
import { AgentContext, AgentEvent } from './agent.types';

import { AnalysisExecutionMode, toLegacyExecutionMode } from '../../agentic/core/executionMode';

interface CreateAgentContextOptions {
  caseId: string;
  runId: string;
  maxCharsPerFile: number;
  maxTotalChars: number;
  executionMode: AnalysisExecutionMode;
}

export const createAgentContext = (options: CreateAgentContextOptions): AgentContext => {
  const stepSpanMap = new Map<string, SpanHandle>();

  const emitEvent = async (event: AgentEvent): Promise<void> => {
    const stepSpanKey = `${event.stepName}:${event.startedAt.toISOString()}`;
    if (event.stepStatus === 'started') {
      const span = startPhoenixSpan(`baseline.step.${event.stepName}`, {
        caseId: options.caseId,
        runId: options.runId,
        executionMode: options.executionMode,
      });
      stepSpanMap.set(stepSpanKey, span);
    }

    const errorText =
      event.stepStatus === 'failed' && event.errorMessage
        ? `[${event.errorCode || 'unknown_error'}] ${event.errorMessage}`
        : null;

    const metadata: Record<string, unknown> = {
      engine: 'baseline',
      executionMode: options.executionMode,
      legacyExecutionMode: toLegacyExecutionMode(options.executionMode),
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
      }
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

  return {
    caseId: options.caseId,
    runId: options.runId,
    maxCharsPerFile: options.maxCharsPerFile,
    maxTotalChars: options.maxTotalChars,
    emitEvent,
  };
};
