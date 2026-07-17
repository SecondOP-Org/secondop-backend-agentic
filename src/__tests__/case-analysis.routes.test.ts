import {
  createCase,
  getCaseAnalysis,
  getCaseAnalysisTrace,
  getCaseById,
  queueCaseAnalysis,
  streamCaseAnalysisProgress,
  submitCase,
} from '../controllers/case.controller';
import { query, transaction } from '../database/connection';
import { analysisWorker } from '../services/analysisWorker.service';
import {
  getLatestAnalysisRun,
  getLatestAnalysisRunByEngine,
  getLatestShadowResultByCaseId,
} from '../services/analysisRun.service';
import { iterateAnalysisProgress } from '../services/analysisProgress.service';
import { getCaseRunTrace } from '../agentic/observability/analysisObservability.service';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { buildCaseAnalysisArtifact } from '../services/analysisArtifact.service';

jest.mock('../utils/caseIdentifier', () => ({
  resolveCaseId: jest.fn(async (identifier: string) => identifier.trim()),
  isUuid: jest.fn(),
}));

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

jest.mock('../services/analysisProgress.service', () => {
  const actual = jest.requireActual('../services/analysisProgress.service');
  return {
    ...actual,
    iterateAnalysisProgress: jest.fn(),
  };
});

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedTransaction = transaction as jest.MockedFunction<typeof transaction>;
const mockedAnalysisWorker = analysisWorker as jest.Mocked<typeof analysisWorker>;
const mockedGetLatestAnalysisRun = getLatestAnalysisRun as jest.MockedFunction<typeof getLatestAnalysisRun>;
const mockedGetLatestAnalysisRunByEngine =
  getLatestAnalysisRunByEngine as jest.MockedFunction<typeof getLatestAnalysisRunByEngine>;
const mockedGetLatestShadowResultByCaseId =
  getLatestShadowResultByCaseId as jest.MockedFunction<typeof getLatestShadowResultByCaseId>;
const mockedGetCaseRunTrace = getCaseRunTrace as jest.MockedFunction<typeof getCaseRunTrace>;
const mockedIterateAnalysisProgress = iterateAnalysisProgress as jest.MockedFunction<
  typeof iterateAnalysisProgress
>;

const createMockResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  res.write = jest.fn().mockReturnValue(true);
  res.end = jest.fn().mockReturnValue(res);
  res.flushHeaders = jest.fn();
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

const createDoctorRequest = (body: any = {}, params: any = {}, queryParams: any = {}): AuthRequest => {
  return {
    body,
    params,
    query: queryParams,
    user: {
      id: 'user-doctor-1',
      email: 'doctor@example.com',
      type: 'doctor',
    },
  } as unknown as AuthRequest;
};

const createOperatorRequest = (body: any = {}, params: any = {}, queryParams: any = {}): AuthRequest => {
  return {
    body,
    params,
    query: queryParams,
    user: {
      id: 'operator-user',
      email: 'operator@example.com',
      type: 'doctor',
    },
  } as unknown as AuthRequest;
};

