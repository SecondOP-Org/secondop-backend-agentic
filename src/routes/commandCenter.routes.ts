import { Router } from 'express';
import {
  getDeployments,
  getIssue,
  getIssues,
  getLatestLedgers,
  getSummary,
} from '../controllers/commandCenter.controller';
import { getServiceHealth } from '../controllers/serviceHealth.controller';
import { authenticate } from '../middleware/auth';
import { authorizeCommandCenterOperator } from '../middleware/commandCenterAuth';

const router = Router();

router.use(authenticate);
router.use(authorizeCommandCenterOperator);

router.get('/summary', getSummary);
router.get('/issues', getIssues);
router.get('/issues/:issueKey', getIssue);
router.get('/deployments', getDeployments);
router.get('/ledgers/latest', getLatestLedgers);

export default router;

/** Sibling admin route: same operator allowlist as command center. */
export const serviceHealthRouter = Router();
serviceHealthRouter.use(authenticate);
serviceHealthRouter.use(authorizeCommandCenterOperator);
serviceHealthRouter.get('/', getServiceHealth);
