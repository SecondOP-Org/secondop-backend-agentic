import { query } from '../../database/connection';
import { markAnalysisRunSucceeded } from '../../services/analysisRun.service';
import { AgentContext, AgentError, AgentStep } from '../core/agent.types';
import { CaseAnalysisPipelineState } from './case-analysis.types';

export class PersistResultsAgent implements AgentStep<CaseAnalysisPipelineState, CaseAnalysisPipelineState> {
  public readonly name = 'persist-results';

  public async run(input: CaseAnalysisPipelineState, context: AgentContext): Promise<CaseAnalysisPipelineState> {
    if (!input.analysis) {
      throw new AgentError('persistence_error', 'No analysis result available to persist.');
    }

    try {
      await query(
        `UPDATE cases
         SET analysis_status = 'succeeded',
             analysis_summary = $2,
             analysis_questions = $3,
             analysis_artifact = $4,
             analysis_model = $5,
             analysis_error = NULL,
             analysis_completed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [
          context.caseId,
          input.analysis.summary,
          JSON.stringify(input.analysis.topQuestions),
          JSON.stringify(input.analysis.artifact),
          input.analysis.model,
        ]
      );

      await markAnalysisRunSucceeded(context.runId, {
        model: input.analysis.model,
        modelVersion: input.analysis.model,
        promptTokens: input.analysis.usage?.promptTokens ?? null,
        completionTokens: input.analysis.usage?.completionTokens ?? null,
        totalTokens: input.analysis.usage?.totalTokens ?? null,
      });

      return input;
    } catch (error) {
      if (error instanceof Error) {
        throw new AgentError('persistence_error', error.message);
      }

      throw new AgentError('persistence_error', 'Persisting analysis results failed.');
    }
  }
}
