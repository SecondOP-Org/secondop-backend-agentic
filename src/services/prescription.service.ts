import { AppError } from '../middleware/errorHandler';
import * as prescriptionRepository from '../repositories/prescription.repository';

export const createPrescription = async (
  userId: string,
  patientId: string,
  caseId: string,
  diagnosis: string,
  notes: string
) => {
  const doctorResult = await prescriptionRepository.findDoctorIdByUserId(userId);
  const doctorId = doctorResult[0].id;

  return prescriptionRepository.insertPrescription({
    patientId,
    doctorId,
    caseId,
    diagnosis,
    notes,
  });
};

export const getPrescriptions = async (userId: string, userType: string) => {
  if (userType === 'patient') {
    const patientResult = await prescriptionRepository.findPatientIdByUserId(userId);
    const patientId = patientResult[0].id;
    return prescriptionRepository.findPrescriptionsByPatientId(patientId);
  }

  const doctorResult = await prescriptionRepository.findDoctorIdByUserId(userId);
  const doctorId = doctorResult[0].id;
  return prescriptionRepository.findPrescriptionsByDoctorId(doctorId);
};

export const getPrescriptionById = async (prescriptionId: string) => {
  const rows = await prescriptionRepository.findPrescriptionById(prescriptionId);

  if (rows.length === 0) {
    throw new AppError('Prescription not found', 404);
  }

  return rows[0];
};

export const addMedication = async (
  prescriptionId: string,
  medicationName: string,
  dosage: string,
  frequency: string,
  duration: string,
  instructions: string
) => {
  return prescriptionRepository.insertMedication({
    prescriptionId,
    medicationName,
    dosage,
    frequency,
    duration,
    instructions,
  });
};

export const updateMedication = async (
  medicationId: string,
  dosage?: string,
  frequency?: string,
  instructions?: string
) => {
  await prescriptionRepository.updateMedication({ medicationId, dosage, frequency, instructions });
};

export const trackAdherence = async (
  medicationId: string,
  taken: boolean,
  takenAt?: Date,
  notes?: string
) => {
  return prescriptionRepository.insertMedicationAdherence({
    medicationId,
    taken,
    takenAt: takenAt || new Date(),
    notes: notes || '',
  });
};
