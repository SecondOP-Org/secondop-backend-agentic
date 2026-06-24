import { Router } from 'express';
import {
  getDeployments,
  getIssue,
  getIssues,
  getLatestLedgers,
  getSummary,
} from '../controllers/commandCenter.controller';
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
