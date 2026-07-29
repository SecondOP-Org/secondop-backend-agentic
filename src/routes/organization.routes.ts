import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { getMyOrganization } from '../controllers/organization.controller';

const router = Router();

router.use(authenticate);
router.get('/me', authorize('organization'), getMyOrganization);

export default router;
