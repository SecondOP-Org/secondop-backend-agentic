import { assignDoctorToCase, sendDoctorOpinion } from '../controllers/case.controller';
import {
  listDoctorVerifications,
  updateDoctorVerification,
} from '../controllers/doctorVerification.controller';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { query } from '../database/connection';
import {
  DOCTOR_NOT_CREDENTIAL_VERIFIED_MESSAGE,
  setDoctorVerificationStatus,
} from '../services/doctorVerification.service';

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../database/connection', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../services/doctorOpinionPdf.service', () => ({
  generateDoctorOpinionPdf: jest.fn(),
  generateDoctorOpinionPdfBuffer: jest.fn(),
  buildDoctorOpinionOriginalName: jest.fn(() => 'opinion.pdf'),
}));

jest.mock('../services/doctorResponse.service', () => ({
  ...jest.requireActual('../services/doctorResponse.service'),
  resolveKeyImagesForPdf: jest.fn(async () => []),
  clearDoctorResponseDraft: jest.fn(),
  appendDoctorKeyImage: jest.fn(),
  getDoctorResponse: jest.fn(),
  saveDoctorResponseDraft: jest.fn(),
}));

jest.mock('../services/doctorEditDistance.service', () => ({
  recordAiDraftEditRatioOnSend: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;

const createPatientRequest = (body: Record<string, unknown>, params: Record<string, string>): AuthRequest =>
  ({
    requestId: 'cred-test',
    user: { id: 'patient-user-1', email: 'patient@example.com', type: 'patient' },
    body,
    params,
  }) as unknown as AuthRequest;

const createDoctorRequest = (body: Record<string, unknown>, params: Record<string, string>): AuthRequest =>
  ({
    requestId: 'cred-test',
    user: { id: 'doctor-user-1', email: 'doctor@example.com', type: 'doctor' },
    body,
    params,
  }) as unknown as AuthRequest;

const createOperatorRequest = (): AuthRequest =>
  ({
    requestId: 'cred-test',
    user: { id: 'operator-user', email: 'operator@example.com', type: 'doctor' },
    body: {},
    params: {},
    query: {},
  }) as unknown as AuthRequest;

const createMockResponse = () => {
  const res = {
    json: jest.fn(),
    status: jest.fn(),
    setHeader: jest.fn(),
    send: jest.fn(),
  };
  res.json.mockReturnValue(res);
  res.status.mockReturnValue(res);
  return res;
};

describe('SEC-169 doctor credential verification gates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects case assignment when doctor is not verified', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any) // ensurePatientOwnsCase
      .mockResolvedValueOnce({
        rows: [{ id: 'doctor-1', verification_status: 'pending' }],
      } as any)
      .mockResolvedValueOnce({
        rows: [{ id: 'doctor-1', verification_status: 'pending' }],
      } as any);

    const next = jest.fn();
    await assignDoctorToCase(
      createPatientRequest({ doctorId: 'doctor-1' }, { caseId: 'case-1' }),
      createMockResponse() as any,
      next
    );

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const err = next.mock.calls[0][0] as AppError;
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe(DOCTOR_NOT_CREDENTIAL_VERIFIED_MESSAGE);
  });

  it('rejects opinion signing when doctor is not verified', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any) // ensureDoctorAssignedToCase
      .mockResolvedValueOnce({
        rows: [{ id: 'doctor-row', verification_status: 'pending' }],
      } as any);

    const next = jest.fn();
    await sendDoctorOpinion(
      createDoctorRequest(
        {
          questionAnswers: [{ questionId: 'sq-1', question: 'Q1', answer: 'A1' }],
          summary: 'Summary',
          attestationAccepted: true,
        },
        { caseId: 'case-1' }
      ),
      createMockResponse() as any,
      next
    );

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const err = next.mock.calls[0][0] as AppError;
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe(DOCTOR_NOT_CREDENTIAL_VERIFIED_MESSAGE);
  });

  it('admin can verify a pending doctor and writes an audit event', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'doctor-1', verification_status: 'pending' }],
      } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'doctor-1',
            verification_status: 'verified',
            is_verified: true,
          },
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    const result = await setDoctorVerificationStatus({
      doctorId: 'doctor-1',
      toStatus: 'verified',
      actorUserId: 'operator-user',
      reason: 'License confirmed with state board',
    });

    expect(result.verification_status).toBe('verified');
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO doctor_verification_events'),
      expect.arrayContaining(['doctor-1', 'operator-user', 'pending', 'verified'])
    );
  });

  it('lists pending doctors for admin queue', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'doctor-1',
          verification_status: 'pending',
          email: 'newdoc@example.com',
        },
      ],
    } as any);

    const req = createOperatorRequest();
    req.query = { status: 'pending' };
    const res = createMockResponse();
    const next = jest.fn();

    await listDoctorVerifications(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        data: [expect.objectContaining({ verification_status: 'pending' })],
      })
    );
  });

  it('admin reject requires a reason', async () => {
    const req = createOperatorRequest();
    req.params = { doctorId: 'doctor-1' };
    req.body = { status: 'rejected' };
    const next = jest.fn();

    await updateDoctorVerification(req, createMockResponse() as any, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(400);
  });
});
