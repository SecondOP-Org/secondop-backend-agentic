import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getShadowParityReport } from '../services/shadowParity.service';
import logger from '../utils/logger';

export const getShadowParity = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rawLimit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : NaN;
    const sampleLimit = Number.isFinite(rawLimit) ? rawLimit : undefined;
    const report = await getShadowParityReport(sampleLimit);

    logger.info('Shadow parity report generated', {
      requestId: req.requestId,
      userId: req.user?.id,
      pairCount: report.pairCount,
      verdict: report.verdict.code,
    });

    res.json({ status: 'success', data: report });
  } catch (error) {
    next(error);
  }
};
