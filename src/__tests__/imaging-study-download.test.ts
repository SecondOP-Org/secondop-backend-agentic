import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import yauzl from 'yauzl';
import { downloadImagingStudy } from '../controllers/file.controller';
import { query } from '../database/connection';
import { AppError } from '../middleware/errorHandler';
import {
  assertStudyDownloadAccess,
  buildStudyZipFilename,
  listStudyInstancesForDownload,
  streamStudyZipToResponse,
} from '../services/imagingStudyDownload.service';

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

const mockedQuery = query as jest.MockedFunction<typeof query>;

const readZipEntries = async (buffer: Buffer): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err || new Error('Failed to open zip'));
        return;
      }
      const names: string[] = [];
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        names.push(entry.fileName);
        zipfile.readEntry();
      });
      zipfile.on('end', () => resolve(names));
      zipfile.on('error', reject);
    });
  });
};

const createStreamingMockResponse = () => {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  const headers: Record<string, string> = {};
  const res = Object.assign(stream, {
    setHeader: jest.fn((key: string, value: string) => {
      headers[key.toLowerCase()] = value;
    }),
    headersSent: false,
  });

  const bufferPromise = new Promise<Buffer>((resolve, reject) => {
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });

  return {
    res: res as unknown as Parameters<typeof streamStudyZipToResponse>[0]['res'],
    headers,
    getBuffer: () => bufferPromise,
  };
};

describe('imaging study download authz', () => {
  const originalOperatorEmails = process.env.COMMAND_CENTER_OPERATOR_EMAILS;
  const originalOperatorIds = process.env.COMMAND_CENTER_OPERATOR_USER_IDS;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.COMMAND_CENTER_OPERATOR_EMAILS;
    delete process.env.COMMAND_CENTER_OPERATOR_USER_IDS;
  });

  afterAll(() => {
    if (originalOperatorEmails === undefined) {
      delete process.env.COMMAND_CENTER_OPERATOR_EMAILS;
    } else {
      process.env.COMMAND_CENTER_OPERATOR_EMAILS = originalOperatorEmails;
    }
    if (originalOperatorIds === undefined) {
      delete process.env.COMMAND_CENTER_OPERATOR_USER_IDS;
    } else {
      process.env.COMMAND_CENTER_OPERATOR_USER_IDS = originalOperatorIds;
    }
  });

  it('allows owning patient / assigned doctor via case access query', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any);
    await expect(assertStudyDownloadAccess('case-1', 'user-patient', false)).resolves.toBeUndefined();
  });

  it('rejects users without case access', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);
    await expect(assertStudyDownloadAccess('case-1', 'user-other', false)).rejects.toMatchObject({
      message: 'You do not have access to this case',
      statusCode: 403,
    });
  });

  it('allows command-center operators when the case exists', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any);
    await expect(assertStudyDownloadAccess('case-1', 'ops-user', true)).resolves.toBeUndefined();
  });

  it('controller returns 403 for unassigned doctor', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

    const req = {
      params: { caseId: 'case-1', studyUid: '1.2.3' },
      user: { id: 'doctor-unassigned', email: 'doc@example.com', type: 'doctor' },
    } as any;
    const res = {
      setHeader: jest.fn(),
    } as any;
    const next = jest.fn();

    await downloadImagingStudy(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const error = next.mock.calls[0][0] as AppError;
    expect(error.statusCode).toBe(403);
  });

  it('controller allows operator on the allowlist', async () => {
    process.env.COMMAND_CENTER_OPERATOR_EMAILS = 'ops@example.com';
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any) // case exists for operator
      .mockResolvedValueOnce({ rows: [{ id: 'case-1', case_number: 'SO-100' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any); // no instances → 404 after authz

    const req = {
      params: { caseId: 'case-1', studyUid: '1.2.3' },
      user: { id: 'ops-1', email: 'ops@example.com', type: 'doctor' },
    } as any;
    const res = { setHeader: jest.fn() } as any;
    const next = jest.fn();

    await downloadImagingStudy(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: 'Imaging study not found for this case',
      })
    );
  });
});

