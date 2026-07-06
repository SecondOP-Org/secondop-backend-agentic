import { analysisWorker } from '../services/analysisWorker.service';
import { query } from '../database/connection';
import { runCaseAnalysis } from '../agents/case-analysis/runCaseAnalysis';
import {
  createAnalysisRun,
  getLatestActiveAnalysisRun,
  markAnalysisRunFailed,
  markAnalysisRunProcessing,
  markAnalysisRunQueued,
} from '../services/analysisRun.service';

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

jest.mock('../services/analysisRun.service', () => ({
  createAnalysisRun: jest.fn(),
  getLatestActiveAnalysisRun: jest.fn(),
  markAnalysisRunFailed: jest.fn(),
  markAnalysisRunProcessing: jest.fn(),
  markAnalysisRunQueued: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedRunCaseAnalysis = runCaseAnalysis as jest.MockedFunction<typeof runCaseAnalysis>;
const mockedCreateAnalysisRun = createAnalysisRun as jest.MockedFunction<typeof createAnalysisRun>;
const mockedGetLatestActiveAnalysisRun = getLatestActiveAnalysisRun as jest.MockedFunction<typeof getLatestActiveAnalysisRun>;
const mockedMarkAnalysisRunFailed = markAnalysisRunFailed as jest.MockedFunction<typeof markAnalysisRunFailed>;
const mockedMarkAnalysisRunProcessing = markAnalysisRunProcessing as jest.MockedFunction<typeof markAnalysisRunProcessing>;
const mockedMarkAnalysisRunQueued = markAnalysisRunQueued as jest.MockedFunction<typeof markAnalysisRunQueued>;

const flushAsync = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('Analysis worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedQuery.mockResolvedValue({ rows: [] } as any);
    mockedGetLatestActiveAnalysisRun.mockResolvedValue(null as any);
    mockedCreateAnalysisRun.mockResolvedValue({
      id: 'run-1',
      case_id: 'case-1',
      status: 'queued',
      engine: 'baseline',
      execution_mode: 'baseline',
      started_at: null,
      completed_at: null,
      model: null,
      error: null,
      created_at: new Date(),
    } as any);
    mockedMarkAnalysisRunQueued.mockResolvedValue(undefined as any);
    mockedMarkAnalysisRunProcessing.mockResolvedValue(true as any);
    mockedMarkAnalysisRunFailed.mockResolvedValue(undefined as any);
    mockedRunCaseAnalysis.mockResolvedValue({ caseId: 'case-1' } as any);
  });

  it('marks analysis as failed when orchestration fails', async () => {
    mockedRunCaseAnalysis.mockRejectedValueOnce(new Error('No extractable text found in uploaded PDF reports.'));

    await analysisWorker.queueCase('case-1');
    await flushAsync();

    expect(mockedCreateAnalysisRun).toHaveBeenCalledWith('case-1', 'queued', 'baseline', expect.any(String));
    expect(mockedMarkAnalysisRunProcessing).toHaveBeenCalledWith('run-1');
    expect(mockedRunCaseAnalysis).toHaveBeenCalledWith({
      caseId: 'case-1',
      runId: 'run-1',
      maxCharsPerFile: expect.any(Number),
      maxTotalChars: expect.any(Number),
      executionMode: expect.any(String),
    });

    const finalUpdateCall = mockedQuery.mock.calls.find((call) => String(call[0]).includes("SET analysis_status = 'failed'"));
    expect(finalUpdateCall).toBeDefined();
    expect(finalUpdateCall?.[1]?.[1]).toContain('No extractable text');
    expect(mockedMarkAnalysisRunFailed).toHaveBeenCalledWith('run-1', expect.stringContaining('No extractable text'));
  });

  it('does not create duplicate runs when an active processing run exists', async () => {
    mockedGetLatestActiveAnalysisRun.mockResolvedValueOnce({
      id: 'run-active',
      status: 'processing',
    } as any);

    const result = await analysisWorker.queueCase('case-1');

    expect(result).toEqual({
      analysisRunId: 'run-active',
      analysisStatus: 'processing',
    });
    expect(mockedCreateAnalysisRun).not.toHaveBeenCalled();
  });
});
