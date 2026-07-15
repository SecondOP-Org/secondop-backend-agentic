import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../database/connection';
import { AppError } from '../middleware/errorHandler';
import { computeFileSha256 } from './fileHash.service';
import { extractAndPersistDicomMetadata, getImagingStudiesForCase } from './dicomImaging.service';
import {
  createDicomDeidContext,
  deidentifyDicomFileInPlace,
  isDicomDeidEnabled,
  upsertDicomDeidVault,
  type DicomDeidContext,
} from './dicomDeidentification.service';
import { isDicomMagicFile } from '../utils/dicomMagic';
import { listFilesFromDicomdir } from '../utils/dicomdir';
import { extractZipArchive } from '../utils/zipExtract';
import { resolveUploadDir, resolveStoredFilePath } from '../utils/uploadPath';

export const DEFAULT_MAX_STUDY_BYTES = 1024 * 1024 * 1024; // 1 GiB
export const DEFAULT_MAX_STUDY_FILES = 2000;

export const NO_DICOM_FOUND_MESSAGE =
  "We couldn't find any scan images in what you uploaded. Try the folder from your hospital CD or portal download.";

export const CORRUPT_DICOM_MESSAGE =
  'Those scan images appear to be damaged or unreadable.';

export const UPLOAD_CANCELLED_MESSAGE = 'Upload was cancelled.';

const LIKELY_DICOM_EXTENSIONS = new Set(['', '.dcm', '.dicom', '.ima', '.img']);
const OBVIOUS_NON_DICOM_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.txt',
  '.html',
  '.htm',
  '.xml',
  '.pdf',
  '.exe',
  '.dll',
  '.js',
  '.css',
  '.ini',
  '.inf',
  '.url',
  '.lnk',
]);

export interface IngestedStudyFile {
  id: string;
  case_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  file_url: string;
  file_category: string;
  description: string | null;
  is_dicom: boolean;
  created_at: string;
}

export interface ImagingStudyFileFailure {
  fileName: string;
  reason: string;
}

export interface ImagingStudyIngestResult {
  files: IngestedStudyFile[];
  studies: Awaited<ReturnType<typeof getImagingStudiesForCase>>;
  skippedNonDicom: number;
  totalBytes: number;
  /** @deprecated Prefer `ingested` — kept for older clients. */
  instanceCount: number;
  ingested: number;
  failed: ImagingStudyFileFailure[];
  source: 'zip' | 'files';
}

export interface ImagingStudyIngestOptions {
  signal?: AbortSignal;
}

interface PersistInstanceInput {
  caseId: string;
  patientId: string;
  userId: string;
  sourcePath: string;
  displayName: string;
  description?: string;
  deidContext?: DicomDeidContext;
}

const getMaxStudyBytes = (): number =>
  Number.parseInt(process.env.MAX_STUDY_SIZE || String(DEFAULT_MAX_STUDY_BYTES), 10);

const getMaxStudyFiles = (): number =>
  Number.parseInt(process.env.MAX_STUDY_FILES || String(DEFAULT_MAX_STUDY_FILES), 10);

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const isLikelyDicomPath = (filePath: string): boolean => {
  const baseName = path.basename(filePath);
  if (baseName.toUpperCase() === 'DICOMDIR') {
    return true;
  }
  const extension = path.extname(baseName).toLowerCase();
  if (OBVIOUS_NON_DICOM_EXTENSIONS.has(extension)) {
    return false;
  }
  return LIKELY_DICOM_EXTENSIONS.has(extension) || extension === '';
};

const walkFilesRecursive = async (rootDir: string): Promise<string[]> => {
  const discovered: string[] = [];

  const walk = async (current: string) => {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        discovered.push(fullPath);
      }
    }
  };

  await walk(rootDir);
  return discovered;
};

const findDicomdir = async (rootDir: string): Promise<string | null> => {
  const candidates = await walkFilesRecursive(rootDir);
  const match = candidates.find((candidate) => path.basename(candidate).toUpperCase() === 'DICOMDIR');
  return match || null;
};

