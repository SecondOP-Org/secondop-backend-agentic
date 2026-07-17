import { query } from '../database/connection';
import {
  createAnalysisRun,
  markAnalysisRunFailed,
  markAnalysisRunSucceeded,
} from '../services/analysisRun.service';

jest.mock('../database/connection', () => ({
  query: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;

describe('analysis run metadata persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores version metadata when creating a run', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'run-1',
          case_id: 'case-1',
          status: 'queued',
          engine: 'baseline',
          execution_mode: 'baseline',
          started_at: null,
          completed_at: null,
          model: null,
          error: null,
          error_message: null,
          pipeline_version: '1.0.0',
          model_version: null,
          prompt_version: 'case-analysis-v1',
          latency_ms: null,
          prompt_tokens: null,
          completion_tokens: null,
          total_tokens: null,
          estimated_cost_usd: null,
          created_at: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    } as any);

    const run = await createAnalysisRun('case-1', 'queued', 'baseline', 'baseline');

    expect(run.pipeline_version).toBe('1.0.0');
    expect(run.prompt_version).toBe('case-analysis-v1');
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('pipeline_version'),
      expect.arrayContaining(['case-1', 'queued', 'baseline', 'baseline', '1.0.0', 'case-analysis-v1'])
    );
  });

  it('persists token and latency metadata on success', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ latency_ms: 1200, attempt_count: 1, case_id: 'case-1' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const result = await markAnalysisRunSucceeded('run-1', {
      model: 'gpt-4.1-mini',
      modelVersion: 'gpt-4.1-mini',
      promptTokens: 1200,
      completionTokens: 300,
      totalTokens: 1500,
      criticScore: 91,
      contractPass: true,
      confidenceScore: 0.95,
    });

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('critic_score'),
      expect.arrayContaining(['run-1', 'gpt-4.1-mini', 'gpt-4.1-mini', 1200, 300, 1500, 91, true])
    );
    expect(result.latencyMs).toBe(1200);
    expect(result.caseId).toBe('case-1');
  });

  it('persists error_message on failure', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

    await markAnalysisRunFailed('run-1', 'model timeout');

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('error_message'),
      ['run-1', 'model timeout']
    );
  });
});
