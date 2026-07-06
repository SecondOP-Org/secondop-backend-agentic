import fs from 'fs';
import { query } from '../database/connection';
import { computeBufferSha256 } from '../services/fileHash.service';
import { invalidateCaseAnalysisAfterPdfChange } from '../services/medicalFileAnalysis.service';
import { extractCaseReports } from '../services/reportExtraction.service';

jest.mock('../database/connection', () => ({
  query: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
  },
}));

jest.mock('../services/fileHash.service', () => {
  const actual = jest.requireActual('../services/fileHash.service');
  return {
    ...actual,
    computeFileSha256: jest.fn(),
  };
});

jest.mock('pdf-parse', () => jest.fn());

import { computeFileSha256 } from '../services/fileHash.service';
import pdfParse from 'pdf-parse';

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockedReadFile = fs.promises.readFile as jest.MockedFunction<typeof fs.promises.readFile>;
const mockedComputeFileSha256 = computeFileSha256 as jest.MockedFunction<typeof computeFileSha256>;
const mockedPdfParse = pdfParse as jest.MockedFunction<typeof pdfParse>;

const pdfRow = {
  id: 'file-1',
  file_name: 'report.pdf',
  file_type: 'application/pdf',
  file_url: '/uploads/report.pdf',
  file_sha256: 'hash-1',
  pdf_validation_status: 'succeeded',
  pdf_validation_error: null,
  pdf_extraction_status: 'pending',
  pdf_extraction_error: null,
  pdf_extracted_at: null,
};

describe('reportExtraction reuse', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedExistsSync.mockReturnValue(true);
    mockedComputeFileSha256.mockResolvedValue('hash-1');
    mockedReadFile.mockResolvedValue(Buffer.from('%PDF-1.4 clinical report text content long enough for extraction'));
    mockedPdfParse.mockResolvedValue({ text: 'Clinical report text content long enough for extraction' } as any);
  });

  it('reuses cached extraction when file hash is unchanged', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [pdfRow] } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'extraction-1',
            file_id: 'file-1',
            case_id: 'case-1',
            file_sha256: 'hash-1',
            extraction_method: 'pdf-parse',
            extracted_text: 'Cached clinical report text content long enough for extraction',
            char_count: 58,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const reports = await extractCaseReports('case-1', 12000, 30000);

    expect(reports).toHaveLength(1);
    expect(reports[0].reused).toBe(true);
    expect(reports[0].extractionMethod).toBe('cache');
    expect(mockedPdfParse).not.toHaveBeenCalled();
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('pdf_extraction_status = $2'),
      expect.arrayContaining(['file-1', 'reused'])
    );
  });

  it('reprocesses and stores extraction when no reusable artifact exists', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [pdfRow] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'extraction-1' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const reports = await extractCaseReports('case-1', 12000, 30000);

    expect(reports).toHaveLength(1);
    expect(reports[0].reused).toBe(false);
    expect(reports[0].extractionMethod).toBe('pdf-parse');
    expect(mockedPdfParse).toHaveBeenCalled();
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO medical_file_extractions'),
      expect.arrayContaining(['file-1', 'case-1', 'hash-1', 'pdf-parse'])
    );
  });
});

describe('medicalFileAnalysis invalidation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('invalidates succeeded analysis after PDF file change', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any);

    const invalidated = await invalidateCaseAnalysisAfterPdfChange('case-1');

    expect(invalidated).toBe(true);
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("analysis_status = 'not_started'"),
      ['case-1']
    );
  });
});

describe('fileHash.service', () => {
  it('computes stable sha256 for the same buffer', () => {
    const buffer = Buffer.from('sample-pdf-content');
    expect(computeBufferSha256(buffer)).toBe(computeBufferSha256(buffer));
    expect(computeBufferSha256(buffer)).toHaveLength(64);
  });
});
