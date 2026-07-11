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
