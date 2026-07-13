import { Router } from 'express';
import { getPresidioStatusController } from '../controllers/presidio.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.use(authorize('doctor'));

router.get('/status', getPresidioStatusController);

export default router;
