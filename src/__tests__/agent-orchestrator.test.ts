import { runCaseAnalysis } from '../agents/case-analysis/runCaseAnalysis';
import { AgentError } from '../agents/core/agent.types';
import { query } from '../database/connection';
import { generateCaseAnalysis } from '../services/analysis.service';
import { extractCaseReports } from '../services/reportExtraction.service';
import { insertAnalysisEvent, markAnalysisRunSucceeded } from '../services/analysisRun.service';
import { buildCaseAnalysisArtifact } from '../services/analysisArtifact.service';

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

jest.mock('../services/analysisRun.service', () => ({
  insertAnalysisEvent: jest.fn(),
  markAnalysisRunSucceeded: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedExtractCaseReports = extractCaseReports as jest.MockedFunction<typeof extractCaseReports>;
const mockedGenerateCaseAnalysis = generateCaseAnalysis as jest.MockedFunction<typeof generateCaseAnalysis>;
const mockedInsertAnalysisEvent = insertAnalysisEvent as jest.MockedFunction<typeof insertAnalysisEvent>;
const mockedMarkAnalysisRunSucceeded = markAnalysisRunSucceeded as jest.MockedFunction<typeof markAnalysisRunSucceeded>;

describe('Case analysis agent orchestrator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedInsertAnalysisEvent.mockResolvedValue(undefined as any);
    mockedMarkAnalysisRunSucceeded.mockResolvedValue(undefined as any);
    mockedQuery.mockResolvedValue({ rows: [] } as any);
  });

  it('runs all steps in order and emits started/completed events', async () => {
    mockedQuery
      .mockResolvedValueOnce({
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
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    mockedExtractCaseReports.mockResolvedValueOnce([
      {
        fileId: 'file-1',
        fileName: 'report.pdf',
        text: 'Clinical report text',
        charCount: 20,
      },
    ]);

    mockedGenerateCaseAnalysis.mockResolvedValueOnce({
      summary: 'Chief Concern\nChest pressure\nRed Flags To Discuss\nWorsening dyspnea',
      topQuestions: ['What immediate tests are most important?', 'Is imaging urgently indicated?', 'What treatment should be prioritized now?'],
      artifact: buildCaseAnalysisArtifact({
        structuredSummary: {
          chief_concern: 'Chest pressure',
          key_report_findings: 'Clinical report text',
          red_flags_to_discuss: 'Worsening dyspnea',
          follow_up_discussion_points: 'Urgent cardiology follow-up',
          limitations_caveats: 'Needs clinician confirmation',
        },
        specialistQuestions: ['What immediate tests are most important?', 'Is imaging urgently indicated?', 'What treatment should be prioritized now?'],
        model: 'gpt-4.1-mini',
      }),
      model: 'gpt-4.1-mini',
    });

    const result = await runCaseAnalysis({
      caseId: 'case-1',
      runId: 'run-1',
      maxCharsPerFile: 12000,
      maxTotalChars: 30000,
      executionMode: 'baseline',
    });

    expect(result.analysis?.topQuestions).toHaveLength(3);
    expect(result.observations).toEqual(['Chief Concern: Chest pressure', 'Key Report Findings: Worsening dyspnea']);

    expect(mockedInsertAnalysisEvent).toHaveBeenCalledTimes(10);
    expect(mockedInsertAnalysisEvent.mock.calls[0][0]).toMatchObject({
      runId: 'run-1',
      stepName: 'intake-validation',
      stepStatus: 'started',
    });
    expect(mockedInsertAnalysisEvent.mock.calls[9][0]).toMatchObject({
      runId: 'run-1',
      stepName: 'persist-results',
      stepStatus: 'completed',
    });

    expect(mockedMarkAnalysisRunSucceeded).toHaveBeenCalledWith('run-1', {
      model: 'gpt-4.1-mini',
      modelVersion: 'gpt-4.1-mini',
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });
  });

  it('emits a failed event and returns normalized model error', async () => {
    mockedQuery.mockResolvedValueOnce({
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

    mockedExtractCaseReports.mockResolvedValueOnce([
      {
        fileId: 'file-1',
        fileName: 'report.pdf',
        text: 'Clinical report text',
        charCount: 20,
      },
    ]);

    mockedGenerateCaseAnalysis.mockRejectedValueOnce(new Error('Model timed out'));

    await expect(
      runCaseAnalysis({
        caseId: 'case-1',
        runId: 'run-2',
        maxCharsPerFile: 12000,
        maxTotalChars: 30000,
        executionMode: 'baseline',
      })
    ).rejects.toEqual(expect.any(AgentError));

    const failedEvent = mockedInsertAnalysisEvent.mock.calls.find(
      (call) => call[0].stepName === 'clinical-synthesis' && call[0].stepStatus === 'failed'
    );

    expect(failedEvent).toBeDefined();
    expect(failedEvent?.[0].errorText).toContain('[model_error] Model timed out');
  });
});
