import { Router } from 'express';
import {
  uploadFile,
  uploadImagingStudy,
  getFiles,
  getFileById,
  deleteFile,
  downloadFile,
  getFileAnnotations,
  saveFileAnnotations,
} from '../controllers/file.controller';
import { authenticate } from '../middleware/auth';
import { studyUpload, upload } from '../middleware/upload';

const router = Router();

router.use(authenticate);

router.post('/upload', upload.single('file'), uploadFile);
router.post(
  '/upload-study',
  (req, res, next) => {
    const contentType = String(req.headers['content-type'] || '');
    // Folder uploads send many files; zip uploads send a single archive field.
    if (contentType.includes('multipart/form-data')) {
      studyUpload.fields([
        { name: 'archive', maxCount: 1 },
        { name: 'files', maxCount: parseInt(process.env.MAX_STUDY_FILES || '2000', 10) },
      ])(req, res, (error) => {
        if (error) {
          next(error);
          return;
        }

        const filesField = (req.files as { [fieldname: string]: Express.Multer.File[] } | undefined)
          ?.files;
        const archiveField = (req.files as { [fieldname: string]: Express.Multer.File[] } | undefined)
          ?.archive;

        if (archiveField?.[0]) {
          req.file = archiveField[0];
        } else if (filesField?.length) {
          req.files = filesField;
        }

        next();
      });
      return;
    }

    next();
  },
  uploadImagingStudy
);
router.get('/', getFiles);
router.get('/:fileId', getFileById);
router.get('/:fileId/annotations', getFileAnnotations);
router.put('/:fileId/annotations', saveFileAnnotations);
router.get('/:fileId/download', downloadFile);
router.delete('/:fileId', deleteFile);

export default router;
