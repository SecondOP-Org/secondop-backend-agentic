import { query } from '../database/connection';
import {
  buildShadowComparisonMetrics,
  countMatchingQuestions,
  insertCaseAnalysisArtifact,
  listArtifactsByRunId,
} from '../services/caseAnalysisRunArtifact.service';

jest.mock('../database/connection', () => ({
  query: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;

describe('caseAnalysisRunArtifact.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('inserts and maps a stage artifact row', async () => {
    const createdAt = new Date('2026-07-06T12:00:00.000Z');
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'artifact-1',
          run_id: 'run-1',
          case_id: 'case-1',
          file_id: null,
          artifact_type: 'validation',
          stage_name: 'intake-validation',
          engine: 'baseline',
          artifact_version: '1',
          json_payload: { age: 42 },
          created_at: createdAt,
        },
      ],
    } as any);

    const artifact = await insertCaseAnalysisArtifact({
      runId: 'run-1',
      caseId: 'case-1',
      artifactType: 'validation',
      stageName: 'intake-validation',
      engine: 'baseline',
      payload: { age: 42 },
    });

    expect(artifact.id).toBe('artifact-1');
    expect(artifact.json_payload).toEqual({ age: 42 });
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO case_analysis_artifacts'),
      expect.arrayContaining(['run-1', 'case-1', null, 'validation', 'intake-validation', 'baseline', '1'])
    );
  });

  it('lists artifacts for a run in creation order', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'artifact-1',
          run_id: 'run-1',
          case_id: 'case-1',
          file_id: null,
          artifact_type: 'validation',
          stage_name: 'intake-validation',
          engine: 'baseline',
          artifact_version: '1',
          json_payload: {},
          created_at: new Date(),
        },
      ],
    } as any);

    const artifacts = await listArtifactsByRunId('run-1');

    expect(artifacts).toHaveLength(1);
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE run_id = $1'), ['run-1']);
  });

  it('counts matching questions case-insensitively', () => {
    expect(
      countMatchingQuestions(
        ['What tests are needed?', 'Is imaging urgent?'],
        ['what tests are needed?', 'Different question?']
      )
    ).toBe(1);
  });

  it('builds shadow comparison metrics', () => {
    const metrics = buildShadowComparisonMetrics({
      baselineRunId: 'run-baseline',
      agenticRunId: 'run-agentic',
      baselineAnalysis: {
        summary: 'Baseline summary',
        topQuestions: ['Q1', 'Q2', 'Q3'],
        artifact: {} as any,
        model: 'gpt-4.1-mini',
      },
      agenticSummary: 'Agentic summary',
      agenticQuestions: ['Q1', 'Q2', 'Q4'],
      agenticModel: 'gpt-4.1-mini',
      criticPassed: true,
      criticScore: 95,
    });

    expect(metrics).toMatchObject({
      baselineRunId: 'run-baseline',
      agenticRunId: 'run-agentic',
      matchingQuestionCount: 2,
      agenticCriticPassed: true,
      agenticCriticScore: 95,
    });
  });
});
