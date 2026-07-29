import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  listDoctorsForVerification,
  setDoctorVerificationStatus,
  DoctorVerificationStatus,
} from '../services/doctorVerification.service';
import { AppError } from '../middleware/errorHandler';

const parseStatus = (value: unknown): DoctorVerificationStatus | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (value === 'pending' || value === 'verified' || value === 'rejected') {
    return value;
  }
  throw new AppError('status must be pending, verified, or rejected', 400);
};

export const listDoctorVerifications = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const status = parseStatus(req.query.status);
    const doctors = await listDoctorsForVerification(status);
    res.json({
      status: 'success',
      data: doctors,
    });
  } catch (error) {
    next(error);
  }
};

export const updateDoctorVerification = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { doctorId } = req.params;
    const { status: toStatus, reason } = req.body as {
      status?: string;
      reason?: string;
    };

    if (toStatus !== 'verified' && toStatus !== 'rejected') {
      throw new AppError('status must be verified or rejected', 400);
    }

    const doctor = await setDoctorVerificationStatus({
      doctorId,
      toStatus,
      actorUserId: req.user!.id,
      reason,
    });

    res.json({
      status: 'success',
      data: doctor,
      message: `Doctor marked ${toStatus}`,
    });
  } catch (error) {
    next(error);
  }
};
