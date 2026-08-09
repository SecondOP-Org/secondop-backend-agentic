import { extractObservationsFromSummary, generateCaseAnalysis } from '../../services/analysis.service';
import { attachGroundingToArtifact } from '../../services/grounding/attachGrounding';
import { AgenticError, AgenticLoopState, AgenticRuntimeContext } from '../core/types';

export const synthesizeSummaryTool = async (
  context: AgenticRuntimeContext,
  state: AgenticLoopState
): Promise<AgenticLoopState> => {
  if (!state.intake) {
    throw new AgenticError('validation_error', 'Intake is required for synthesis.');
  }

  if (!state.reports.length) {
    throw new AgenticError('validation_error', 'Extracted reports are required for synthesis.');
  }

  try {
    const guidance = state.criticFeedback
      ? `Critic feedback to address before finalizing: ${state.criticFeedback}`
      : undefined;

    const analysis = await generateCaseAnalysis(state.intake, state.reports, guidance, context.model, {
      runId: context.runId,
    });

    const artifact = attachGroundingToArtifact(analysis.artifact, {
      citations: state.citations || [],
      trialMatches: state.trialMatches || [],
      citationLinks: state.citationLinks,
    });

    return {
      ...state,
      analysis: {
        ...analysis,
        artifact,
      },
      observations: extractObservationsFromSummary(analysis.summary),
      finalArtifact: null,
      criticScore: null,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new AgenticError('model_error', error.message);
    }

    throw new AgenticError('model_error', 'Synthesis failed in agentic flow.');
  }
};
