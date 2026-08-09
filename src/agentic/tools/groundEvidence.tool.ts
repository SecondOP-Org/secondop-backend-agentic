import { listRegisteredGroundingTools, type GroundingToolName } from '../../config/grounding';
import { isGroundingEnabled } from '../../config/grounding';
import logger from '../../utils/logger';
import { normalizeIntakeEntities } from '../../services/grounding/entityNormalization.service';
import { AgenticError, AgenticLoopState, AgenticRuntimeContext } from '../core/types';
import { clinicalTrialsTool } from './clinicalTrials.tool';
import { pubmedTool } from './pubmed.tool';

export { listRegisteredGroundingTools };
export type { GroundingToolName };

/**
 * GROUND_EVIDENCE pipeline step: normalize entities (if needed) + call registered grounding tools.
 * Fail-soft: never throws for external API failures.
 */
export const groundEvidenceTool = async (
  context: AgenticRuntimeContext,
  state: AgenticLoopState
): Promise<AgenticLoopState> => {
  if (!isGroundingEnabled()) {
    return {
      ...state,
      groundingCompleted: true,
      citations: state.citations || [],
      trialMatches: state.trialMatches || [],
    };
  }

  if (!state.intake) {
    throw new AgenticError('validation_error', 'Intake is required before grounding.');
  }

  let normalizedEntities = state.normalizedEntities;
  if (!normalizedEntities) {
    try {
      normalizedEntities = await normalizeIntakeEntities({
        currentMedications: state.intake.currentMedications || '',
        medicalHistory: state.intake.medicalHistory || '',
        symptoms: state.intake.symptoms || '',
        specialtyContext: state.intake.specialtyContext || '',
      });
    } catch (error) {
      logger.warn('Entity normalization in groundEvidenceTool failed (fail-soft)', {
        message: error instanceof Error ? error.message : 'unknown',
      });
      normalizedEntities = { medications: [], conditions: [], evidenceTerms: [] };
    }
  }

  const nextState: AgenticLoopState = {
    ...state,
    normalizedEntities,
  };

  const registered = listRegisteredGroundingTools({
    specialtyContext: state.intake.specialtyContext || '',
  });

  let citations = state.citations || [];
  let trialMatches = state.trialMatches || [];

  if (registered.includes('pubmed')) {
    const pubmedResult = await pubmedTool(context, nextState);
    citations = pubmedResult.citations;
  }

  if (registered.includes('clinicalTrials')) {
    const trialsResult = await clinicalTrialsTool(context, nextState);
    trialMatches = trialsResult.trialMatches;
  }

  return {
    ...nextState,
    citations,
    trialMatches,
    groundingCompleted: true,
  };
};
