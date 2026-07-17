import { insertAnalysisEvent } from '../../services/analysisRun.service';
import { PhoenixSpanKind, SpanHandle, startPhoenixSpan } from '../../observability/phoenix.service';
import { AgenticAction, AgenticRuntimeContext } from '../core/types';

interface EmitStepInput {
  context: AgenticRuntimeContext;
  stepName: string;
  stepStatus: 'started' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  metadata?: Record<string, unknown> | null;
  errorText?: string | null;
  eventKey?: string;
}

const stepSpanMap = new Map<string, SpanHandle>();

const resolveStepKind = (stepName: string): PhoenixSpanKind => {
  const normalized = stepName.toLowerCase();
  if (normalized.includes('finalize') || normalized.includes('planner')) {
    return 'AGENT';
  }
  return 'TOOL';
};

const buildStepSpanKey = (input: EmitStepInput): string =>
  input.eventKey || `${input.stepName}:${input.startedAt.toISOString()}`;

export const runWithinAgenticStepSpan = async <T>(
  input: Pick<EmitStepInput, 'stepName' | 'startedAt' | 'eventKey'>,
  fn: () => Promise<T>
): Promise<T> => {
  const key = input.eventKey || `${input.stepName}:${input.startedAt.toISOString()}`;
  const span = stepSpanMap.get(key);
  if (!span) {
    return fn();
  }
  return span.run(fn);
};

export const emitAgenticStepEvent = async (input: EmitStepInput): Promise<void> => {
  const key = buildStepSpanKey(input);

  if (input.stepStatus === 'started') {
    const span = startPhoenixSpan(
      `agentic.step.${input.stepName}`,
      {
        caseId: input.context.caseId,
        runId: input.context.runId,
        mode: input.context.mode,
        step: input.metadata?.step ?? null,
        refinement: input.metadata?.refinement ?? null,
        rationale: input.metadata?.rationale ?? null,
        plannerTokenUsage: input.metadata?.plannerTokenUsage ?? null,
      },
      resolveStepKind(input.stepName)
    );
    stepSpanMap.set(key, span);
  }

  const metadata = {
    engine: 'agentic',
    mode: input.context.mode,
    caseId: input.context.caseId,
    runId: input.context.runId,
    ...(input.metadata || {}),
  };

  const span = stepSpanMap.get(key);
  if (span) {
    span.addAttributes(metadata);
    if (input.stepStatus !== 'started') {
      span.end(input.stepStatus === 'failed' ? 'ERROR' : 'OK', input.errorText || undefined);
      stepSpanMap.delete(key);
    }
  }

  await insertAnalysisEvent({
    runId: input.context.runId,
    caseId: input.context.caseId,
    stepName: input.stepName,
    stepStatus: input.stepStatus,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    metadata,
    errorText: input.errorText,
  });
};

/** @deprecated unused helper retained for call-site clarity */
export type { AgenticAction };
