import { AgenticError, AgenticFinalArtifact, AgenticLoopState } from '../core/types';
import { CaseAnalysisContractError, enforceCaseAnalysisContract } from '../../evals/contractChecks';
import { resolveContractCheckArtifact } from '../../services/analysis.service';
import { formatStructuredSummary } from '../../services/analysisArtifact.service';

export class FinalizerAgent {
  public finalize(state: AgenticLoopState): AgenticFinalArtifact {
    if (!state.analysis) {
      throw new AgenticError('validation_error', 'Analysis is missing for finalization.');
    }

    if (!state.analysis.summary.trim()) {
      throw new AgenticError('validation_error', 'Analysis summary is empty during finalization.');
    }

    if (state.analysis.topQuestions.length !== 3) {
      throw new AgenticError('validation_error', 'Finalization requires exactly 3 specialist questions.');
    }

    try {
      // Ground against de-identified reports using the tokenized twin — never the re-identified artifact.
      enforceCaseAnalysisContract(resolveContractCheckArtifact(state.analysis), { reports: state.reports });
    } catch (error) {
      if (error instanceof CaseAnalysisContractError) {
        throw new AgenticError('validation_error', error.message);
      }
      throw error;
    }

    // Persist de-identified twin on the case; sealed vault retained for owner reveal.
    const deidentified = state.analysis.artifactDeidentified ?? state.analysis.artifact;
    return {
      summary: formatStructuredSummary(deidentified.structured_summary),
      questions: deidentified.questionnaire.specialist_questions.map((item) => item.question),
      observations: state.observations,
      artifact: deidentified,
      model: state.analysis.model,
    };
  }
}
