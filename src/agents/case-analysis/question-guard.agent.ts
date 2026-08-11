import { AgentError, AgentStep } from '../core/agent.types';
import { CaseAnalysisPipelineState } from './case-analysis.types';
import { CaseAnalysisContractError, enforceCaseAnalysisContract } from '../../evals/contractChecks';
import { resolveContractCheckArtifact } from '../../services/analysis.service';
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

export class QuestionGuardAgent implements AgentStep<CaseAnalysisPipelineState, CaseAnalysisPipelineState> {
  public readonly name = 'question-guard';

  public async run(input: CaseAnalysisPipelineState): Promise<CaseAnalysisPipelineState> {
    if (!input.analysis) {
      throw new AgentError('validation_error', 'Analysis output must exist before question validation.');
    }

    const normalizedQuestions = input.analysis.topQuestions.map(normalizeQuestionText);
    const validation = validatePatientVoiceQuestions(normalizedQuestions, { exactCount: true });
    if (!validation.ok) {
      throw new AgentError('validation_error', validation.violations.join(' '));
    }

    if (input.analysis.artifact) {
      try {
        enforceCaseAnalysisContract(resolveContractCheckArtifact(input.analysis), { reports: input.reports });
      } catch (error) {
        if (error instanceof CaseAnalysisContractError) {
          throw new AgentError('validation_error', error.message);
        }
        throw error;
      }
    }

    const clinicianArtifact: CaseAnalysisArtifact = {
      ...input.analysis.artifact,
      questionnaire: {
        specialist_questions: input.analysis.artifact.questionnaire.specialist_questions.map((item, index) => ({
          ...item,
          question: normalizedQuestions[index] ?? normalizeQuestionText(item.question),
          source: item.source ?? 'ai',
        })),
      },
    };
    const artifactDeidentified = input.analysis.artifactDeidentified
      ? normalizeArtifactQuestions(input.analysis.artifactDeidentified)
      : clinicianArtifact;

    return {
      ...input,
      analysis: {
        ...input.analysis,
        topQuestions: normalizedQuestions,
        artifact: clinicianArtifact,
        artifactDeidentified,
      },
    };
  }
}
