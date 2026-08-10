import {
  confirmCaseRecordsIdentityHandler,
  connectCaseRecordsHandler,
  getCaseRecordsStatusHandler,
} from '../controllers/caseRecords.controller';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import * as caseRecordsService from '../services/caseRecords.service';

jest.mock('../utils/caseIdentifier', () => ({
  resolveCaseId: jest.fn(async (identifier: string) => identifier.trim()),
}));

jest.mock('../services/caseRecords.service', () => ({
  startCaseRecordsConnection: jest.fn(),
  confirmCaseRecordsIdentity: jest.fn(),
  getCaseRecordsStatus: jest.fn(),
}));

const mockedStart = caseRecordsService.startCaseRecordsConnection as jest.MockedFunction<
  typeof caseRecordsService.startCaseRecordsConnection
>;
const mockedConfirm = caseRecordsService.confirmCaseRecordsIdentity as jest.MockedFunction<
  typeof caseRecordsService.confirmCaseRecordsIdentity
>;
const mockedStatus = caseRecordsService.getCaseRecordsStatus as jest.MockedFunction<
  typeof caseRecordsService.getCaseRecordsStatus
>;

const createMockResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const createPatientRequest = (body: Record<string, unknown> = {}, params: { caseId: string }) =>
  ({
    user: { id: 'user-1', type: 'patient' },
    body,
    params,
  }) as unknown as AuthRequest;

describe('case records connect controllers (SEC-216 §5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST connect returns connectionId', async () => {
    mockedStart.mockResolvedValue({ connectionId: 'conn-1' });
    const res = createMockResponse();
    const next = jest.fn();

    await connectCaseRecordsHandler(createPatientRequest({}, { caseId: 'case-1' }), res, next);

    expect(mockedStart).toHaveBeenCalledWith('case-1', 'user-1');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: { connectionId: 'conn-1' },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('POST identity reads verificationToken from body only', async () => {
    mockedConfirm.mockResolvedValue(undefined);
    const res = createMockResponse();
    const next = jest.fn();

    await confirmCaseRecordsIdentityHandler(
      createPatientRequest({ verificationToken: 'sandbox_tok' }, { caseId: 'case-1' }),
      res,
      next
    );

    expect(mockedConfirm).toHaveBeenCalledWith('case-1', 'user-1', 'sandbox_tok');
    expect(res.json).toHaveBeenCalledWith({ status: 'success', data: null });
  });

  it('GET status returns RecordsSummary', async () => {
    mockedStatus.mockResolvedValue({
      status: 'complete',
      documentCount: 3,
      normalizedEntities: { medications: 2, conditions: 1, labs: 4 },
    });
    const res = createMockResponse();
    const next = jest.fn();

    await getCaseRecordsStatusHandler(createPatientRequest({}, { caseId: 'case-1' }), res, next);

    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: {
        status: 'complete',
        documentCount: 3,
        normalizedEntities: { medications: 2, conditions: 1, labs: 4 },
      },
    });
  });

  it('forwards service errors via next', async () => {
    const err = new AppError('Records connect is not enabled', 404);
    mockedStart.mockRejectedValue(err);
    const res = createMockResponse();
    const next = jest.fn();

    await connectCaseRecordsHandler(createPatientRequest({}, { caseId: 'case-1' }), res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});
