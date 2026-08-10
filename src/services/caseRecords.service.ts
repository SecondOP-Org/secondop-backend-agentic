import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { AppError } from '../middleware/errorHandler';
import { ensurePatientOwnsCase } from './case.service';
import {
  getRecordsMockDelayMs,
  isRecordsConnectEnabled,
} from '../config/recordsConnect';
import { getActiveRecordsProvider } from './recordsConnect';
import * as caseRecordsRepository from '../repositories/caseRecords.repository';
import * as fileService from './file.service';

export type RecordsStatus = 'none' | 'pending' | 'partial' | 'complete' | 'failed';

export interface RecordsSummary {
  status: RecordsStatus;
  documentCount: number;
  normalizedEntities?: { medications: number; conditions: number; labs: number };
}

const assertEnabled = (): void => {
  if (!isRecordsConnectEnabled()) {
    throw new AppError('Records connect is not enabled', 404);
  }
};

const toSummary = (
  row: caseRecordsRepository.RecordsConnectionRow | null
): RecordsSummary => {
  if (!row) {
    return { status: 'none', documentCount: 0 };
  }
  return {
    status: row.status as RecordsStatus,
    documentCount: row.document_count,
    normalizedEntities: {
      medications: row.medications_count,
      conditions: row.conditions_count,
      labs: row.labs_count,
    },
  };
};

const writeSyntheticSummaryFile = async (
  caseId: string,
  lines: string[]
): Promise<{ filePath: string; fileName: string; fileSize: number; sha256: string }> => {
  const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
  await fs.mkdir(uploadDir, { recursive: true });
  const fileName = `records-connect-${caseId.slice(0, 8)}-${Date.now()}.txt`;
  const absolute = path.join(uploadDir, fileName);
  const body = `${lines.join('\n')}\n`;
  await fs.writeFile(absolute, body, 'utf8');
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  return {
    filePath: `/uploads/${fileName}`,
    fileName,
    fileSize: Buffer.byteLength(body, 'utf8'),
    sha256,
  };
};

const completeFetchIfReady = async (
  caseId: string,
  userId: string,
  row: caseRecordsRepository.RecordsConnectionRow
): Promise<caseRecordsRepository.RecordsConnectionRow> => {
  if (row.status !== 'pending' || !row.identity_verified_at) {
    return row;
  }

  const startedAt = row.fetch_started_at
    ? new Date(row.fetch_started_at).getTime()
    : new Date(row.identity_verified_at).getTime();
  const elapsed = Date.now() - startedAt;
  if (elapsed < getRecordsMockDelayMs()) {
    return row;
  }

  try {
    const provider = getActiveRecordsProvider();
    const result = await provider.fetchForCase({
      caseId,
      connectionId: row.connection_id,
    });

    const patientId = await caseRecordsRepository.findPatientIdForCase(caseId);
    if (!patientId) {
      throw new AppError('Case not found', 404);
    }

    const file = await writeSyntheticSummaryFile(caseId, result.summaryLines);
    await fileService.insertMedicalFile({
      caseId,
      patientId,
      uploadedBy: userId,
      fileName: file.fileName,
      fileType: 'text/plain',
      fileSize: file.fileSize,
      fileUrl: file.filePath,
      fileCategory: 'records_connect',
      description: 'Connected health records summary (sandbox)',
      isDicom: false,
      fileSha256: file.sha256,
      pdfValidationStatus: null,
      pdfExtractionStatus: null,
    });

    const completed = await caseRecordsRepository.markConnectionComplete({
      caseId,
      status: 'complete',
      documentCount: result.documentCount,
      medications: result.medications,
      conditions: result.conditions,
      labs: result.labs,
    });
    await caseRecordsRepository.updateCaseRecordsStatus(caseId, 'complete');
    return completed || row;
  } catch {
    const failed = await caseRecordsRepository.markConnectionComplete({
      caseId,
      status: 'failed',
      documentCount: 0,
      medications: 0,
      conditions: 0,
      labs: 0,
      errorCode: 'provider_fetch_failed',
    });
    await caseRecordsRepository.updateCaseRecordsStatus(caseId, 'failed');
    return failed || row;
  }
};

export const startCaseRecordsConnection = async (
  caseId: string,
  userId: string
): Promise<{ connectionId: string }> => {
  assertEnabled();
  await ensurePatientOwnsCase(caseId, userId);

  const provider = getActiveRecordsProvider();
  const connectionId = crypto.randomUUID();
  await caseRecordsRepository.upsertConnection({
    caseId,
    connectionId,
    provider: provider.name,
    status: 'pending',
  });
  await caseRecordsRepository.updateCaseRecordsStatus(caseId, 'pending');

  return { connectionId };
};

export const confirmCaseRecordsIdentity = async (
  caseId: string,
  userId: string,
  verificationToken: string
): Promise<void> => {
  assertEnabled();
  await ensurePatientOwnsCase(caseId, userId);

  const token = typeof verificationToken === 'string' ? verificationToken.trim() : '';
  if (!token) {
    throw new AppError('verificationToken is required', 400);
  }
  // Token is opaque; do not log. Sandbox FE sends sandbox_identity_* tokens.
  if (token.length > 2048) {
    throw new AppError('verificationToken is invalid', 400);
  }

  const existing = await caseRecordsRepository.findConnectionByCaseId(caseId);
  if (!existing) {
    throw new AppError('Start a records connection before confirming identity', 400);
  }

  const updated = await caseRecordsRepository.markIdentityVerified(caseId);
  if (!updated) {
    throw new AppError('Records connection not found', 404);
  }
  await caseRecordsRepository.updateCaseRecordsStatus(caseId, 'pending');
};

export const getCaseRecordsStatus = async (
  caseId: string,
  userId: string
): Promise<RecordsSummary> => {
  assertEnabled();
  await ensurePatientOwnsCase(caseId, userId);

  let row = await caseRecordsRepository.findConnectionByCaseId(caseId);
  if (!row) {
    return { status: 'none', documentCount: 0 };
  }

  row = await completeFetchIfReady(caseId, userId, row);
  return toSummary(row);
};
