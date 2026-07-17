import { AgenticError, AgenticLoopState } from '../core/types';
import { CaseAnalysisArtifact } from '../../services/analysisArtifact.service';

const normalizeQuestion = (question: string): string => question.replace(/\s+/g, ' ').trim();

const normalizeArtifactQuestions = (artifact: CaseAnalysisArtifact): CaseAnalysisArtifact => ({
  ...artifact,
  questionnaire: {
    specialist_questions: artifact.questionnaire.specialist_questions.map((item) => ({
      ...item,
      question: normalizeQuestion(item.question),
    })),
  },
});

export const guardQuestionsTool = async (state: AgenticLoopState): Promise<AgenticLoopState> => {
  if (!state.analysis) {
    throw new AgenticError('validation_error', 'Analysis output is required before question guard.');
  }

  const normalized = state.analysis.topQuestions.map(normalizeQuestion);

  if (normalized.length !== 3) {
    throw new AgenticError('validation_error', 'Exactly 3 specialist-facing questions are required.');
  }

  const unique = new Set(normalized.map((item) => item.toLowerCase()));
  if (unique.size !== 3) {
    throw new AgenticError('validation_error', 'Specialist questions must be unique.');
  }

  if (normalized.some((item) => item.length < 12)) {
    throw new AgenticError('validation_error', 'Specialist questions must be sufficiently descriptive.');
  }

  // Keep clinician + de-id twins in sync when normalizing question whitespace.
  const clinicianArtifact: CaseAnalysisArtifact = {
    ...state.analysis.artifact,
    questionnaire: {
      specialist_questions: state.analysis.artifact.questionnaire.specialist_questions.map((item, index) => ({
        ...item,
        question: normalized[index] ?? normalizeQuestion(item.question),
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
