import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import {
  getCommandCenterDeployments,
  getCommandCenterItem,
  getCommandCenterItems,
  getCommandCenterSummary,
  getLatestLedgerEntries,
} from '../services/commandCenter.service';
import logger from '../utils/logger';

export const getSummary = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const summary = getCommandCenterSummary({
      requestId: req.requestId,
      userId: req.user!.id,
    });

    logger.info('Command-center summary generated', {
      requestId: req.requestId,
      userId: req.user!.id,
      itemCount: summary.items.length,
    });

    res.json({ status: 'success', data: summary });
  } catch (error) {
    next(error);
  }
};

export const getIssues = (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ status: 'success', data: getCommandCenterItems() });
  } catch (error) {
    next(error);
  }
};

export const getIssue = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const item = getCommandCenterItem(req.params.issueKey);
    if (!item) {
      throw new AppError('Command-center issue not found', 404);
    }

    res.json({ status: 'success', data: item });
  } catch (error) {
    next(error);
  }
};

export const getDeployments = (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ status: 'success', data: getCommandCenterDeployments() });
  } catch (error) {
    next(error);
  }
};

export const getLatestLedgers = (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ status: 'success', data: getLatestLedgerEntries() });
  } catch (error) {
    next(error);
  }
};
