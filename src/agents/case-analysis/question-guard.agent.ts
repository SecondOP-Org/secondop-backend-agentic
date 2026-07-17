import { AgentError, AgentStep } from '../core/agent.types';
import { CaseAnalysisPipelineState } from './case-analysis.types';
import { CaseAnalysisContractError, enforceCaseAnalysisContract } from '../../evals/contractChecks';
import { resolveContractCheckArtifact } from '../../services/analysis.service';
import { CaseAnalysisArtifact } from '../../services/analysisArtifact.service';

const normalizeQuestion = (question: string): string => {
  return question.replace(/\s+/g, ' ').trim();
};

const normalizeArtifactQuestions = (artifact: CaseAnalysisArtifact): CaseAnalysisArtifact => ({
  ...artifact,
  questionnaire: {
    specialist_questions: artifact.questionnaire.specialist_questions.map((item) => ({
      ...item,
      question: normalizeQuestion(item.question),
    })),
  },
});

export class QuestionGuardAgent implements AgentStep<CaseAnalysisPipelineState, CaseAnalysisPipelineState> {
  public readonly name = 'question-guard';

  public async run(input: CaseAnalysisPipelineState): Promise<CaseAnalysisPipelineState> {
    if (!input.analysis) {
      throw new AgentError('validation_error', 'Analysis output must exist before question validation.');
    }

    const normalizedQuestions = input.analysis.topQuestions.map(normalizeQuestion);

    if (normalizedQuestions.length !== 3) {
      throw new AgentError('validation_error', 'Analysis must return exactly 3 questions.');
    }

    const uniqueQuestions = new Set(normalizedQuestions.map((question) => question.toLowerCase()));
    if (uniqueQuestions.size !== 3) {
      throw new AgentError('validation_error', 'Analysis questions must be unique.');
    }

    const tooShort = normalizedQuestions.find((question) => question.length < 12);
    if (tooShort) {
      throw new AgentError('validation_error', 'All analysis questions must be meaningful specialist-facing prompts.');
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
          question: normalizedQuestions[index] ?? normalizeQuestion(item.question),
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
