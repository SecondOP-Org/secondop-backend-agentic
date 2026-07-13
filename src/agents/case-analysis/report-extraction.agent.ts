import { extractCaseReports } from '../../services/reportExtraction.service';
import { AgentContext, AgentError, AgentStep } from '../core/agent.types';
import { CaseAnalysisPipelineState } from './case-analysis.types';

export class ReportExtractionAgent implements AgentStep<CaseAnalysisPipelineState, CaseAnalysisPipelineState> {
  public readonly name = 'report-extraction';

  public async run(input: CaseAnalysisPipelineState, context: AgentContext): Promise<CaseAnalysisPipelineState> {
    if (!input.intake) {
      throw new AgentError('validation_error', 'Intake must be available before report extraction.');
    }

    try {
      const reports = await extractCaseReports(context.caseId, context.maxCharsPerFile, context.maxTotalChars, {
      runId: context.runId,
    });

      return {
        ...input,
        reports,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new AgentError('extraction_error', error.message);
      }

      throw new AgentError('extraction_error', 'Report extraction failed.');
    }
  }
}
