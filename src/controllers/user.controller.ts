import { Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import * as userService from '../services/user.service';

export const getProfile = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const userType = req.user!.type;

    const data = await userService.getProfile(userId, userType);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const userType = req.user!.type;
    const updates = req.body;

    await userService.updateProfile(userId, userType, updates);

    res.json({
      status: 'success',
      message: 'Profile updated successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const uploadAvatar = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const mime = req.file.mimetype.toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime)) {
      throw new AppError('Avatar must be a JPEG, PNG, GIF, or WebP image', 400);
    }

    const userId = req.user!.id;
    const userType = req.user!.type;
    const avatarUrl = `/uploads/${req.file.filename}`;

    const data = await userService.uploadAvatar(userId, userType, avatarUrl);

    res.json({
      status: 'success',
      message: 'Avatar uploaded successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteAvatar = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const userType = req.user!.type;

    await userService.deleteAvatar(userId, userType);

    res.json({
      status: 'success',
      message: 'Avatar removed successfully',
      data: { avatarUrl: null },
    });
  } catch (error) {
    next(error);
  }
};

export const getPatientProfile = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return getProfile(req, res, next);
  } catch (error) {
    next(error);
  }
};

export const updatePatientProfile = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return updateProfile(req, res, next);
  } catch (error) {
    next(error);
  }
};

export const getDoctorProfile = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return getProfile(req, res, next);
  } catch (error) {
    next(error);
  }
};

export const updateDoctorProfile = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return updateProfile(req, res, next);
  } catch (error) {
    next(error);
  }
};
