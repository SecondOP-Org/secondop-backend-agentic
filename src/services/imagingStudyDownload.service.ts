import fs from 'fs';
import path from 'path';
import { Response } from 'express';
import { query } from '../database/connection';
import { AppError } from '../middleware/errorHandler';
import { resolveStoredFilePath } from '../utils/uploadPath';
import logger from '../utils/logger';

// Lazy-load so unrelated file.controller tests (which mock `fs`) do not pull in archiver's
// glob/path-scurry dependency graph at module import time.
const createZipArchiver = () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const archiver = require('archiver') as typeof import('archiver');
  return archiver('zip', { zlib: { level: 1 } });
};

export interface StudyDownloadInstance {
  fileId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  studyUid: string;
  seriesUid: string;
  modality: string | null;
  instanceNumber: number | null;
}

export interface StudyDownloadCaseMeta {
  caseId: string;
  caseNumber: string;
}

const sanitizeZipSegment = (value: string, fallback: string): string => {
  const cleaned = value
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return cleaned || fallback;
};

const zipLeafName = (fileName: string, fileId: string): string => {
  const base = path.basename(fileName || `${fileId}.dcm`);
  const sanitized = sanitizeZipSegment(base, `${fileId}.dcm`);
  return sanitized.includes('.') ? sanitized : `${sanitized}.dcm`;
};

/**
 * Resolve DICOM instances for a case study UID.
 * Supports synthetic UIDs (`study-<fileId>`) used when study_instance_uid is null.
 */
export const listStudyInstancesForDownload = async (
  caseId: string,
  studyUid: string
): Promise<StudyDownloadInstance[]> => {
  const syntheticFileId =
    studyUid.startsWith('study-') && studyUid.length > 'study-'.length
      ? studyUid.slice('study-'.length)
      : null;

  const result = await query(
    `SELECT di.file_id,
            di.study_instance_uid,
            di.series_instance_uid,
            di.modality,
            di.instance_number,
            mf.file_name,
            mf.file_url,
            mf.file_size
     FROM dicom_instances di
     JOIN medical_files mf ON mf.id = di.file_id
     WHERE di.case_id = $1
       AND (
         di.study_instance_uid = $2
         OR (
           $3::text IS NOT NULL
           AND di.study_instance_uid IS NULL
           AND di.file_id::text = $3
         )
       )
     ORDER BY di.series_instance_uid NULLS LAST,
              di.instance_number NULLS LAST,
              mf.created_at ASC`,
    [caseId, studyUid, syntheticFileId]
  );

  return (result.rows as Array<{
    file_id: string;
    study_instance_uid: string | null;
    series_instance_uid: string | null;
    modality: string | null;
    instance_number: number | null;
    file_name: string;
    file_url: string;
    file_size: number;
  }>).map((row) => ({
    fileId: row.file_id,
    fileName: row.file_name,
    fileUrl: row.file_url,
    fileSize: Number(row.file_size) || 0,
    studyUid: row.study_instance_uid || `study-${row.file_id}`,
    seriesUid: row.series_instance_uid || `series-${row.file_id}`,
    modality: row.modality,
    instanceNumber: row.instance_number,
  }));
};

export const getCaseMetaForDownload = async (caseId: string): Promise<StudyDownloadCaseMeta> => {
  const result = await query(`SELECT id, case_number FROM cases WHERE id = $1 LIMIT 1`, [caseId]);
  if (result.rows.length === 0) {
    throw new AppError('Case not found', 404);
  }
  return {
    caseId: result.rows[0].id as string,
    caseNumber: String(result.rows[0].case_number || caseId),
  };
};

/**
 * Strict study-download authz: owning patient, assigned doctor, or command-center operator.
 */