export const collectDicomInstancePaths = async (
  rootDir: string
): Promise<{
  instancePaths: string[];
  skippedNonDicom: number;
  unreadableCount: number;
  usedDicomdir: boolean;
}> => {
  const dicomdirPath = await findDicomdir(rootDir);
  let candidatePaths: string[] = [];
  let usedDicomdir = false;

  if (dicomdirPath) {
    try {
      candidatePaths = await listFilesFromDicomdir(dicomdirPath);
      usedDicomdir = candidatePaths.length > 0;
    } catch {
      candidatePaths = [];
      usedDicomdir = false;
    }
  }

  if (!usedDicomdir) {
    candidatePaths = await walkFilesRecursive(rootDir);
  }

  const instancePaths: string[] = [];
  let skippedNonDicom = 0;
  let unreadableCount = 0;

  for (const candidate of candidatePaths) {
    const base = path.basename(candidate).toUpperCase();
    if (base === 'DICOMDIR' || base.startsWith('.')) {
      skippedNonDicom += 1;
      continue;
    }

    try {
      const isDicom = await isDicomMagicFile(candidate);
      if (!isDicom) {
        if (isLikelyDicomPath(candidate)) {
          unreadableCount += 1;
        } else {
          skippedNonDicom += 1;
        }
        continue;
      }
      instancePaths.push(candidate);
    } catch {
      unreadableCount += 1;
    }
  }

  return { instancePaths, skippedNonDicom, unreadableCount, usedDicomdir };
};

const persistDicomInstance = async ({
  caseId,
  patientId,
  userId,
  sourcePath,
  displayName,
  description,
  deidContext,
}: PersistInstanceInput): Promise<IngestedStudyFile> => {
  const uploadDir = resolveUploadDir();
  await fs.mkdir(uploadDir, { recursive: true });

  const storedName = `${uuidv4()}.dcm`;
  const destination = path.join(uploadDir, storedName);
  await fs.copyFile(sourcePath, destination);

  let deidResult: Awaited<ReturnType<typeof deidentifyDicomFileInPlace>> | null = null;
  if (isDicomDeidEnabled()) {
    const context = deidContext || createDicomDeidContext(caseId);
    deidResult = await deidentifyDicomFileInPlace(destination, context);
  }

  const stats = await fs.stat(destination);
  const fileUrl = `/uploads/${storedName}`;
  const fileSha256 = await computeFileSha256(destination);

  const result = await query(
    `INSERT INTO medical_files (
      case_id,
      patient_id,
      uploaded_by,
      file_name,
      file_type,
      file_size,
      file_url,
      file_category,
      description,
      is_dicom,
      file_sha256
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'dicom', $8, true, $9)
     RETURNING id, case_id, file_name, file_type, file_size, file_url, file_category, description, is_dicom, created_at`,
    [
      caseId,
      patientId,
      userId,
      displayName,
      'application/dicom',
      stats.size,
      fileUrl,
      description || 'DICOM imaging study instance',
      fileSha256,
    ]
  );

  const fileRecord = result.rows[0] as IngestedStudyFile;

  if (deidResult) {
    await upsertDicomDeidVault({
      fileId: fileRecord.id,
      caseId,
      studyInstanceUid: deidResult.remappedStudyUid,
      mapping: deidResult.mapping,
      audit: deidResult.audit,
    });
  }

  await extractAndPersistDicomMetadata({
    fileId: fileRecord.id,
    caseId,
    filePath: destination,
  });

  return fileRecord;
};

const assertStudyLimits = async (
  instancePaths: string[],
  unreadableCount: number
): Promise<number> => {
  const maxFiles = getMaxStudyFiles();
  const maxBytes = getMaxStudyBytes();

  if (instancePaths.length === 0) {
    if (unreadableCount > 0) {
      throw new AppError(CORRUPT_DICOM_MESSAGE, 400);
    }
    throw new AppError(NO_DICOM_FOUND_MESSAGE, 400);
  }

  if (instancePaths.length > maxFiles) {
    throw new AppError(
      `Too many scan images: received ${instancePaths.length}, maximum is ${maxFiles}.`,
      400
    );
  }

  let totalBytes = 0;
  for (const instancePath of instancePaths) {
    const stats = await fs.stat(instancePath);
    totalBytes += stats.size;
  }

  if (totalBytes > maxBytes) {
    throw new AppError(
      `Upload too large: received ${formatBytes(totalBytes)}, maximum is ${formatBytes(maxBytes)}.`,
      400
    );
  }

  return totalBytes;
};

const cleanupDir = async (dirPath: string | null) => {
  if (!dirPath) {
    return;
  }
  await fs.rm(dirPath, { recursive: true, force: true }).catch(() => undefined);
};

