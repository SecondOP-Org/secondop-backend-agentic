import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getServiceHealthReport } from '../services/serviceHealth.service';
import logger from '../utils/logger';

export const getServiceHealth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const report = await getServiceHealthReport();

    logger.info('Service health report generated', {
      requestId: req.requestId,
      userId: req.user?.id,
      localEnvironment: report.localEnvironment,
      productionCount: report.environments.find((env) => env.name === 'production')?.services.length,
      stagingCount: report.environments.find((env) => env.name === 'staging')?.services.length,
      localCount: report.local.length,
    });

    res.json({ status: 'success', data: report });
  } catch (error) {
    next(error);
  }
};
