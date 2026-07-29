import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  createMyOrganizationInvite,
  getMyOrganization,
  listMyOrganizationInvites,
  previewOrganizationInvite,
} from '../controllers/organization.controller';

const router = Router();

// Public invite preview (token in path).
router.get('/invites/:token', previewOrganizationInvite);

router.use(authenticate);
router.get('/me', authorize('organization'), getMyOrganization);
router.get('/me/invites', authorize('organization'), listMyOrganizationInvites);
router.post('/me/invites', authorize('organization'), createMyOrganizationInvite);

export default router;
