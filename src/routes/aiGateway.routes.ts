import { Router } from 'express';
import { getAiGatewayStatusController } from '../controllers/aiGateway.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.use(authorize('doctor'));

router.get('/status', getAiGatewayStatusController);

export default router;
