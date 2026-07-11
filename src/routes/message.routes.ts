import { Router } from 'express';
import {
  sendMessage,
  getMessages,
  markAsRead,
  deleteMessage,
  downloadMessageAttachment,
} from '../controllers/message.controller';
import { authenticate } from '../middleware/auth';
import { upload } from '../middleware/upload';

const router = Router();

router.use(authenticate);

router.post('/', upload.array('attachments', 5), sendMessage);
router.get('/case/:caseId', getMessages);
router.get('/attachments/:filename', downloadMessageAttachment);
router.put('/:messageId/read', markAsRead);
router.delete('/:messageId', deleteMessage);

export default router;

