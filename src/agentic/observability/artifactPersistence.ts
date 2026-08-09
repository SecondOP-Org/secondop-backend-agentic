import {
  AgenticAction,
  AgenticLoopState,
  AgenticRuntimeContext,
} from '../core/types';
import { shouldPersistAnalysisSideEffects } from '../../evals/analysisEvalFixtures';
import {
  buildAgenticFinalPayload,
  buildBaselineValidationPayload,
  buildExtractionPayload,
  buildGuardPayload,
  buildSynthesisPayload,
  insertCaseAnalysisArtifact,
} from '../../services/caseAnalysisRunArtifact.service';

const persistAgenticArtifact = async (
  context: AgenticRuntimeContext,
  artifactType: 'validation' | 'extraction' | 'synthesis' | 'guard' | 'final',
  stageName: string,
  payload: Record<string, unknown>
): Promise<void> => {
  await insertCaseAnalysisArtifact({
    runId: context.runId,
    caseId: context.caseId,
    artifactType,
    stageName,
    engine: 'agentic',
    payload,
  });
};

export const persistAgenticStageArtifact = async (
  action: AgenticAction,
  context: AgenticRuntimeContext,
  state: AgenticLoopState
): Promise<void> => {
  if (!shouldPersistAnalysisSideEffects(context.persist)) {
    return;
  }

  switch (action) {
    case 'VALIDATE_INTAKE':
      if (state.intake) {
        await persistAgenticArtifact(
          context,
          'validation',
          'agentic:validate_intake',
          buildBaselineValidationPayload(state.intake)
        );
      }
      return;
    case 'EXTRACT_REPORTS':
      if (state.reports.length > 0) {
        await persistAgenticArtifact(
          context,
          'extraction',
          'agentic:extract_reports',
          buildExtractionPayload(state.reports)
        );
      }
      return;
    case 'SYNTHESIZE_SUMMARY':
      if (state.analysis) {
        await persistAgenticArtifact(
          context,
          'synthesis',
          'agentic:synthesize_summary',
          buildSynthesisPayload(state.analysis, state.observations)
        );
      }
      return;
    case 'GUARD_QUESTIONS':
      if (state.analysis) {
        await persistAgenticArtifact(
          context,
          'guard',
          'agentic:guard_questions',
          buildGuardPayload(state.analysis)
        );
      }
      return;
    case 'FINALIZE':
      if (state.finalArtifact) {
        await persistAgenticArtifact(
          context,
          'final',
          'agentic:finalize',
          buildAgenticFinalPayload({
            summary: state.finalArtifact.summary,
            questions: state.finalArtifact.questions,
            observations: state.finalArtifact.observations,
            artifact: state.finalArtifact.artifact,
            model: state.finalArtifact.model,
          })
        );
      }
      return;
    default:
      return;
  }
};
