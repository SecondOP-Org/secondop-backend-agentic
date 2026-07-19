import fs from 'fs';
import { extractTextFromReportFile } from '../services/documentExtraction.service';
import { extractTextWithTextract } from '../services/textractOcr.service';
import { extractTextWithVision } from '../services/visionOcr.service';

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

jest.mock('pdf-parse', () => jest.fn());

jest.mock('../services/textractOcr.service', () => ({
  extractTextWithTextract: jest.fn(),
  isTextractConfigured: jest.fn().mockReturnValue(true),
}));

jest.mock('../services/visionOcr.service', () => ({
  extractTextWithVision: jest.fn(),
  isVisionOcrConfigured: jest.fn().mockReturnValue(true),
}));

import pdfParse from 'pdf-parse';

const mockedReadFile = fs.promises.readFile as jest.MockedFunction<typeof fs.promises.readFile>;
const mockedPdfParse = pdfParse as jest.MockedFunction<typeof pdfParse>;
const mockedTextract = extractTextWithTextract as jest.MockedFunction<typeof extractTextWithTextract>;
const mockedVision = extractTextWithVision as jest.MockedFunction<typeof extractTextWithVision>;

describe('documentExtraction.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OCR_ENABLED = 'true';
    process.env.OCR_TEXTRACT_ENABLED = 'true';
    process.env.OCR_VISION_FALLBACK_ENABLED = 'true';
    process.env.OCR_MIN_CHARS = '40';
    process.env.OCR_TEXTRACT_MIN_CONFIDENCE = '0.75';
    process.env.IMAGE_DEID_ENABLED = 'false';
  });

  it('uses pdf-parse for digital PDFs with sufficient text', async () => {
    mockedReadFile.mockResolvedValue(Buffer.from('%PDF-1.4 digital report'));
    mockedPdfParse.mockResolvedValue({
      text: 'Patient has stable chest pain with normal ECG and serial biomarkers recommended for review.',
    } as any);

    const result = await extractTextFromReportFile('/tmp/report.pdf', 'application/pdf', 'report.pdf');

    expect(result.method).toBe('pdf-parse');
    expect(result.extractionQuality).toBe('high');
    expect(mockedTextract).not.toHaveBeenCalled();
  });

  it('falls back to Textract when pdf-parse text is too short', async () => {
    mockedReadFile.mockResolvedValue(Buffer.from('%PDF-1.4 scanned report'));
    mockedPdfParse.mockResolvedValue({ text: 'short' } as any);
    mockedTextract.mockResolvedValue({
      text: 'Scanned pathology report with elevated inflammatory markers and follow-up imaging recommended.',
      confidence: 0.91,
      hasHandwriting: false,
    });

    const result = await extractTextFromReportFile('/tmp/scan.pdf', 'application/pdf', 'scan.pdf');

    expect(result.method).toBe('textract');
    expect(result.extractionQuality).toBe('medium');
  });

  it('uses vision OCR for image reports', async () => {
    mockedReadFile.mockResolvedValue(Buffer.from('image-bytes'));
    mockedTextract.mockResolvedValue(null);
    mockedVision.mockResolvedValue({
      text: 'Photo of clinic note describing persistent cough and pending chest imaging review.',
      confidence: 0.7,
      hasHandwriting: true,
    });

    const result = await extractTextFromReportFile('/tmp/note.jpg', 'image/jpeg', 'note.jpg');

    expect(result.method).toBe('vision-llm');
    expect(result.extractionQuality).toBe('medium');
    expect(mockedVision).toHaveBeenCalled();
  });
});
