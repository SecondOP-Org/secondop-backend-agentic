import { AppError } from '../middleware/errorHandler';
import * as doctorRepository from '../repositories/doctor.repository';

export const getDoctors = async (filters: {
  specialty?: string;
  country?: string;
  minRating?: string;
}) => {
  return doctorRepository.findDoctors(filters);
};

export const getDoctorById = async (doctorId: string) => {
  const rows = await doctorRepository.findDoctorById(doctorId);

  if (rows.length === 0) {
    throw new AppError('Doctor not found', 404);
  }

  return rows[0];
};

export const searchDoctors = async (searchQuery?: string) => {
  if (!searchQuery) {
    throw new AppError('Search query is required', 400);
  }

  return doctorRepository.searchDoctors(searchQuery);
};

export const getDoctorReviews = async () => {
  return {
    data: [],
    message: 'Reviews feature coming soon',
  };
};

export const addDoctorReview = async () => {
  return {
    message: 'Review feature coming soon',
  };
};
