import { extractCaseReports } from '../../services/reportExtraction.service';
import { AgenticError, AgenticLoopState, AgenticRuntimeContext } from '../core/types';

export const extractReportsTool = async (
  context: AgenticRuntimeContext,
  state: AgenticLoopState
): Promise<AgenticLoopState> => {
  if (!state.intake) {
    throw new AgenticError('validation_error', 'Intake must be validated before extraction.');
  }

  if (context.fixtures?.reports) {
    return {
      ...state,
      reports: context.fixtures.reports,
    };
  }

  try {
    const reports = await extractCaseReports(context.caseId, context.maxCharsPerFile, context.maxTotalChars, {
      runId: context.runId,
    });

    return {
      ...state,
      reports,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new AgenticError('extraction_error', error.message);
    }

    throw new AgenticError('extraction_error', 'Report extraction failed in agentic flow.');
  }
};