const rollbackIngestedFiles = async (files: IngestedStudyFile[]) => {
  for (const file of files) {
    try {
      const filePath = resolveStoredFilePath(file.file_url);
      await fs.unlink(filePath).catch(() => undefined);
      await query('DELETE FROM medical_files WHERE id = $1', [file.id]);
    } catch {
      // Best-effort cleanup; do not mask the original abort/error.
    }
  }
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new AppError(UPLOAD_CANCELLED_MESSAGE, 400);
  }
};

const ingestInstancePaths = async (input: {
  caseId: string;
  patientId: string;
  userId: string;
  workDir: string;
  instancePaths: string[];
  skippedNonDicom: number;
  unreadableCount: number;
  description?: string;
  source: 'zip' | 'files';
  signal?: AbortSignal;
}): Promise<ImagingStudyIngestResult> => {
  const totalBytes = await assertStudyLimits(input.instancePaths, input.unreadableCount);
  const deidContext = createDicomDeidContext(input.caseId);

  const files: IngestedStudyFile[] = [];
  const failed: ImagingStudyFileFailure[] = [];

  try {
    for (const instancePath of input.instancePaths) {
      throwIfAborted(input.signal);
      const relative = path.relative(input.workDir, instancePath);
      const displayName = relative || path.basename(instancePath);
      try {
        files.push(
          await persistDicomInstance({
            caseId: input.caseId,
            patientId: input.patientId,
            userId: input.userId,
            sourcePath: instancePath,
            displayName,
            description: input.description,
            deidContext,
          })
        );
      } catch {
        failed.push({
          fileName: displayName,
          reason: "Couldn't read this image",
        });
      }
    }

    throwIfAborted(input.signal);

    if (files.length === 0) {
      throw new AppError(CORRUPT_DICOM_MESSAGE, 400);
    }

    const studies = await getImagingStudiesForCase(input.caseId);
    return {
      files,
      studies,
      skippedNonDicom: input.skippedNonDicom,
      totalBytes,
      instanceCount: files.length,
      ingested: files.length,
      failed,
      source: input.source,
    };
  } catch (error) {
    if (error instanceof AppError && error.message === UPLOAD_CANCELLED_MESSAGE) {
      await rollbackIngestedFiles(files);
    }
    throw error;
  }
};

export const ingestImagingStudyFromZip = async (
  input: {
    caseId: string;
    patientId: string;
    userId: string;
    zipPath: string;
    description?: string;
  },
  options: ImagingStudyIngestOptions = {}
): Promise<ImagingStudyIngestResult> => {
  const workDir = path.join(resolveUploadDir(), 'tmp', `study-${uuidv4()}`);
  try {
    throwIfAborted(options.signal);
    await extractZipArchive(input.zipPath, workDir);
    throwIfAborted(options.signal);
    const { instancePaths, skippedNonDicom, unreadableCount } =
      await collectDicomInstancePaths(workDir);
    return await ingestInstancePaths({
      caseId: input.caseId,
      patientId: input.patientId,
      userId: input.userId,
      workDir,
      instancePaths,
      skippedNonDicom,
      unreadableCount,
      description: input.description,
      source: 'zip',
      signal: options.signal,
    });
  } finally {
    await cleanupDir(workDir);
    await fs.unlink(input.zipPath).catch(() => undefined);
  }
};

export const ingestImagingStudyFromFiles = async (
  input: {
    caseId: string;
    patientId: string;
    userId: string;
    files: Express.Multer.File[];
    description?: string;
  },
  options: ImagingStudyIngestOptions = {}
): Promise<ImagingStudyIngestResult> => {
  const workDir = path.join(resolveUploadDir(), 'tmp', `study-${uuidv4()}`);
  try {
    throwIfAborted(options.signal);
    await fs.mkdir(workDir, { recursive: true });

    for (const file of input.files) {
      throwIfAborted(options.signal);
      const relativeName = (file.originalname || file.filename).replace(/^[/\\]+/, '');
      if (relativeName.includes('..')) {
        throw new AppError('Invalid file path in study upload', 400);
      }
      const destination = path.join(workDir, relativeName);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.rename(file.path, destination).catch(async () => {
        await fs.copyFile(file.path, destination);
        await fs.unlink(file.path).catch(() => undefined);
      });
    }

    const { instancePaths, skippedNonDicom, unreadableCount } =
      await collectDicomInstancePaths(workDir);
    return await ingestInstancePaths({
      caseId: input.caseId,
      patientId: input.patientId,
      userId: input.userId,
      workDir,
      instancePaths,
      skippedNonDicom,
      unreadableCount,
      description: input.description,
      source: 'files',
      signal: options.signal,
    });
  } finally {
    await cleanupDir(workDir);
  }
};
