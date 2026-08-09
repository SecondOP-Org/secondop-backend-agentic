import { createShadowResult } from '../../services/analysisRun.service';
import { AgenticError, AgenticFinalArtifact, AgenticLoopState, AgenticRuntimeContext } from '../core/types';

interface PersistShadowInput {
  context: AgenticRuntimeContext;
  state: AgenticLoopState;
  artifact: AgenticFinalArtifact;
  finalStatus: 'succeeded' | 'failed';
  error?: string;
}

export const persistShadowTool = async (input: PersistShadowInput): Promise<void> => {
  if (input.context.persist === false) {
    return;
  }

  try {
    await createShadowResult({
      caseId: input.context.caseId,
      runId: input.context.runId,
      mode: input.context.mode,
      summary: input.artifact.summary,
      questions: input.artifact.questions,
      observations: input.artifact.observations,
      artifact: input.artifact.artifact,
      criticScore: input.state.criticScore,
      finalStatus: input.finalStatus,
      error: input.error,
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new AgenticError('persistence_error', error.message);
    }

    throw new AgenticError('persistence_error', 'Unable to persist agentic shadow result.');
  }
};
