import { Router } from 'express';
import { getMyPractice } from '../controllers/practice.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate, authorize('doctor'));

router.get('/me', getMyPractice);

export default router;
