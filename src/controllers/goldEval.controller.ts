import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getGoldEvalTrendReport } from '../services/goldEvalRuns.service';
import logger from '../utils/logger';

export const getGoldEvalTrends = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rawLimit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(rawLimit) ? rawLimit : undefined;
    const report = await getGoldEvalTrendReport(limit);

    logger.info('Gold eval trend report generated', {
      requestId: req.requestId,
      userId: req.user?.id,
      runCount: report.runs.length,
      pointCount: report.points.length,
      allGreen: report.checklist.allGreen,
    });

    res.json({ status: 'success', data: report });
  } catch (error) {
    next(error);
  }
};
