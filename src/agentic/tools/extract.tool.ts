import { isGroundingEnabled } from '../../config/grounding';
import { normalizeIntakeEntities } from '../../services/grounding/entityNormalization.service';
import logger from '../../utils/logger';
import { extractCaseReports } from '../../services/reportExtraction.service';
import { AgenticError, AgenticLoopState, AgenticRuntimeContext } from '../core/types';

export const extractReportsTool = async (
  context: AgenticRuntimeContext,
  state: AgenticLoopState
): Promise<AgenticLoopState> => {
  if (!state.intake) {
    throw new AgenticError('validation_error', 'Intake must be validated before extraction.');
  }

  let reports = state.reports;
  if (context.fixtures?.reports) {
    reports = context.fixtures.reports;
  } else {
    try {
      reports = await extractCaseReports(context.caseId, context.maxCharsPerFile, context.maxTotalChars, {
        runId: context.runId,
      });
    } catch (error) {
      if (error instanceof Error) {
        throw new AgenticError('extraction_error', error.message);
      }

      throw new AgenticError('extraction_error', 'Report extraction failed in agentic flow.');
    }
  }

  let normalizedEntities = state.normalizedEntities || null;
  if (isGroundingEnabled() && !normalizedEntities) {
    try {
      normalizedEntities = await normalizeIntakeEntities({
        currentMedications: state.intake.currentMedications || '',
        medicalHistory: state.intake.medicalHistory || '',
        symptoms: state.intake.symptoms || '',
        specialtyContext: state.intake.specialtyContext || '',
      });
    } catch (error) {
      logger.warn('Entity normalization during extract failed (fail-soft)', {
        message: error instanceof Error ? error.message : 'unknown',
      });
      normalizedEntities = { medications: [], conditions: [], evidenceTerms: [] };
    }
  }

  return {
    ...state,
    reports,
    normalizedEntities,
  };
};
