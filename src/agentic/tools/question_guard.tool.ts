import { AgenticError, AgenticLoopState } from '../core/types';
import { CaseAnalysisArtifact } from '../../services/analysisArtifact.service';
import {
  normalizeQuestionText,
  validatePatientVoiceQuestions,
} from '../../services/specialistQuestions.validation';

const normalizeArtifactQuestions = (artifact: CaseAnalysisArtifact): CaseAnalysisArtifact => ({
  ...artifact,
  questionnaire: {
    specialist_questions: artifact.questionnaire.specialist_questions.map((item) => ({
      ...item,
      question: normalizeQuestionText(item.question),
    })),
  },
});

export const guardQuestionsTool = async (state: AgenticLoopState): Promise<AgenticLoopState> => {
  if (!state.analysis) {
    throw new AgenticError('validation_error', 'Analysis output is required before question guard.');
  }

  const normalized = state.analysis.topQuestions.map(normalizeQuestionText);
  const validation = validatePatientVoiceQuestions(normalized, { exactCount: true });
  if (!validation.ok) {
    throw new AgenticError('validation_error', validation.violations.join(' '));
  }

  // Keep clinician + de-id twins in sync when normalizing question whitespace.
  const clinicianArtifact: CaseAnalysisArtifact = {
    ...state.analysis.artifact,
    questionnaire: {
      specialist_questions: state.analysis.artifact.questionnaire.specialist_questions.map((item, index) => ({
        ...item,
        question: normalized[index] ?? normalizeQuestionText(item.question),
        source: item.source ?? 'ai',
      })),
    },
  };
  const artifactDeidentified = state.analysis.artifactDeidentified
    ? normalizeArtifactQuestions(state.analysis.artifactDeidentified)
    : clinicianArtifact;

  return {
    ...state,
    analysis: {
      ...state.analysis,
      topQuestions: normalized,
      artifact: clinicianArtifact,
      artifactDeidentified,
    },
  };
};
