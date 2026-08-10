import { AppError } from '../middleware/errorHandler';
import {
  findDoctorSignEligibilityByDoctorId,
  findDoctorSignEligibilityByUserId,
  findDoctorsForVerification,
  findDoctorVerificationStatusById,
  insertDoctorVerificationEvent,
  updateDoctorVerificationStatus,
} from '../repositories/doctor.repository';

export type DoctorVerificationStatus = 'pending' | 'verified' | 'rejected';
export type OrganizationVerificationStatus = 'pending' | 'verified' | 'rejected';

export const DOCTOR_NOT_CREDENTIAL_VERIFIED_MESSAGE =
  'Doctor account is not credential-verified. Cases cannot be assigned and opinions cannot be signed until verification is complete.';

export const ORGANIZATION_NOT_VERIFIED_MESSAGE =
  'Doctor organization is not verified. Cases cannot be assigned and opinions cannot be signed until the organization partnership is confirmed.';

export type DoctorSignEligibility = {
  id: string;
  verification_status: DoctorVerificationStatus;
  organization_id: string | null;
  organization_verification_status: OrganizationVerificationStatus | null;
};

export const isCredentialVerified = (status: string | null | undefined): boolean => {
  return status === 'verified';
};

/**
 * Hybrid §4 unified gate:
 * canSignOpinion(doctor) =
 *   doctor.verification_status === 'verified'
 *   AND (doctor.organization_id === null
 *        OR organization(doctor).verification_status === 'verified')
 */
export const canSignOpinion = (doctor: {
  verification_status: string | null | undefined;
  organization_id?: string | null;
  organization_verification_status?: string | null;
}): boolean => {
  if (!isCredentialVerified(doctor.verification_status)) {
    return false;
  }

  if (!doctor.organization_id) {
    return true;
  }

  return isCredentialVerified(doctor.organization_verification_status);
};

export const assertCanSignOpinion = (doctor: {
  verification_status: string | null | undefined;
  organization_id?: string | null;
  organization_verification_status?: string | null;
}): void => {
  if (!isCredentialVerified(doctor.verification_status)) {
    throw new AppError(DOCTOR_NOT_CREDENTIAL_VERIFIED_MESSAGE, 403);
  }

  if (doctor.organization_id && !isCredentialVerified(doctor.organization_verification_status)) {
    throw new AppError(ORGANIZATION_NOT_VERIFIED_MESSAGE, 403);
  }
};

/** Load doctor by user id and refuse when unified sign gate fails. */
export const ensureDoctorCredentialVerifiedByUserId = async (userId: string): Promise<void> => {
  const rows = await findDoctorSignEligibilityByUserId(userId);

  if (rows.length === 0) {
    throw new AppError('Doctor profile not found', 404);
  }

  assertCanSignOpinion(rows[0] as DoctorSignEligibility);
};

/** Load doctor by doctors.id and refuse when unified sign gate fails. */
export const ensureDoctorCredentialVerifiedByDoctorId = async (doctorId: string): Promise<void> => {
  const rows = await findDoctorSignEligibilityByDoctorId(doctorId);

  if (rows.length === 0) {
    throw new AppError('Doctor not found', 404);
  }

  assertCanSignOpinion(rows[0] as DoctorSignEligibility);
};

export const listDoctorsForVerification = async (status?: DoctorVerificationStatus) => {
  return findDoctorsForVerification(status);
};

export const setDoctorVerificationStatus = async (input: {
  doctorId: string;
  toStatus: 'verified' | 'rejected';
  actorUserId: string;
  reason?: string | null;
}) => {
  const { doctorId, toStatus, actorUserId } = input;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';

  if (toStatus === 'rejected' && !reason) {
    throw new AppError('A reason is required when rejecting a doctor', 400);
  }

  const existing = await findDoctorVerificationStatusById(doctorId);

  if (existing.length === 0) {
    throw new AppError('Doctor not found', 404);
  }

  const fromStatus = (existing[0] as { verification_status: DoctorVerificationStatus })
    .verification_status;
  const isVerifiedFlag = toStatus === 'verified';

  const updated = await updateDoctorVerificationStatus({
    toStatus,
    reason: reason || null,
    actorUserId,
    isVerifiedFlag,
    doctorId,
  });

  await insertDoctorVerificationEvent({
    doctorId,
    actorUserId,
    fromStatus,
    toStatus,
    reason: reason || null,
  });

  return updated[0];
};
