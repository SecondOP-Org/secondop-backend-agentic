import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../database/connection';
import { AppError } from '../middleware/errorHandler';
import { computeFileSha256 } from './fileHash.service';
import { extractAndPersistDicomMetadata, getImagingStudiesForCase } from './dicomImaging.service';
import { isDicomMagicFile } from '../utils/dicomMagic';
import { listFilesFromDicomdir } from '../utils/dicomdir';
import { extractZipArchive } from '../utils/zipExtract';
import { resolveUploadDir } from '../utils/uploadPath';

export const DEFAULT_MAX_STUDY_BYTES = 1024 * 1024 * 1024; // 1 GiB
export const DEFAULT_MAX_STUDY_FILES = 2000;

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

export interface ImagingStudyIngestResult {
  files: IngestedStudyFile[];
  studies: Awaited<ReturnType<typeof getImagingStudiesForCase>>;
  skippedNonDicom: number;
  totalBytes: number;
  instanceCount: number;
  source: 'zip' | 'files';
}

interface PersistInstanceInput {
  caseId: string;
  patientId: string;
  userId: string;
  sourcePath: string;
  displayName: string;
  description?: string;
}

const getMaxStudyBytes = (): number =>
  Number.parseInt(process.env.MAX_STUDY_SIZE || String(DEFAULT_MAX_STUDY_BYTES), 10);

const getMaxStudyFiles = (): number =>
  Number.parseInt(process.env.MAX_STUDY_FILES || String(DEFAULT_MAX_STUDY_FILES), 10);

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
): Promise<{ instancePaths: string[]; skippedNonDicom: number; usedDicomdir: boolean }> => {
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

  for (const candidate of candidatePaths) {
    const base = path.basename(candidate).toUpperCase();
    if (base === 'DICOMDIR' || base.startsWith('.')) {
      skippedNonDicom += 1;
      continue;
    }

    try {
      const isDicom = await isDicomMagicFile(candidate);
      if (!isDicom) {
        skippedNonDicom += 1;
        continue;
      }
      instancePaths.push(candidate);
    } catch {
      skippedNonDicom += 1;
    }
  }

  return { instancePaths, skippedNonDicom, usedDicomdir };
};

const persistDicomInstance = async ({
  caseId,
  patientId,
  userId,
  sourcePath,
  displayName,
  description,
}: PersistInstanceInput): Promise<IngestedStudyFile> => {
  const stats = await fs.stat(sourcePath);
  const uploadDir = resolveUploadDir();
  await fs.mkdir(uploadDir, { recursive: true });

  const storedName = `${uuidv4()}.dcm`;
  const destination = path.join(uploadDir, storedName);
  await fs.copyFile(sourcePath, destination);

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

  await extractAndPersistDicomMetadata({
    fileId: fileRecord.id,
    caseId,
    filePath: destination,
  });

  return fileRecord;
};

const assertStudyLimits = async (instancePaths: string[]) => {
  const maxFiles = getMaxStudyFiles();
  const maxBytes = getMaxStudyBytes();

  if (instancePaths.length === 0) {
    throw new AppError('No DICOM instances found in the uploaded study', 400);
  }

  if (instancePaths.length > maxFiles) {
    throw new AppError(
      `Study exceeds maximum instance count (${instancePaths.length} > ${maxFiles})`,
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
      `Study exceeds maximum size (${totalBytes} bytes > ${maxBytes} bytes)`,
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

export const ingestImagingStudyFromZip = async (input: {
  caseId: string;
  patientId: string;
  userId: string;
  zipPath: string;
  description?: string;
}): Promise<ImagingStudyIngestResult> => {
  const workDir = path.join(resolveUploadDir(), 'tmp', `study-${uuidv4()}`);
  try {
    await extractZipArchive(input.zipPath, workDir);
    const { instancePaths, skippedNonDicom } = await collectDicomInstancePaths(workDir);
    const totalBytes = await assertStudyLimits(instancePaths);

    const files: IngestedStudyFile[] = [];
    for (const instancePath of instancePaths) {
      const relative = path.relative(workDir, instancePath);
      files.push(
        await persistDicomInstance({
          caseId: input.caseId,
          patientId: input.patientId,
          userId: input.userId,
          sourcePath: instancePath,
          displayName: relative || path.basename(instancePath),
          description: input.description,
        })
      );
    }

    const studies = await getImagingStudiesForCase(input.caseId);
    return {
      files,
      studies,
      skippedNonDicom,
      totalBytes,
      instanceCount: files.length,
      source: 'zip',
    };
  } finally {
    await cleanupDir(workDir);
    await fs.unlink(input.zipPath).catch(() => undefined);
  }
};

export const ingestImagingStudyFromFiles = async (input: {
  caseId: string;
  patientId: string;
  userId: string;
  files: Express.Multer.File[];
  description?: string;
}): Promise<ImagingStudyIngestResult> => {
  const workDir = path.join(resolveUploadDir(), 'tmp', `study-${uuidv4()}`);
  try {
    await fs.mkdir(workDir, { recursive: true });

    for (const file of input.files) {
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

    const { instancePaths, skippedNonDicom } = await collectDicomInstancePaths(workDir);
    const totalBytes = await assertStudyLimits(instancePaths);

    const files: IngestedStudyFile[] = [];
    for (const instancePath of instancePaths) {
      const relative = path.relative(workDir, instancePath);
      files.push(
        await persistDicomInstance({
          caseId: input.caseId,
          patientId: input.patientId,
          userId: input.userId,
          sourcePath: instancePath,
          displayName: relative || path.basename(instancePath),
          description: input.description,
        })
      );
    }

    const studies = await getImagingStudiesForCase(input.caseId);
    return {
      files,
      studies,
      skippedNonDicom,
      totalBytes,
      instanceCount: files.length,
      source: 'files',
    };
  } finally {
    await cleanupDir(workDir);
  }
};
