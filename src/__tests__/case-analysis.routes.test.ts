import {
  createCase,
  getCaseAnalysis,
  getCaseAnalysisTrace,
  queueCaseAnalysis,
  submitCase,
} from '../controllers/case.controller';
import { query, transaction } from '../database/connection';
import { analysisWorker } from '../services/analysisWorker.service';
import {
  getLatestAnalysisRun,
  getLatestAnalysisRunByEngine,
  getLatestShadowResultByCaseId,
} from '../services/analysisRun.service';
import { getCaseRunTrace } from '../agentic/observability/analysisObservability.service';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { buildCaseAnalysisArtifact } from '../services/analysisArtifact.service';

jest.mock('../database/connection', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../services/analysisWorker.service', () => ({
  analysisWorker: {
    queueCase: jest.fn(),
    recoverInterruptedJobs: jest.fn(),
  },
}));

jest.mock('../services/analysisRun.service', () => ({
  getLatestAnalysisRun: jest.fn(),
  getLatestAnalysisRunByEngine: jest.fn(),
  getLatestShadowResultByCaseId: jest.fn(),
}));

jest.mock('../agentic/observability/analysisObservability.service', () => ({
  getCaseRunTrace: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedTransaction = transaction as jest.MockedFunction<typeof transaction>;
const mockedAnalysisWorker = analysisWorker as jest.Mocked<typeof analysisWorker>;
const mockedGetLatestAnalysisRun = getLatestAnalysisRun as jest.MockedFunction<typeof getLatestAnalysisRun>;
const mockedGetLatestAnalysisRunByEngine =
  getLatestAnalysisRunByEngine as jest.MockedFunction<typeof getLatestAnalysisRunByEngine>;
const mockedGetLatestShadowResultByCaseId =
  getLatestShadowResultByCaseId as jest.MockedFunction<typeof getLatestShadowResultByCaseId>;
const mockedGetCaseRunTrace = getCaseRunTrace as jest.MockedFunction<typeof getCaseRunTrace>;

const createMockResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const createPatientRequest = (body: any = {}, params: any = {}, queryParams: any = {}): AuthRequest => {
  return {
    body,
    params,
    query: queryParams,
    user: {
      id: 'user-patient-1',
      email: 'patient@example.com',
      type: 'patient',
    },
  } as unknown as AuthRequest;
};

describe('Case analysis controllers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetLatestAnalysisRun.mockResolvedValue(null);
    mockedGetLatestAnalysisRunByEngine.mockResolvedValue(null);
    mockedGetLatestShadowResultByCaseId.mockResolvedValue(null);
    mockedGetCaseRunTrace.mockResolvedValue({
      runs: [],
      selectedRunId: null,
      events: [],
      shadow: null,
      artifacts: [],
      runTokenUsageByRunId: {},
      selectedRunTokenUsage: null,
    });
  });

  it('creates a draft case with intake data', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'patient-1' }] } as any);

    mockedTransaction.mockImplementationOnce(async (callback: any) => {
      const client = {
        query: jest
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'case-1',
                case_number: 'SO1234',
                title: 'Cardiology second opinion',
                status: 'draft',
              },
            ],
          })
          .mockResolvedValueOnce({ rows: [] }),
      };

      return callback(client as any);
    });

    const req = createPatientRequest({
      title: 'Cardiology second opinion',
      description: 'Chest pain and dizziness',
      specialty: 'cardiology',
      status: 'draft',
      intake: {
        age: 52,
        sex: 'male',
        specialtyContext: 'cardiology',
        symptoms: 'Chest pain and dizziness',
        symptomDuration: '3 weeks',
        medicalHistory: 'Hypertension',
        currentMedications: 'Lisinopril',
        allergies: 'None',
      },
    });

    const res = createMockResponse();
    const next = jest.fn();

    await createCase(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        data: expect.objectContaining({ id: 'case-1' }),
      })
    );
  });

  it('queues analysis when intake and PDF reports exist', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any)
      .mockResolvedValueOnce({ rows: [{ case_id: 'case-1' }] } as any)
      .mockResolvedValueOnce({ rows: [{ file_count: 1 }] } as any);

    mockedAnalysisWorker.queueCase.mockResolvedValueOnce({
      analysisRunId: 'run-1',
      analysisStatus: 'queued',
    } as any);

    const req = createPatientRequest({}, { caseId: 'case-1' });
    const res = createMockResponse();
    const next = jest.fn();

    await queueCaseAnalysis(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockedAnalysisWorker.queueCase).toHaveBeenCalledWith('case-1');
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: {
        caseId: 'case-1',
        analysisStatus: 'queued',
        analysisRunId: 'run-1',
      },
    });
  });

  it('returns analysis status payloads for polling', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            analysis_status: 'succeeded',
            analysis_summary: 'Chief Concern\nExample concern\nRed Flags To Discuss\nSevere pain worsening',
            analysis_questions: ['Q1', 'Q2', 'Q3'],
            analysis_artifact: null,
            analysis_model: 'gpt-4.1-mini',
            analysis_error: null,
          },
        ],
      } as any);
    mockedGetLatestAnalysisRun.mockResolvedValueOnce({
      id: 'run-2',
    } as any);

    const req = createPatientRequest({}, { caseId: 'case-1' });
    const res = createMockResponse();
    const next = jest.fn();

    await getCaseAnalysis(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        data: expect.objectContaining({
          analysisStatus: 'succeeded',
          summary: 'Example concern',
          analysisQuestions: ['Q1', 'Q2', 'Q3'],
          artifact: expect.objectContaining({
            confidence_score: 0.5,
          }),
          error: null,
          analysisRunId: 'run-2',
          observations: ['Chief Concern: Example concern', 'Red Flags To Discuss: Severe pain worsening'],
        }),
      })
    );
  });

  it('returns agentic debug fields when includeAgentic=true', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            analysis_status: 'succeeded',
            analysis_summary: 'Chief Concern\nPossible myocarditis with uncertain etiology',
            analysis_questions: ['Q1', 'Q2', 'Q3'],
            analysis_artifact: buildCaseAnalysisArtifact({
              structuredSummary: {
                chief_concern: 'Possible myocarditis with uncertain etiology',
                key_report_findings: 'Elevated troponin',
                red_flags_to_discuss: 'Worsening chest pain',
                follow_up_discussion_points: 'Cardiac MRI consideration',
                limitations_caveats: 'Requires clinician review',
              },
              specialistQuestions: ['Q1', 'Q2', 'Q3'],
              model: 'gpt-4.1-mini',
            }),
            analysis_model: 'gpt-4.1-mini',
            analysis_error: null,
          },
        ],
      } as any);

    mockedGetLatestAnalysisRun.mockResolvedValueOnce({ id: 'run-baseline' } as any);
    mockedGetLatestAnalysisRunByEngine.mockResolvedValueOnce({
      id: 'run-agentic',
      status: 'succeeded',
      execution_mode: 'shadow',
    } as any);
    mockedGetLatestShadowResultByCaseId.mockResolvedValueOnce({
      critic_score_json: {
        passed: true,
        score: 100,
        reasons: [],
      },
    } as any);

    const req = createPatientRequest({}, { caseId: 'case-1' }, { includeAgentic: 'true' });
    const res = createMockResponse();
    const next = jest.fn();

    await getCaseAnalysis(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        data: expect.objectContaining({
          analysisRunId: 'run-baseline',
          agenticRunId: 'run-agentic',
          agenticShadowStatus: 'succeeded',
          executionMode: 'shadow',
          agenticMode: 'shadow',
          agenticCriticScore: {
            passed: true,
            score: 100,
            reasons: [],
          },
        }),
      })
    );
  });

  it('returns analysis trace payload for observability', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any);

    mockedGetCaseRunTrace.mockResolvedValueOnce({
      runs: [{ id: 'run-1', status: 'succeeded' }],
      selectedRunId: 'run-1',
      events: [{ step_name: 'clinical-synthesis', step_status: 'completed' }],
      shadow: { final_status: 'succeeded' },
      artifacts: [{ artifact_type: 'final', stage_name: 'persist-results' }],
    } as any);

    const req = createPatientRequest({}, { caseId: 'case-1' }, { runId: 'run-1' });
    const res = createMockResponse();
    const next = jest.fn();

    await getCaseAnalysisTrace(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockedGetCaseRunTrace).toHaveBeenCalledWith('case-1', 'run-1');
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: {
        runs: [{ id: 'run-1', status: 'succeeded' }],
        selectedRunId: 'run-1',
        events: [{ step_name: 'clinical-synthesis', step_status: 'completed' }],
        shadow: { final_status: 'succeeded' },
        artifacts: [{ artifact_type: 'final', stage_name: 'persist-results' }],
      },
    });
  });

  it('rejects analysis start when no PDF reports are attached', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any)
      .mockResolvedValueOnce({ rows: [{ case_id: 'case-1' }] } as any)
      .mockResolvedValueOnce({ rows: [{ file_count: 0 }] } as any);

    const req = createPatientRequest({}, { caseId: 'case-1' });
    const res = createMockResponse();
    const next = jest.fn();

    await queueCaseAnalysis(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0] as AppError;
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain('At least one PDF file is required');
  });

  it('returns failed analysis payload with a clear extraction error', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            analysis_status: 'failed',
            analysis_summary: null,
            analysis_questions: null,
            analysis_error: 'No extractable text found in uploaded PDF reports.',
          },
        ],
      } as any);
    mockedGetLatestAnalysisRun.mockResolvedValueOnce({
      id: 'run-3',
    } as any);

    const req = createPatientRequest({}, { caseId: 'case-1' });
    const res = createMockResponse();
    const next = jest.fn();

    await getCaseAnalysis(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: {
        analysisStatus: 'failed',
        summary: null,
        analysisQuestions: null,
        artifact: null,
        error: 'No extractable text found in uploaded PDF reports.',
        analysisRunId: 'run-3',
        observations: null,
      },
    });
  });

  it('blocks submit when analysis has not succeeded', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any)
      .mockResolvedValueOnce({ rows: [{ analysis_status: 'processing', pdf_count: 1, dicom_count: 0 }] } as any);

    const req = createPatientRequest(
      {
        specialistQuestions: ['Q1', 'Q2', 'Q3'],
      },
      { caseId: 'case-1' }
    );

    const res = createMockResponse();
    const next = jest.fn();

    await submitCase(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0] as AppError;
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain('analysis must succeed');
  });

  it('blocks submit when specialist questions count is not exactly three', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any)
      .mockResolvedValueOnce({ rows: [{ analysis_status: 'succeeded', pdf_count: 1, dicom_count: 0 }] } as any);

    const req = createPatientRequest(
      {
        specialistQuestions: ['Q1', 'Q2'],
      },
      { caseId: 'case-1' }
    );

    const res = createMockResponse();
    const next = jest.fn();

    await submitCase(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0] as AppError;
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain('exactly 3');
  });

  it('enforces ownership and returns 403 for cross-tenant access', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

    const req = createPatientRequest({}, { caseId: 'case-1' });
    const res = createMockResponse();
    const next = jest.fn();

    await getCaseAnalysis(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0] as AppError;
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain('do not have access');
  });
});
