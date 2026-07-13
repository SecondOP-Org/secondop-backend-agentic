import {
  extractObservationsFromSummary,
  generateCaseAnalysis,
} from '../../services/analysis.service';
import { AgentContext, AgentError, AgentStep } from '../core/agent.types';
import { CaseAnalysisPipelineState } from './case-analysis.types';

export class ClinicalSynthesisAgent implements AgentStep<CaseAnalysisPipelineState, CaseAnalysisPipelineState> {
  public readonly name = 'clinical-synthesis';

  public async run(
    input: CaseAnalysisPipelineState,
    context: AgentContext
  ): Promise<CaseAnalysisPipelineState> {
    if (!input.intake) {
      throw new AgentError('validation_error', 'Intake must be available before synthesis.');
    }

    if (!input.reports || input.reports.length === 0) {
      throw new AgentError('validation_error', 'At least one extracted report is required for synthesis.');
    }

    try {
      const analysis = await generateCaseAnalysis(input.intake, input.reports, undefined, undefined, {
        runId: context.runId,
      });
      const observations = extractObservationsFromSummary(analysis.summary);

      return {
        ...input,
        analysis,
        observations,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new AgentError('model_error', error.message);
      }

      throw new AgentError('model_error', 'Clinical synthesis failed.');
    }
  }
}
