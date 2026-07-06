import { AgenticError, AgenticFinalArtifact, AgenticLoopState } from '../core/types';
import { CaseAnalysisContractError, enforceCaseAnalysisContract } from '../../evals/contractChecks';

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
      enforceCaseAnalysisContract(state.analysis.artifact, { reports: state.reports });
    } catch (error) {
      if (error instanceof CaseAnalysisContractError) {
        throw new AgenticError('validation_error', error.message);
      }
      throw error;
    }

    return {
      summary: state.analysis.summary,
      questions: state.analysis.topQuestions,
      observations: state.observations,
      artifact: state.analysis.artifact,
      model: state.analysis.model,
    };
  }
}
