import { query } from '../../database/connection';
import { markAnalysisRunSucceeded } from '../../services/analysisRun.service';
import { emitPerCaseLatencyWarnIfNeeded } from '../../services/analysisAttention.service';
import { clearDeidVault } from '../../services/deidVault.service';
import { CaseAnalysisContractError, enforceCaseAnalysisContract } from '../../evals/contractChecks';
import { resolveContractCheckArtifact } from '../../services/analysis.service';
import { computeOnlineEvalSignals } from '../../services/onlineEvals.service';
import { AgentContext, AgentError, AgentStep } from '../core/agent.types';
import { CaseAnalysisPipelineState } from './case-analysis.types';

export class PersistResultsAgent implements AgentStep<CaseAnalysisPipelineState, CaseAnalysisPipelineState> {
  public readonly name = 'persist-results';

  public async run(input: CaseAnalysisPipelineState, context: AgentContext): Promise<CaseAnalysisPipelineState> {
    if (!input.analysis) {
      throw new AgentError('persistence_error', 'No analysis result available to persist.');
    }

    try {
      const contractArtifact = input.analysis.artifact
        ? resolveContractCheckArtifact(input.analysis)
        : null;

      if (contractArtifact) {
        // Validate tokenized twin against de-identified reports; persist clinician-facing artifact below.
        enforceCaseAnalysisContract(contractArtifact, { reports: input.reports });
      }

      const onlineEvals = computeOnlineEvalSignals({
        contractArtifact,
        reports: input.reports,
        criticScore: null,
      });

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

      const succeedMeta = await markAnalysisRunSucceeded(context.runId, {
        model: input.analysis.model,
        modelVersion: input.analysis.model,
        promptTokens: input.analysis.usage?.promptTokens ?? null,
        completionTokens: input.analysis.usage?.completionTokens ?? null,
        totalTokens: input.analysis.usage?.totalTokens ?? null,
        criticScore: onlineEvals.criticScore,
        contractPass: onlineEvals.contractPass,
        confidenceScore: input.analysis.artifact?.confidence_score ?? null,
      });
      await emitPerCaseLatencyWarnIfNeeded({
        runId: context.runId,
        caseId: context.caseId,
        latencyMs: succeedMeta.latencyMs,
        attentionReason: succeedMeta.attentionReason,
      });

      // Clinician artifact is persisted with real values; drop sealed map to minimize PHI retention.
      await clearDeidVault(context.runId);

      return input;
    } catch (error) {
      if (error instanceof CaseAnalysisContractError) {
        throw new AgentError('validation_error', error.message);
      }

      if (error instanceof Error) {
        throw new AgentError('persistence_error', error.message);
      }

      throw new AgentError('persistence_error', 'Persisting analysis results failed.');
    }
  }
}
