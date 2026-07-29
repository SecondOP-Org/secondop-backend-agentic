import { Response, NextFunction } from 'express';
import { query } from '../database/connection';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';

export const getDoctors = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { specialty, country, minRating } = req.query;
    
    let queryStr = `SELECT d.*, u.email, u.phone 
                    FROM doctors d 
                    JOIN users u ON d.user_id = u.id 
                    WHERE d.verification_status = 'verified'
                      AND d.is_verified = true
                      AND d.is_available = true`;
    const params: any[] = [];

    if (specialty) {
      params.push(specialty);
      queryStr += ` AND d.specialty = $${params.length}`;
    }

    if (country) {
      params.push(country);
      queryStr += ` AND d.country = $${params.length}`;
    }

    if (minRating) {
      params.push(minRating);
      queryStr += ` AND d.rating >= $${params.length}`;
    }

    queryStr += ' ORDER BY d.rating DESC, d.review_count DESC';

    const result = await query(queryStr, params);

    res.json({
      status: 'success',
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
};

export const getDoctorById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { doctorId } = req.params;

    const result = await query(
      `SELECT d.*, u.email, u.phone, u.is_verified as user_verified
       FROM doctors d
       JOIN users u ON d.user_id = u.id
       WHERE d.id = $1`,
      [doctorId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Doctor not found', 404);
    }

    res.json({
      status: 'success',
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

export const searchDoctors = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { query: searchQuery } = req.query;

    if (!searchQuery) {
      throw new AppError('Search query is required', 400);
    }

    const result = await query(
      `SELECT d.*, u.email 
       FROM doctors d
       JOIN users u ON d.user_id = u.id
       WHERE d.verification_status = 'verified'
       AND d.is_verified = true
       AND (
         d.first_name ILIKE $1 OR 
         d.last_name ILIKE $1 OR 
         d.specialty ILIKE $1 OR 
         d.bio ILIKE $1
       )
       ORDER BY d.rating DESC
       LIMIT 20`,
      [`%${searchQuery}%`]
    );

    res.json({
      status: 'success',
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
};

export const getDoctorReviews = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // This would require a reviews table - for now, return empty array
    // In production, you'd have a doctor_reviews table
    res.json({
      status: 'success',
      data: [],
      message: 'Reviews feature coming soon',
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

    // This would require a reviews table
    // For now, just return success
    res.status(201).json({
      status: 'success',
      message: 'Review feature coming soon',
    });
  } catch (error) {
    next(error);
  }
};