describe('Case analysis controllers', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      COMMAND_CENTER_OPERATOR_EMAILS: 'operator@example.com',
    };
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

  afterEach(() => {
    process.env = originalEnv;
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
            share_ai_analysis_with_specialists: true,
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

  it('rejects agentic debug fields for non-operator (SEC-110)', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            analysis_status: 'succeeded',
            analysis_summary: 'Chief Concern\nPossible myocarditis',
            analysis_questions: ['Q1', 'Q2', 'Q3'],
            analysis_artifact: null,
            analysis_model: 'gpt-4.1-mini',
            analysis_error: null,
            share_ai_analysis_with_specialists: true,
          },
        ],
      } as any);
    mockedGetLatestAnalysisRun.mockResolvedValueOnce({ id: 'run-baseline' } as any);

    const req = createPatientRequest({}, { caseId: 'case-1' }, { includeAgentic: 'true' });
    const res = createMockResponse();
    const next = jest.fn();

    await getCaseAnalysis(req, res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('returns agentic debug fields when includeAgentic=true for operator (SEC-110)', async () => {
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
            share_ai_analysis_with_specialists: true,
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

    const req = createOperatorRequest({}, { caseId: 'case-1' }, { includeAgentic: 'true' });
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
    mockedGetCaseRunTrace.mockResolvedValueOnce({
      runs: [{ id: 'run-1', status: 'succeeded' }],
      selectedRunId: 'run-1',
      events: [{ step_name: 'clinical-synthesis', step_status: 'completed' }],
      shadow: { final_status: 'succeeded' },
      artifacts: [{ artifact_type: 'final', stage_name: 'persist-results' }],
    } as any);

    // Controller itself is ops-facing; route middleware enforceOperator (tested separately).
    const req = createOperatorRequest({}, { caseId: 'case-1' }, { runId: 'run-1' });
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
    expect(err.message).toContain('At least one medical report');
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

  it('allows submit when PDF is present and AI was skipped', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any)
      .mockResolvedValueOnce({ rows: [{ analysis_status: 'not_started', pdf_count: 1, dicom_count: 0 }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const req = createPatientRequest({ specialistQuestions: [] }, { caseId: 'case-1' });
    const res = createMockResponse();
    const next = jest.fn();

    await submitCase(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      message: 'Case submitted successfully',
    });
    expect(mockedQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE cases'),
      ['case-1', JSON.stringify([]), true, 3]
    );
  });

  it('blocks submit while analysis is still running', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any)
      .mockResolvedValueOnce({ rows: [{ analysis_status: 'processing', pdf_count: 1, dicom_count: 0 }] } as any);

    const req = createPatientRequest({ specialistQuestions: ['Q1', 'Q2', 'Q3'] }, { caseId: 'case-1' });
    const res = createMockResponse();
    const next = jest.fn();

    await submitCase(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0] as AppError;
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain('still running');
  });

  it('allows submit with optional specialist questions after successful analysis', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any)
      .mockResolvedValueOnce({ rows: [{ analysis_status: 'succeeded', pdf_count: 1, dicom_count: 0 }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const req = createPatientRequest({ specialistQuestions: ['Q1', 'Q2'] }, { caseId: 'case-1' });
    const res = createMockResponse();
    const next = jest.fn();

    await submitCase(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockedQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE cases'),
      ['case-1', JSON.stringify(['Q1', 'Q2']), true, 3]
    );
  });

  it('allows submit when analysis failed', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any)
      .mockResolvedValueOnce({ rows: [{ analysis_status: 'failed', pdf_count: 1, dicom_count: 0 }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const req = createPatientRequest({ specialistQuestions: [] }, { caseId: 'case-1' });
    const res = createMockResponse();
    const next = jest.fn();

    await submitCase(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      message: 'Case submitted successfully',
    });
  });

  it('persists shareAiAnalysisWithSpecialists=false on submit', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any)
      .mockResolvedValueOnce({ rows: [{ analysis_status: 'succeeded', pdf_count: 1, dicom_count: 0 }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const req = createPatientRequest(
      { specialistQuestions: ['Q1'], shareAiAnalysisWithSpecialists: false },
      { caseId: 'case-1' }
    );
    const res = createMockResponse();
    const next = jest.fn();

    await submitCase(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockedQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE cases'),
      ['case-1', JSON.stringify(['Q1']), false, 3]
    );
  });

  it('redacts AI analysis for doctors when patient opted out of sharing', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            analysis_status: 'succeeded',
            analysis_summary: 'Chief Concern\nExample concern',
            analysis_questions: ['Q1', 'Q2', 'Q3'],
            analysis_artifact: null,
            analysis_model: 'gpt-4.1-mini',
            analysis_error: null,
            share_ai_analysis_with_specialists: false,
          },
        ],
      } as any);

    const req = createDoctorRequest({}, { caseId: 'case-1' });
    const res = createMockResponse();
    const next = jest.fn();

    await getCaseAnalysis(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: {
        analysisStatus: 'not_started',
        summary: null,
        analysisQuestions: null,
        artifact: null,
        error: null,
        analysisRunId: null,
        observations: null,
        aiAnalysisSharedWithSpecialists: false,
      },
    });
  });

  it('redacts AI fields in getCaseById for doctors when sharing is disabled', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'case-1',
            title: 'Cardiology case',
            analysis_status: 'succeeded',
            analysis_summary: 'Chief Concern\nExample concern',
            analysis_artifact: { structured_summary: { chief_concern: 'Example concern' } },
            share_ai_analysis_with_specialists: false,
          },
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const req = createDoctorRequest({}, { caseId: 'case-1' });
    const res = createMockResponse();
    const next = jest.fn();

    await getCaseById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: expect.objectContaining({
        id: 'case-1',
        analysis_status: 'not_started',
        analysis_summary: null,
        analysis_artifact: null,
        share_ai_analysis_with_specialists: false,
      }),
    });
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

  it('streams authorized analysis progress as NDJSON without clinical fields', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any);
    mockedIterateAnalysisProgress.mockImplementationOnce(async function* () {
      yield {
        event: 'queued',
        runId: 'run-1',
        caseId: 'case-1',
        at: '2026-07-14T12:00:00.000Z',
      };
      yield {
        event: 'extracting_reports',
        runId: 'run-1',
        caseId: 'case-1',
        at: '2026-07-14T12:00:01.000Z',
      };
    });

    const req = createPatientRequest({}, { caseId: 'case-1' });
    req.on = jest.fn();
    const res = createMockResponse();
    const next = jest.fn();

    await streamCaseAnalysisProgress(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/x-ndjson; charset=utf-8'
    );
    expect(res.write).toHaveBeenCalledWith(
      `${JSON.stringify({
        event: 'queued',
        runId: 'run-1',
        caseId: 'case-1',
        at: '2026-07-14T12:00:00.000Z',
      })}\n`
    );
    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining('"event":"extracting_reports"')
    );
    expect(JSON.stringify(res.write.mock.calls)).not.toMatch(/prompt|summary|secret/i);
    expect(res.end).toHaveBeenCalled();
  });

  it('rejects unauthorized progress stream access', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

    const req = createPatientRequest({}, { caseId: 'case-1' });
    const res = createMockResponse();
    const next = jest.fn();

    await streamCaseAnalysisProgress(req, res, next);

    expect(mockedIterateAnalysisProgress).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(403);
  });
});
