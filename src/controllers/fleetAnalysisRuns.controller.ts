import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import {
  listFleetAnalysisRuns,
  type AttentionReason,
} from '../services/analysisRun.service';

const ATTENTION_REASONS = new Set<AttentionReason>([
  'low_confidence',
  'slow',
  'failed_terminal',
  'retried',
]);

export const getFleetAnalysisRuns = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rawReason = typeof req.query.attention_reason === 'string' ? req.query.attention_reason : null;
    const attentionReason =
      rawReason && ATTENTION_REASONS.has(rawReason as AttentionReason)
        ? (rawReason as AttentionReason)
        : null;

    if (rawReason && !attentionReason) {
      throw new AppError(
        'Invalid attention_reason. Expected low_confidence | slow | failed_terminal | retried',
        400
      );
    }

    const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const runs = await listFleetAnalysisRuns({
      attentionReason,
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
    });

    res.json({ status: 'success', data: { runs } });
  } catch (error) {
    next(error);
  }
};
