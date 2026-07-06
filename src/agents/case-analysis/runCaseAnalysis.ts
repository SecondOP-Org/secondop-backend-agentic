import { createAgentContext } from '../core/agent.context';
import { runAgentPipeline } from '../core/agent.orchestrator';
import { AgentErrorCode } from '../core/agent.types';
import { ClinicalSynthesisAgent } from './clinical-synthesis.agent';
import { IntakeValidationAgent } from './intake-validation.agent';
import { PersistResultsAgent } from './persist-results.agent';
import { QuestionGuardAgent } from './question-guard.agent';
import { ReportExtractionAgent } from './report-extraction.agent';
import { AnalysisExecutionMode } from '../../agentic/core/executionMode';
import {
  buildBaselineValidationPayload,
  buildExtractionPayload,
  buildFinalPayload,
  buildGuardPayload,
  buildSynthesisPayload,
  insertCaseAnalysisArtifact,
} from '../../services/caseAnalysisRunArtifact.service';
import { CaseAnalysisPipelineState } from './case-analysis.types';

interface RunCaseAnalysisOptions {
  caseId: string;
  runId: string;
  maxCharsPerFile: number;
  maxTotalChars: number;
  executionMode: AnalysisExecutionMode;
}

const resolveErrorCode = (stepName: string): AgentErrorCode => {
  switch (stepName) {
    case 'intake-validation':
    case 'question-guard':
      return 'validation_error';
    case 'report-extraction':
      return 'extraction_error';
    case 'clinical-synthesis':
      return 'model_error';
    case 'persist-results':
      return 'persistence_error';
    default:
      return 'unknown_error';
  }
};

const buildMetadata = (stepName: string, state: CaseAnalysisPipelineState): Record<string, unknown> | null => {
  switch (stepName) {
    case 'intake-validation':
      return state.intake
        ? {
            age: state.intake.age,
            specialtyContext: state.intake.specialtyContext,
          }
        : null;
    case 'report-extraction':
      return state.reports
        ? {
            reportCount: state.reports.length,
            totalChars: state.reports.reduce((sum, report) => sum + report.charCount, 0),
          }
        : null;
    case 'clinical-synthesis':
      return state.analysis
        ? {
            model: state.analysis.model,
            summaryLength: state.analysis.summary.length,
            questionCount: state.analysis.topQuestions.length,
            observationCount: state.observations?.length || 0,
            modelTokenUsage: state.analysis.usage || null,
          }
        : null;
    case 'question-guard':
      return state.analysis
        ? {
            questionCount: state.analysis.topQuestions.length,
            uniqueQuestionCount: new Set(state.analysis.topQuestions.map((question) => question.toLowerCase())).size,
          }
        : null;
    case 'persist-results':
      return {
        persisted: true,
      };
    default:
      return null;
  }
};

const persistBaselineStageArtifact = async (
  stepName: string,
  state: CaseAnalysisPipelineState,
  runId: string
): Promise<void> => {
  switch (stepName) {
    case 'intake-validation':
      if (state.intake) {
        await insertCaseAnalysisArtifact({
          runId,
          caseId: state.caseId,
          artifactType: 'validation',
          stageName: stepName,
          engine: 'baseline',
          payload: buildBaselineValidationPayload(state.intake),
        });
      }
      return;
    case 'report-extraction':
      if (state.reports) {
        await insertCaseAnalysisArtifact({
          runId,
          caseId: state.caseId,
          artifactType: 'extraction',
          stageName: stepName,
          engine: 'baseline',
          payload: buildExtractionPayload(state.reports),
        });
      }
      return;
    case 'clinical-synthesis':
      if (state.analysis) {
        await insertCaseAnalysisArtifact({
          runId,
          caseId: state.caseId,
          artifactType: 'synthesis',
          stageName: stepName,
          engine: 'baseline',
          payload: buildSynthesisPayload(state.analysis, state.observations),
        });
      }
      return;
    case 'question-guard':
      if (state.analysis) {
        await insertCaseAnalysisArtifact({
          runId,
          caseId: state.caseId,
          artifactType: 'guard',
          stageName: stepName,
          engine: 'baseline',
          payload: buildGuardPayload(state.analysis),
        });
      }
      return;
    case 'persist-results':
      if (state.analysis) {
        await insertCaseAnalysisArtifact({
          runId,
          caseId: state.caseId,
          artifactType: 'final',
          stageName: stepName,
          engine: 'baseline',
          payload: buildFinalPayload(state.analysis),
        });
      }
      return;
    default:
      return;
  }
};

export const runCaseAnalysis = async (options: RunCaseAnalysisOptions): Promise<CaseAnalysisPipelineState> => {
  const context = createAgentContext({
    caseId: options.caseId,
    runId: options.runId,
    maxCharsPerFile: options.maxCharsPerFile,
    maxTotalChars: options.maxTotalChars,
    executionMode: options.executionMode,
  });

  const steps = [
    new IntakeValidationAgent(),
    new ReportExtractionAgent(),
    new ClinicalSynthesisAgent(),
    new QuestionGuardAgent(),
    new PersistResultsAgent(),
  ];

  return runAgentPipeline({
    context,
    steps,
    initialState: {
      caseId: options.caseId,
    },
    resolveErrorCode,
    buildMetadata,
    onStepCompleted: async (stepName, state) => {
      await persistBaselineStageArtifact(stepName, state, options.runId);
    },
  });
};
