import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import * as doctorService from '../services/doctor.service';

export const getDoctors = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { specialty, country, minRating } = req.query;

    const data = await doctorService.getDoctors({
      specialty: specialty as string | undefined,
      country: country as string | undefined,
      minRating: minRating as string | undefined,
    });

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getDoctorById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { doctorId } = req.params;

    const data = await doctorService.getDoctorById(doctorId);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const searchDoctors = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { query: searchQuery } = req.query;

    const data = await doctorService.searchDoctors(searchQuery as string | undefined);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getDoctorReviews = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await doctorService.getDoctorReviews();

    res.json({
      status: 'success',
      data: result.data,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};

export const addDoctorReview = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    void req.params;
    void req.body;
    void req.user;

    const result = await doctorService.addDoctorReview();

    res.status(201).json({
      status: 'success',
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};
