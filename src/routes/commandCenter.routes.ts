import { Router } from 'express';
import {
  getDeployments,
  getIssue,
  getIssues,
  getLatestLedgers,
  getSummary,
} from '../controllers/commandCenter.controller';
import { getServiceHealth } from '../controllers/serviceHealth.controller';
import { getShadowParity } from '../controllers/shadowParity.controller';
import { getFleetAnalysisRuns } from '../controllers/fleetAnalysisRuns.controller';
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

/** Sibling admin route: shadow baseline vs agentic parity (SEC-109). */
export const shadowParityRouter = Router();
shadowParityRouter.use(authenticate);
shadowParityRouter.use(authorizeCommandCenterOperator);
shadowParityRouter.get('/', getShadowParity);

/** Sibling admin route: fleet runs needing attention (SEC-122). */
export const fleetAnalysisRunsRouter = Router();
fleetAnalysisRunsRouter.use(authenticate);
fleetAnalysisRunsRouter.use(authorizeCommandCenterOperator);
fleetAnalysisRunsRouter.get('/', getFleetAnalysisRuns);
