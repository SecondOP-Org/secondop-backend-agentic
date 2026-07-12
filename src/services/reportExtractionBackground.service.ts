import logger from '../utils/logger';
import { resolveStoredFilePath } from '../utils/uploadPath';
import { extractTextFromReportFile } from './documentExtraction.service';
import {
  isReportMedicalFile,
  MedicalFilePdfRow,
  persistFreshReportExtraction,
  updatePdfExtractionStatus,
} from './medicalFileAnalysis.service';

export const extractAndPersistReportText = async (input: {
  caseId: string;
  row: MedicalFilePdfRow;
  fileSha256: string;
}): Promise<void> => {
  const filePath = resolveStoredFilePath(input.row.file_url);

  try {
    const extracted = await extractTextFromReportFile(
      filePath,
      input.row.file_type,
      input.row.file_name
    );

    await persistFreshReportExtraction({
      caseId: input.caseId,
      row: input.row,
      fileSha256: input.fileSha256,
      text: extracted.text,
      method: extracted.method,
      extractionQuality: extracted.extractionQuality,
      ocrConfidence: extracted.ocrConfidence,
    });

    await updatePdfExtractionStatus(input.row.id, 'succeeded', {
      error: null,
      extractedAt: new Date(),
    });

    logger.info('Report text extracted on upload', {
      caseId: input.caseId,
      fileId: input.row.id,
      fileName: input.row.file_name,
      method: extracted.method,
      extractionQuality: extracted.extractionQuality,
      charCount: extracted.text.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Report text extraction failed.';
    await updatePdfExtractionStatus(input.row.id, 'failed', { error: message });
    logger.warn('Background report extraction failed', {
      caseId: input.caseId,
      fileId: input.row.id,
      fileName: input.row.file_name,
      error: message,
    });
  }
};

export const queueReportExtraction = (input: {
  caseId: string;
  row: MedicalFilePdfRow;
  fileSha256: string;
}): void => {
  if (!isReportMedicalFile(input.row.file_type, input.row.file_name)) {
    return;
  }

  void extractAndPersistReportText(input);
};
