jest.mock('../agentic/observability/eventEmitter', () => ({
  emitAgenticStepEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../database/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../services/reportExtraction.service', () => ({
  extractCaseReports: jest.fn(),
}));

jest.mock('../services/analysis.service', () => {
  const actual = jest.requireActual('../services/analysis.service');
  return {
    ...actual,
    generateCaseAnalysis: jest.fn(),
  };
});

import { runAgenticViaLangChain } from '../agentic/langchain/adapter';
import { AgenticLoopState, AgenticRuntimeContext } from '../agentic/core/types';
import { emitAgenticStepEvent } from '../agentic/observability/eventEmitter';
import { query } from '../database/connection';
import { generateCaseAnalysis } from '../services/analysis.service';
import { buildCaseAnalysisArtifact } from '../services/analysisArtifact.service';
import { extractCaseReports } from '../services/reportExtraction.service';

const mockedEmitAgenticStepEvent = emitAgenticStepEvent as jest.MockedFunction<typeof emitAgenticStepEvent>;
const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedGenerateCaseAnalysis = generateCaseAnalysis as jest.MockedFunction<typeof generateCaseAnalysis>;
const mockedExtractCaseReports = extractCaseReports as jest.MockedFunction<typeof extractCaseReports>;

describe('LangGraph agentic adapter', () => {
  const context: AgenticRuntimeContext = {
    caseId: 'case-1',
    runId: 'run-1',
    mode: 'shadow',
    maxCharsPerFile: 12000,
    maxTotalChars: 30000,
    model: 'gpt-4.1-mini',
    policy: {
      allowedActions: ['VALIDATE_INTAKE', 'EXTRACT_REPORTS', 'SYNTHESIZE_SUMMARY', 'GUARD_QUESTIONS', 'FINALIZE'],
      maxSteps: 8,
      maxRefinements: 1,
    },
  };

  const initialState: AgenticLoopState = {
    caseId: 'case-1',
    runId: 'run-1',
    mode: 'shadow',
    stepCount: 0,
    refinementCount: 0,
    criticFeedback: null,
    intake: null,
    reports: [],
    analysis: null,
    observations: [],
    finalArtifact: null,
    criticScore: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedEmitAgenticStepEvent.mockResolvedValue(undefined);
    mockedQuery.mockResolvedValue({
      rows: [
        {
          age_at_submission: 42,
          sex: 'female',
          specialty_context: 'cardiology',
          symptoms: 'Chest pressure',
          symptom_duration: '2 weeks',
          medical_history: 'Hypertension',
          current_medications: 'Aspirin',
          allergies: 'None',
        },
      ],
    } as any);
    mockedExtractCaseReports.mockResolvedValue([
      {
        fileId: 'file-1',
        fileName: 'report.pdf',
        text: 'Clinical report text',
        charCount: 20,
      },
    ]);
    mockedGenerateCaseAnalysis.mockResolvedValue({
      summary: 'Chief Concern\nPossible cardiac chest pressure with uncertain etiology.\nRed Flags To Discuss\nPersistent chest pain.',
      topQuestions: [
        'What immediate diagnostics are recommended for this patient?',
        'Could this represent unstable angina despite normal ECG?',
        'Which follow-up timeline is most appropriate now?',
      ],
      artifact: buildCaseAnalysisArtifact({
        structuredSummary: {
          chief_concern: 'possible cardiac chest pressure',
          key_report_findings: 'Clinical report text',
          red_flags_to_discuss: 'Persistent chest pain',
          follow_up_discussion_points: 'Serial biomarkers',
          limitations_caveats: 'Requires clinician review',
        },
        specialistQuestions: [
          'What immediate diagnostics are recommended for this patient?',
          'Could this represent unstable angina despite normal ECG?',
          'Which follow-up timeline is most appropriate now?',
        ],
        model: 'gpt-4.1-mini',
      }),
      model: 'gpt-4.1-mini',
    });
  });

  it('runs the case-analysis flow as a LangGraph state graph', async () => {
    const result = await runAgenticViaLangChain(context, initialState);

    expect(result.artifact.questions).toHaveLength(3);
    expect(result.state.finalArtifact?.artifact.structured_summary.chief_concern).toBe('possible cardiac chest pressure');
    expect(result.state.criticScore?.passed).toBe(true);
    expect(result.history.map((item) => item.action)).toEqual([
      'VALIDATE_INTAKE',
      'EXTRACT_REPORTS',
      'SYNTHESIZE_SUMMARY',
      'GUARD_QUESTIONS',
      'FINALIZE',
    ]);
    expect(mockedEmitAgenticStepEvent).toHaveBeenCalledTimes(10);
    expect(mockedEmitAgenticStepEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        stepName: 'agentic:validate_intake',
        stepStatus: 'started',
        metadata: expect.objectContaining({
          runtime: 'langgraph',
        }),
      })
    );
  });
});
