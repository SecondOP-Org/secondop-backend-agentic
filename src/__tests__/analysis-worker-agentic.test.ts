import { analysisWorker } from '../services/analysisWorker.service';
import { query } from '../database/connection';
import { runCaseAnalysis } from '../agents/case-analysis/runCaseAnalysis';
import { runAgenticCaseAnalysis } from '../agentic/orchestration/runAgenticCaseAnalysis';
import {
  createAnalysisRun,
  getLatestActiveAnalysisRun,
  markAnalysisRunFailed,
  markAnalysisRunProcessing,
  markAnalysisRunSucceeded,
} from '../services/analysisRun.service';
import { buildCaseAnalysisArtifact } from '../services/analysisArtifact.service';
import { insertCaseAnalysisArtifact } from '../services/caseAnalysisRunArtifact.service';

jest.mock('pg-boss', () => {
  let workerHandler: ((jobs: Array<{ data: unknown }>) => Promise<void>) | null = null;

  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    createQueue: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockImplementation(async (_queueName: string, handler: typeof workerHandler) => {
      workerHandler = handler;
    }),
    send: jest.fn().mockImplementation(async (_queueName: string, job: unknown) => {
      if (workerHandler) {
        await workerHandler([{ data: job }]).catch(() => undefined);
      }
    }),
    stop: jest.fn().mockResolvedValue(undefined),
  }));
});

jest.mock('../database/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../agents/case-analysis/runCaseAnalysis', () => ({
  runCaseAnalysis: jest.fn(),
}));

jest.mock('../agentic/orchestration/runAgenticCaseAnalysis', () => ({
  runAgenticCaseAnalysis: jest.fn(),
}));

jest.mock('../services/analysisAttention.service', () => ({
  emitPerCaseLatencyWarnIfNeeded: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/analysisRun.service', () => ({
  createAnalysisRun: jest.fn(),
  getLatestActiveAnalysisRun: jest.fn(),
  markAnalysisRunFailed: jest.fn(),
  markAnalysisRunProcessing: jest.fn(),
  markAnalysisRunQueued: jest.fn(),
  markAnalysisRunSucceeded: jest.fn(),
}));