export const assertStudyDownloadAccess = async (
  caseId: string,
  userId: string,
  isOperator: boolean
): Promise<void> => {
  if (isOperator) {
    const caseExists = await query(`SELECT id FROM cases WHERE id = $1 LIMIT 1`, [caseId]);
    if (caseExists.rows.length === 0) {
      throw new AppError('Case not found', 404);
    }
    return;
  }

  const result = await query(
    `SELECT c.id
     FROM cases c
     JOIN patients p ON p.id = c.patient_id
     LEFT JOIN case_assignments ca ON ca.case_id = c.id
     LEFT JOIN doctors d ON d.id = ca.doctor_id
     WHERE c.id = $1
       AND (p.user_id = $2 OR d.user_id = $2)
     LIMIT 1`,
    [caseId, userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('You do not have access to this case', 403);
  }
};

export const buildStudyZipFilename = (
  caseNumber: string,
  modality: string | null | undefined
): string => {
  const safeCase = sanitizeZipSegment(caseNumber, 'case');
  const safeModality = sanitizeZipSegment(modality || 'DICOM', 'DICOM');
  return `SecondOp-${safeCase}-${safeModality}-study.zip`;
};

export const recordStudyDownloadEvent = async (params: {
  caseId: string;
  studyUid: string;
  actorUserId: string;
  instanceCount: number;
  bytesStreamed: number;
  missingCount: number;
}): Promise<void> => {
  await query(
    `INSERT INTO imaging_study_download_events (
       case_id, study_uid, actor_user_id, instance_count, bytes_streamed, missing_count
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.caseId,
      params.studyUid,
      params.actorUserId,
      params.instanceCount,
      params.bytesStreamed,
      params.missingCount,
    ]
  );
};

/**
 * Stream a study as a ZIP to the HTTP response.
 * Serves the de-identified on-disk bytes as-is — never re-identifies DICOM tags.
 */
export const streamStudyZipToResponse = async (params: {
  res: Response;
  caseId: string;
  caseNumber: string;
  studyUid: string;
  actorUserId: string;
  instances: StudyDownloadInstance[];
}): Promise<void> => {
  const { res, caseId, caseNumber, studyUid, actorUserId, instances } = params;

  if (instances.length === 0) {
    throw new AppError('Imaging study not found for this case', 404);
  }

  const primaryModality =
    instances.find((item) => item.modality)?.modality ||
    instances[0]?.modality ||
    null;
  const filename = buildStudyZipFilename(caseNumber, primaryModality);
  const studySegment = sanitizeZipSegment(studyUid, 'study');

  const missing: Array<{ fileId: string; fileName: string; reason: string }> = [];
  const usedEntryNames = new Set<string>();
  let includedCount = 0;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');

  const archive = createZipArchiver();

  const archiveError = new Promise<never>((_, reject) => {
    archive.on('error', (error) => {
      reject(error);
    });
  });

  archive.pipe(res);

  for (const instance of instances) {
    const absolutePath = resolveStoredFilePath(instance.fileUrl);
    if (!fs.existsSync(absolutePath)) {
      logger.warn('Skipping missing DICOM instance during study download', {
        caseId,
        studyUid,
        fileId: instance.fileId,
        path: absolutePath,
      });
      missing.push({
        fileId: instance.fileId,
        fileName: instance.fileName,
        reason: 'file_missing_on_disk',
      });
      continue;
    }

    const seriesSegment = sanitizeZipSegment(instance.seriesUid, `series-${instance.fileId}`);
    let leaf = zipLeafName(instance.fileName, instance.fileId);
    let entryName = `${studySegment}/${seriesSegment}/${leaf}`;
    let suffix = 1;
    while (usedEntryNames.has(entryName)) {
      const ext = path.extname(leaf);
      const stem = ext ? leaf.slice(0, -ext.length) : leaf;
      leaf = `${stem}_${suffix}${ext || '.dcm'}`;
      entryName = `${studySegment}/${seriesSegment}/${leaf}`;
      suffix += 1;
    }
    usedEntryNames.add(entryName);

    // Stream stored (already de-identified) bytes — do not rewrite DICOM tags.
    archive.file(absolutePath, { name: entryName });
    includedCount += 1;
  }

  const manifestLines = [
    'SecondOp imaging study download',
    `caseId=${caseId}`,
    `caseNumber=${caseNumber}`,
    `studyUid=${studyUid}`,
    `requestedInstances=${instances.length}`,
    `includedInstances=${includedCount}`,
    `unavailableInstances=${missing.length}`,
    '',
    'Note: DICOM files are the de-identified stored copies. Tags are not re-identified on download.',
    '',
  ];

  if (missing.length > 0) {
    manifestLines.push('Unavailable files:');
    for (const item of missing) {
      manifestLines.push(`- ${item.fileId}\t${item.fileName}\t${item.reason}`);
    }
    manifestLines.push('');
  }

  archive.append(manifestLines.join('\n'), { name: 'manifest.txt' });

  try {
    await Promise.race([archive.finalize(), archiveError]);
  } catch (error) {
    logger.error('Failed to stream imaging study zip', {
      caseId,
      studyUid,
      error: error instanceof Error ? error.message : String(error),
    });
    if (!res.headersSent) {
      throw new AppError('Failed to create study download', 500);
    }
    throw error;
  }

  const bytesStreamed = archive.pointer();

  try {
    await recordStudyDownloadEvent({
      caseId,
      studyUid,
      actorUserId,
      instanceCount: includedCount,
      bytesStreamed,
      missingCount: missing.length,
    });
  } catch (auditError) {
    // Download already streamed; do not fail the client for audit insert issues.
    logger.error('Failed to record imaging study download audit event', {
      caseId,
      studyUid,
      actorUserId,
      error: auditError instanceof Error ? auditError.message : String(auditError),
    });
  }

  logger.info('Imaging study download completed', {
    caseId,
    studyUid,
    actorUserId,
    instanceCount: includedCount,
    missingCount: missing.length,
    bytesStreamed,
  });
};
