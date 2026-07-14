import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from './errorHandler';
import { resolveUploadDir } from '../utils/uploadPath';

// Configure storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = resolveUploadDir();

    try {
      fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create upload directory';
      cb(new AppError(`Upload directory error: ${message}`, 500), uploadDir);
    }
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

// File filter
const fileFilter = (_req: unknown, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const extension = path.extname(file.originalname).toLowerCase();
  const isDicomByExtension = extension === '.dcm' || extension === '.dicom';

  // Allowed file types
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf',
    'application/dicom',
    'application/x-dicom',
    'application/octet-stream',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    if (file.mimetype === 'application/octet-stream' && !isDicomByExtension) {
      cb(new AppError('Invalid file type', 400));
      return;
    }

    cb(null, true);
  } else {
    cb(new AppError('Invalid file type', 400));
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '52428800'), // 50MB default
  },
});

/** PNG captures from the DICOM viewer for opinion PDF key images. */
export const keyImageUpload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'image/png' || file.mimetype === 'image/jpeg') {
      cb(null, true);
      return;
    }
    cb(new AppError('Key images must be PNG or JPEG', 400));
  },
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

const studyFileFilter = (_req: unknown, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const extension = path.extname(file.originalname).toLowerCase();
  const mime = file.mimetype.toLowerCase();
  const isZip =
    mime === 'application/zip' ||
    mime === 'application/x-zip-compressed' ||
    mime === 'multipart/x-zip' ||
    extension === '.zip';
  const isLikelyDicom =
    mime === 'application/dicom' ||
    mime === 'application/x-dicom' ||
    mime === 'application/octet-stream' ||
    extension === '.dcm' ||
    extension === '.dicom' ||
    extension === '' ||
    path.basename(file.originalname).toUpperCase() === 'DICOMDIR';

  if (isZip || isLikelyDicom) {
    cb(null, true);
    return;
  }

  cb(new AppError('Imaging study upload accepts .zip or DICOM files only', 400));
};

/** Dedicated multer config for whole-study ingest (zip or many DICOM instances). */
export const studyUpload = multer({
  storage,
  fileFilter: studyFileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_STUDY_SIZE || String(1024 * 1024 * 1024), 10),
    files: parseInt(process.env.MAX_STUDY_FILES || '2000', 10),
  },
});
