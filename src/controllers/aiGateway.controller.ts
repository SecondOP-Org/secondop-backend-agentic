import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getAiGatewayStatus } from '../services/aiGatewayStatus.service';

export const getAiGatewayStatusController = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const status = await getAiGatewayStatus();
    res.json({ status: 'success', data: status });
  } catch (error) {
    next(error);
  }
};
