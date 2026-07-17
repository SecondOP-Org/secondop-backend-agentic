import { AgentContext, AgentErrorCode, AgentStep, normalizeAgentError } from './agent.types';

interface AgentPipelineOptions<Output> {
  context: AgentContext;
  steps: AgentStep<Output, Output>[];
  initialState: Output;
  resolveErrorCode: (stepName: string) => AgentErrorCode;
  buildMetadata: (stepName: string, state: Output) => Record<string, unknown> | null;
  onStepCompleted?: (stepName: string, state: Output) => Promise<void>;
}

export const runAgentPipeline = async <Output>(options: AgentPipelineOptions<Output>): Promise<Output> => {
  let state = options.initialState;

  for (const step of options.steps) {
    const stepStartedAt = new Date();

    await options.context.emitEvent({
      stepName: step.name,
      stepStatus: 'started',
      startedAt: stepStartedAt,
    });

    try {
      state = await options.context.runWithinActiveStep(() => step.run(state, options.context));

      await options.context.emitEvent({
        stepName: step.name,
        stepStatus: 'completed',
        startedAt: stepStartedAt,
        completedAt: new Date(),
        metadata: options.buildMetadata(step.name, state),
      });

      if (options.onStepCompleted) {
        await options.onStepCompleted(step.name, state);
      }
    } catch (error) {
      const normalized = normalizeAgentError(error, options.resolveErrorCode(step.name));

      await options.context.emitEvent({
        stepName: step.name,
        stepStatus: 'failed',
        startedAt: stepStartedAt,
        completedAt: new Date(),
        metadata: options.buildMetadata(step.name, state),
        errorCode: normalized.code,
        errorMessage: normalized.message,
      });

      throw normalized;
    }
  }

  return state;
};