jest.mock('../services/caseAnalysisRunArtifact.service', () => ({
  insertCaseAnalysisArtifact: jest.fn(),
  buildShadowComparisonMetrics: jest.requireActual('../services/caseAnalysisRunArtifact.service')
    .buildShadowComparisonMetrics,
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedRunCaseAnalysis = runCaseAnalysis as jest.MockedFunction<typeof runCaseAnalysis>;
const mockedRunAgenticCaseAnalysis = runAgenticCaseAnalysis as jest.MockedFunction<typeof runAgenticCaseAnalysis>;
const mockedCreateAnalysisRun = createAnalysisRun as jest.MockedFunction<typeof createAnalysisRun>;
const mockedGetLatestActiveAnalysisRun = getLatestActiveAnalysisRun as jest.MockedFunction<typeof getLatestActiveAnalysisRun>;
const mockedMarkAnalysisRunFailed = markAnalysisRunFailed as jest.MockedFunction<typeof markAnalysisRunFailed>;
const mockedMarkAnalysisRunProcessing = markAnalysisRunProcessing as jest.MockedFunction<typeof markAnalysisRunProcessing>;
const mockedMarkAnalysisRunSucceeded = markAnalysisRunSucceeded as jest.MockedFunction<typeof markAnalysisRunSucceeded>;
const mockedInsertCaseAnalysisArtifact = insertCaseAnalysisArtifact as jest.MockedFunction<typeof insertCaseAnalysisArtifact>;

const flushAsync = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('Analysis worker agentic modes', () => {
  const originalMode = process.env.ANALYSIS_EXECUTION_MODE;
  const originalLegacyMode = process.env.ANALYSIS_AGENTIC_MODE;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ANALYSIS_EXECUTION_MODE;
    mockedQuery.mockResolvedValue({ rows: [] } as any);
    mockedGetLatestActiveAnalysisRun.mockResolvedValue(null as any);
    mockedMarkAnalysisRunProcessing.mockResolvedValue(true as any);
    mockedMarkAnalysisRunSucceeded.mockResolvedValue({
      latencyMs: 1000,
      attentionReason: null,
      caseId: 'case-1',
    } as any);
    mockedMarkAnalysisRunFailed.mockResolvedValue(undefined as any);
    mockedInsertCaseAnalysisArtifact.mockResolvedValue(undefined as any);
    mockedRunCaseAnalysis.mockResolvedValue({ caseId: 'case-1' } as any);
    mockedCreateAnalysisRun.mockResolvedValue({ id: 'run-analysis', status: 'queued' } as any);
  });

  afterEach(() => {
    process.env.ANALYSIS_EXECUTION_MODE = originalMode;
    process.env.ANALYSIS_AGENTIC_MODE = originalLegacyMode;
  });

  it('uses agentic output as source of truth in agentic mode', async () => {
    process.env.ANALYSIS_AGENTIC_MODE = 'direct';

    mockedRunAgenticCaseAnalysis.mockResolvedValueOnce({
      artifact: {
        summary: 'Agentic summary with caveat language',
        questions: ['Q1 direct', 'Q2 direct', 'Q3 direct'],
        observations: ['Obs1'],
        artifact: buildCaseAnalysisArtifact({
          structuredSummary: {
            chief_concern: 'Agentic summary with caveat language',
            key_report_findings: 'Key findings',
            red_flags_to_discuss: 'Red flags',
            follow_up_discussion_points: 'Follow-up',
            limitations_caveats: 'Needs clinician review',
          },
          specialistQuestions: ['Q1 direct', 'Q2 direct', 'Q3 direct'],
          model: 'gpt-4.1-mini',
        }),
        model: 'gpt-4.1-mini',
      },
    } as any);

    await analysisWorker.queueCase('case-1');
    await flushAsync();

    expect(mockedCreateAnalysisRun).toHaveBeenCalledWith('case-1', 'queued', 'agentic', 'agentic');
    expect(mockedRunCaseAnalysis).not.toHaveBeenCalled();
    expect(mockedRunAgenticCaseAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'agentic', caseId: 'case-1', runId: 'run-analysis' })
    );

    const directPersistCall = mockedQuery.mock.calls.find((call) =>
      String(call[0]).includes("SET analysis_status = 'succeeded'") &&
      Array.isArray(call[1]) &&
      call[1][1] === 'Agentic summary with caveat language'
    );

    expect(directPersistCall).toBeDefined();
    expect(mockedMarkAnalysisRunSucceeded).toHaveBeenCalledWith(
      'run-analysis',
      expect.objectContaining({ model: 'gpt-4.1-mini' })
    );
  });

  it('keeps baseline path unaffected when shadow mode agentic execution fails', async () => {
    process.env.ANALYSIS_AGENTIC_MODE = 'shadow';
    mockedCreateAnalysisRun
      .mockResolvedValueOnce({ id: 'run-baseline', status: 'queued' } as any)
      .mockResolvedValueOnce({ id: 'run-agentic', status: 'queued' } as any);

    mockedRunAgenticCaseAnalysis.mockRejectedValueOnce(new Error('Shadow execution failed'));

    await analysisWorker.queueCase('case-1');
    await flushAsync();

    expect(mockedRunCaseAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-baseline', caseId: 'case-1' })
    );

    expect(mockedMarkAnalysisRunFailed).toHaveBeenCalledWith('run-agentic', 'Shadow execution failed');

    const directFailureUpdate = mockedQuery.mock.calls.find((call) =>
      String(call[0]).includes('[agentic_direct_failed]')
    );
    expect(directFailureUpdate).toBeUndefined();
  });

  it('persists shadow comparison metrics while keeping baseline user-facing output', async () => {
    process.env.ANALYSIS_AGENTIC_MODE = 'shadow';
    mockedCreateAnalysisRun
      .mockResolvedValueOnce({ id: 'run-baseline', status: 'queued' } as any)
      .mockResolvedValueOnce({ id: 'run-agentic', status: 'queued' } as any);

    mockedRunCaseAnalysis.mockResolvedValueOnce({
      caseId: 'case-1',
      analysis: {
        summary: 'Baseline summary',
        topQuestions: ['Q1', 'Q2', 'Q3'],
        artifact: buildCaseAnalysisArtifact({
          structuredSummary: {
            chief_concern: 'Baseline summary',
            key_report_findings: 'Findings',
            red_flags_to_discuss: 'Flags',
            follow_up_discussion_points: 'Follow-up',
            limitations_caveats: 'Limits',
          },
          specialistQuestions: ['Q1', 'Q2', 'Q3'],
          model: 'gpt-4.1-mini',
        }),
        artifactDeidentified: buildCaseAnalysisArtifact({
          structuredSummary: {
            chief_concern: 'Baseline summary',
            key_report_findings: 'Findings',
            red_flags_to_discuss: 'Flags',
            follow_up_discussion_points: 'Follow-up',
            limitations_caveats: 'Limits',
          },
          specialistQuestions: ['Q1', 'Q2', 'Q3'],
          model: 'gpt-4.1-mini',
        }),
        model: 'gpt-4.1-mini',
      },
    } as any);

    mockedRunAgenticCaseAnalysis.mockResolvedValueOnce({
      artifact: {
        summary: 'Agentic summary',
        questions: ['Q1', 'Q2', 'Q4'],
        observations: [],
        artifact: buildCaseAnalysisArtifact({
          structuredSummary: {
            chief_concern: 'Agentic summary',
            key_report_findings: 'Findings',
            red_flags_to_discuss: 'Flags',
            follow_up_discussion_points: 'Follow-up',
            limitations_caveats: 'Limits',
          },
          specialistQuestions: ['Q1', 'Q2', 'Q4'],
          model: 'gpt-4.1-mini',
        }),
        model: 'gpt-4.1-mini',
      },
      criticScore: {
        passed: true,
        score: 90,
        reasons: [],
        needsRefinement: false,
      },
    } as any);

    await analysisWorker.queueCase('case-1');
    await flushAsync();

    expect(mockedInsertCaseAnalysisArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-baseline',
        caseId: 'case-1',
        artifactType: 'final',
        stageName: 'shadow-comparison',
        engine: 'baseline',
      })
    );

    const baselinePersistCall = mockedQuery.mock.calls.find((call) =>
      String(call[0]).includes("SET analysis_status = 'succeeded'") &&
      Array.isArray(call[1]) &&
      call[1][1] === 'Baseline summary'
    );
    expect(baselinePersistCall).toBeUndefined();
  });
});
