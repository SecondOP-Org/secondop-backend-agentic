import { AppError } from '../middleware/errorHandler';
import * as userRepository from '../repositories/user.repository';
import fs from 'fs/promises';
import { resolveStoredFilePath } from '../utils/uploadPath';

export const getProfile = async (userId: string, userType: string) => {
  const rows =
    userType === 'patient'
      ? await userRepository.findPatientProfileByUserId(userId)
      : await userRepository.findDoctorProfileByUserId(userId);

  if (rows.length === 0) {
    throw new AppError('Profile not found', 404);
  }

  return rows[0];
};

export const updateProfile = async (userId: string, userType: string, updates: Record<string, unknown>) => {
  if (updates.email || updates.phone) {
    await userRepository.updateUserContact({
      userId,
      email: updates.email as string | undefined,
      phone: updates.phone as string | undefined,
    });
  }

  if (userType === 'patient') {
    await userRepository.updatePatientProfile({
      userId,
      firstName: updates.firstName as string | undefined,
      lastName: updates.lastName as string | undefined,
      dateOfBirth: updates.dateOfBirth as string | undefined,
      gender: updates.gender as string | undefined,
      address: updates.address as string | undefined,
      city: updates.city as string | undefined,
      state: updates.state as string | undefined,
      country: updates.country as string | undefined,
      postalCode: updates.postalCode as string | undefined,
      emergencyContactName: updates.emergencyContactName as string | undefined,
      emergencyContactPhone: updates.emergencyContactPhone as string | undefined,
      allergies: updates.allergies as string | undefined,
      currentMedications: updates.currentMedications as string | undefined,
      medicalConditions: updates.medicalConditions as string | undefined,
    });
  } else {
    if (updates.phone) {
      await userRepository.updateUserPhone(userId, updates.phone as string);
    }

    await userRepository.updateDoctorProfile({
      userId,
      firstName: updates.firstName as string | undefined,
      lastName: updates.lastName as string | undefined,
      specialty: updates.specialty as string | undefined,
      bio: updates.bio as string | undefined,
      consultationFee: updates.consultationFee as number | undefined,
      languages: updates.languages as string | undefined,
      subSpecialties: updates.subSpecialties as string | undefined,
      licenseNumber: updates.licenseNumber as string | undefined,
      yearsOfExperience: updates.yearsOfExperience as number | undefined,
      hospitalAffiliation: updates.hospitalAffiliation as string | undefined,
      education: updates.education as string | undefined,
      certifications: updates.certifications as string | undefined,
      city: updates.city as string | undefined,
      country: updates.country as string | undefined,
    });
  }
};

const getAvatarUrl = async (userId: string, userType: string): Promise<string | null> => {
  if (userType === 'patient') {
    return userRepository.getPatientAvatarUrl(userId);
  }
  if (userType === 'doctor') {
    return userRepository.getDoctorAvatarUrl(userId);
  }
  throw new AppError('Avatar is only available for patient and doctor profiles', 403);
};

const updateAvatarUrl = async (userId: string, userType: string, avatarUrl: string | null): Promise<void> => {
  const updated =
    userType === 'patient'
      ? await userRepository.updatePatientAvatar(userId, avatarUrl)
      : userType === 'doctor'
        ? await userRepository.updateDoctorAvatar(userId, avatarUrl)
        : false;

  if (!updated) {
    throw new AppError('Profile not found', 404);
  }
};

const removeStoredAvatar = async (avatarUrl: string | null): Promise<void> => {
  if (!avatarUrl?.startsWith('/uploads/')) {
    return;
  }

  await fs.unlink(resolveStoredFilePath(avatarUrl)).catch(() => undefined);
};

export const uploadAvatar = async (userId: string, userType: string, avatarUrl: string) => {
  const previousUrl = await getAvatarUrl(userId, userType);

  try {
    await updateAvatarUrl(userId, userType, avatarUrl);
  } catch (error) {
    await removeStoredAvatar(avatarUrl);
    throw error;
  }

  if (previousUrl !== avatarUrl) {
    await removeStoredAvatar(previousUrl);
  }

  return { avatarUrl };
};

export const deleteAvatar = async (userId: string, userType: string) => {
  const previousUrl = await getAvatarUrl(userId, userType);

  await updateAvatarUrl(userId, userType, null);
  await removeStoredAvatar(previousUrl);

  return { previousUrl };
};
