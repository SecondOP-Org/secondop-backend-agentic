import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getPracticeForDoctorUser } from '../services/practice.service';

export const getMyPractice = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const practice = await getPracticeForDoctorUser(req.user!.id);

    res.json({
      status: 'success',
      data: { practice },
    });
  } catch (error) {
    next(error);
  }
};
