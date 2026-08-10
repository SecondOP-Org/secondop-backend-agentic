import { AppError } from '../middleware/errorHandler';
import * as caseService from '../services/case.service';
import * as caseRecordsRepository from '../repositories/caseRecords.repository';
import * as fileService from '../services/file.service';
import {
  confirmCaseRecordsIdentity,
  getCaseRecordsStatus,
  startCaseRecordsConnection,
} from '../services/caseRecords.service';

jest.mock('../services/case.service', () => ({
  ensurePatientOwnsCase: jest.fn(),
}));

jest.mock('../repositories/caseRecords.repository');
jest.mock('../services/file.service', () => ({
  insertMedicalFile: jest.fn(),
}));

jest.mock('../config/recordsConnect', () => ({
  isRecordsConnectEnabled: jest.fn(() => true),
  getRecordsMockDelayMs: jest.fn(() => 0),
  getRecordsConnectProvider: jest.fn(() => 'synthea_mock'),
}));

jest.mock('../services/recordsConnect', () => ({
  getActiveRecordsProvider: jest.fn(() => ({
    name: 'synthea_mock',
    fetchForCase: jest.fn(async () => ({
      documentCount: 3,
      medications: 2,
      conditions: 1,
      labs: 4,
      summaryLines: ['Sandbox summary line'],
    })),
  })),
}));

jest.mock('fs/promises', () => ({
  mkdir: jest.fn(async () => undefined),
  writeFile: jest.fn(async () => undefined),
}));

const mockedEnsure = caseService.ensurePatientOwnsCase as jest.MockedFunction<
  typeof caseService.ensurePatientOwnsCase
>;
const mockedRepo = caseRecordsRepository as jest.Mocked<typeof caseRecordsRepository>;
const mockedInsertFile = fileService.insertMedicalFile as jest.MockedFunction<
  typeof fileService.insertMedicalFile
>;

describe('caseRecords.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedEnsure.mockResolvedValue(undefined);
  });

  it('startConnection upserts pending connection', async () => {
    mockedRepo.upsertConnection.mockResolvedValue({
      id: 'row-1',
      case_id: 'case-1',
      connection_id: 'conn-1',
      provider: 'synthea_mock',
      status: 'pending',
      document_count: 0,
      medications_count: 0,
      conditions_count: 0,
      labs_count: 0,
      identity_verified_at: null,
      fetch_started_at: null,
      completed_at: null,
      error_code: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    mockedRepo.updateCaseRecordsStatus.mockResolvedValue(undefined);

    const result = await startCaseRecordsConnection('case-1', 'user-1');

    expect(result.connectionId).toBeTruthy();
    expect(mockedRepo.upsertConnection).toHaveBeenCalled();
    expect(mockedRepo.updateCaseRecordsStatus).toHaveBeenCalledWith('case-1', 'pending');
  });

  it('confirmIdentity requires token and existing connection', async () => {
    mockedRepo.findConnectionByCaseId.mockResolvedValue(null);
    await expect(confirmCaseRecordsIdentity('case-1', 'user-1', '')).rejects.toBeInstanceOf(
      AppError
    );

    mockedRepo.findConnectionByCaseId.mockResolvedValue({
      id: 'row-1',
      case_id: 'case-1',
      connection_id: 'conn-1',
      provider: 'synthea_mock',
      status: 'pending',
      document_count: 0,
      medications_count: 0,
      conditions_count: 0,
      labs_count: 0,
      identity_verified_at: null,
      fetch_started_at: null,
      completed_at: null,
      error_code: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    mockedRepo.markIdentityVerified.mockResolvedValue({
      id: 'row-1',
      case_id: 'case-1',
      connection_id: 'conn-1',
      provider: 'synthea_mock',
      status: 'pending',
      document_count: 0,
      medications_count: 0,
      conditions_count: 0,
      labs_count: 0,
      identity_verified_at: new Date().toISOString(),
      fetch_started_at: new Date().toISOString(),
      completed_at: null,
      error_code: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    mockedRepo.updateCaseRecordsStatus.mockResolvedValue(undefined);

    await confirmCaseRecordsIdentity('case-1', 'user-1', 'sandbox_identity_1');
    expect(mockedRepo.markIdentityVerified).toHaveBeenCalledWith('case-1');
  });

  it('getStatus completes pending fetch after delay and folds a file', async () => {
    const pendingRow = {
      id: 'row-1',
      case_id: 'case-1',
      connection_id: 'conn-1',
      provider: 'synthea_mock',
      status: 'pending',
      document_count: 0,
      medications_count: 0,
      conditions_count: 0,
      labs_count: 0,
      identity_verified_at: new Date(Date.now() - 5000).toISOString(),
      fetch_started_at: new Date(Date.now() - 5000).toISOString(),
      completed_at: null,
      error_code: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockedRepo.findConnectionByCaseId.mockResolvedValue(pendingRow);
    mockedRepo.findPatientIdForCase.mockResolvedValue('patient-1');
    mockedInsertFile.mockResolvedValue({ id: 'file-1' } as any);
    mockedRepo.markConnectionComplete.mockResolvedValue({
      ...pendingRow,
      status: 'complete',
      document_count: 3,
      medications_count: 2,
      conditions_count: 1,
      labs_count: 4,
      completed_at: new Date().toISOString(),
    });
    mockedRepo.updateCaseRecordsStatus.mockResolvedValue(undefined);

    const summary = await getCaseRecordsStatus('case-1', 'user-1');

    expect(summary.status).toBe('complete');
    expect(summary.documentCount).toBe(3);
    expect(summary.normalizedEntities).toEqual({
      medications: 2,
      conditions: 1,
      labs: 4,
    });
    expect(mockedInsertFile).toHaveBeenCalled();
  });
});
