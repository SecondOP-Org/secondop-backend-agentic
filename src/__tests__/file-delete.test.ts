import { deleteFile } from '../controllers/file.controller';
import { query } from '../database/connection';
import { invalidateCaseAnalysisAfterPdfChange } from '../services/medicalFileAnalysis.service';

jest.mock('../database/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../services/dicomImaging.service', () => ({
  extractAndPersistDicomMetadata: jest.fn(),
  getPersistedAnnotations: jest.fn(),
  parseDicomAnnotations: jest.fn(),
  parseDicomViewport: jest.fn(),
  savePersistedAnnotations: jest.fn(),
}));

jest.mock('../services/fileHash.service', () => ({
  computeFileSha256: jest.fn(),
}));

jest.mock('../services/reportExtraction.service', () => ({
  validatePdfUpload: jest.fn(),
}));

jest.mock('../services/medicalFileAnalysis.service', () => {
  const actual = jest.requireActual('../services/medicalFileAnalysis.service');
  return {
    ...actual,
    invalidateCaseAnalysisAfterPdfChange: jest.fn(),
  };
});

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  unlinkSync: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedInvalidate = invalidateCaseAnalysisAfterPdfChange as jest.MockedFunction<
  typeof invalidateCaseAnalysisAfterPdfChange
>;

const createMockResponse = () => {
  const res: {
    status: jest.Mock;
    json: jest.Mock;
  } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return res;
};

describe('file.controller deleteFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedInvalidate.mockResolvedValue(true);
  });

  it('allows patients to delete a PDF from a draft case and invalidates analysis', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'file-1',
            case_id: 'case-1',
            patient_id: 'patient-1',
            uploaded_by: 'user-1',
            file_name: 'report.pdf',
            file_type: 'application/pdf',
            file_size: 100,
            file_url: '/uploads/report.pdf',
            file_category: 'report',
            description: null,
            metadata: null,
            is_dicom: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [{ status: 'draft' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const req = {
      params: { fileId: 'file-1' },
      user: { id: 'user-1', type: 'patient' },
    } as any;
    const res = createMockResponse();
    const next = jest.fn();

    await deleteFile(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockedInvalidate).toHaveBeenCalledWith('case-1');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        data: { caseId: 'case-1', analysisInvalidated: true },
      })
    );
  });

  it('rejects file deletion for non-draft cases', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'file-1',
            case_id: 'case-1',
            patient_id: 'patient-1',
            uploaded_by: 'user-1',
            file_name: 'report.pdf',
            file_type: 'application/pdf',
            file_size: 100,
            file_url: '/uploads/report.pdf',
            file_category: 'report',
            description: null,
            metadata: null,
            is_dicom: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [{ status: 'pending' }] } as any);

    const req = {
      params: { fileId: 'file-1' },
      user: { id: 'user-1', type: 'patient' },
    } as any;
    const res = createMockResponse();
    const next = jest.fn();

    await deleteFile(req, res as any, next);

    expect(mockedInvalidate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('rejects file deletion for doctors', async () => {
    const req = {
      params: { fileId: 'file-1' },
      user: { id: 'doctor-user', type: 'doctor' },
    } as any;
    const res = createMockResponse();
    const next = jest.fn();

    await deleteFile(req, res as any, next);

    expect(mockedQuery).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});
