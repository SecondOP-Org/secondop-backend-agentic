import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getPresidioStatus } from '../services/presidioHealth.service';

export const getPresidioStatusController = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const status = await getPresidioStatus();
    res.json({ status: 'success', data: status });
  } catch (error) {
    next(error);
  }
};