describe('imaging study download zip', () => {
  let tempDir: string;
  const originalUploadDir = process.env.UPLOAD_DIR;

  beforeEach(async () => {
    jest.clearAllMocks();
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sec126-study-'));
    process.env.UPLOAD_DIR = tempDir;
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    if (originalUploadDir === undefined) {
      delete process.env.UPLOAD_DIR;
    } else {
      process.env.UPLOAD_DIR = originalUploadDir;
    }
  });

  it('builds a SecondOp case/modality zip filename', () => {
    expect(buildStudyZipFilename('SO-42', 'CT')).toBe('SecondOp-SO-42-CT-study.zip');
  });

  it('lists instances for a study UID', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          file_id: 'file-1',
          study_instance_uid: '1.2.3',
          series_instance_uid: '1.2.3.1',
          modality: 'CT',
          instance_number: 1,
          file_name: 'slice1.dcm',
          file_url: '/uploads/a.dcm',
          file_size: 10,
        },
        {
          file_id: 'file-2',
          study_instance_uid: '1.2.3',
          series_instance_uid: '1.2.3.1',
          modality: 'CT',
          instance_number: 2,
          file_name: 'slice2.dcm',
          file_url: '/uploads/b.dcm',
          file_size: 12,
        },
      ],
    } as any);

    const instances = await listStudyInstancesForDownload('case-1', '1.2.3');
    expect(instances).toHaveLength(2);
    expect(instances[0].studyUid).toBe('1.2.3');
  });

  it('streams a zip with study/series layout and tolerates missing files', async () => {
    const presentName = 'present.dcm';
    const presentPath = path.join(tempDir, presentName);
    await fs.promises.writeFile(presentPath, Buffer.from('DICOM-BYTES-1'));

    const instances = [
      {
        fileId: 'file-present',
        fileName: 'IM-0001.dcm',
        fileUrl: `/uploads/${presentName}`,
        fileSize: 13,
        studyUid: '1.2.840.study',
        seriesUid: '1.2.840.series',
        modality: 'CT',
        instanceNumber: 1,
      },
      {
        fileId: 'file-missing',
        fileName: 'IM-0002.dcm',
        fileUrl: '/uploads/missing.dcm',
        fileSize: 20,
        studyUid: '1.2.840.study',
        seriesUid: '1.2.840.series',
        modality: 'CT',
        instanceNumber: 2,
      },
    ];

    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'evt-1' }] } as any);

    const { res, headers, getBuffer } = createStreamingMockResponse();
    await streamStudyZipToResponse({
      res,
      caseId: 'case-1',
      caseNumber: 'SO-99',
      studyUid: '1.2.840.study',
      actorUserId: 'doctor-1',
      instances,
    });

    const zipBuffer = await getBuffer();
    const entryNames = await readZipEntries(zipBuffer);

    expect(headers['content-type']).toBe('application/zip');
    expect(headers['content-disposition']).toContain('SecondOp-SO-99-CT-study.zip');
    expect(entryNames).toContain('1.2.840.study/1.2.840.series/IM-0001.dcm');
    expect(entryNames).toContain('manifest.txt');
    expect(entryNames.some((name) => name.includes('IM-0002.dcm'))).toBe(false);

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO imaging_study_download_events'),
      expect.arrayContaining(['case-1', '1.2.840.study', 'doctor-1', 1, expect.any(Number), 1])
    );
  });

  it('returns 404 when a study has no instances', async () => {
    const { res } = createStreamingMockResponse();
    await expect(
      streamStudyZipToResponse({
        res,
        caseId: 'case-1',
        caseNumber: 'SO-1',
        studyUid: 'missing',
        actorUserId: 'user-1',
        instances: [],
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
