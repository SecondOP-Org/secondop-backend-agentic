import { AppError } from '../middleware/errorHandler';
import * as appointmentRepository from '../repositories/appointment.repository';

export const createAppointment = async (
  userId: string,
  doctorId: string,
  caseId: string,
  appointmentDate: string,
  appointmentType: string,
  notes: string
) => {
  const patientResult = await appointmentRepository.findPatientIdByUserId(userId);
  const patientId = patientResult[0].id;

  return appointmentRepository.insertAppointment({
    patientId,
    doctorId,
    caseId,
    appointmentDate,
    appointmentType,
    notes,
  });
};

export const getAppointments = async (userId: string, userType: string) => {
  if (userType === 'patient') {
    const patientResult = await appointmentRepository.findPatientIdByUserId(userId);
    const patientId = patientResult[0].id;
    return appointmentRepository.findAppointmentsForPatient(patientId);
  }

  const doctorResult = await appointmentRepository.findDoctorIdByUserId(userId);
  const doctorId = doctorResult[0].id;
  return appointmentRepository.findAppointmentsForDoctor(doctorId);
};

export const getAppointmentById = async (appointmentId: string) => {
  const rows = await appointmentRepository.findAppointmentById(appointmentId);

  if (rows.length === 0) {
    throw new AppError('Appointment not found', 404);
  }

  return rows[0];
};

export const updateAppointment = async (
  appointmentId: string,
  appointmentDate?: string,
  status?: string,
  notes?: string
) => {
  await appointmentRepository.updateAppointment({
    appointmentId,
    appointmentDate,
    status,
    notes,
  });
};

export const cancelAppointment = async (appointmentId: string) => {
  await appointmentRepository.cancelAppointment(appointmentId);
};

export const getDoctorAvailability = async (doctorId: string, date: string) => {
  return appointmentRepository.findDoctorAvailability(doctorId, date);
};
