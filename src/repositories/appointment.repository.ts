import { QueryResultRow } from 'pg';
import { dbQuery } from './db';

export const findPatientIdByUserId = async (userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery('SELECT id FROM patients WHERE user_id = $1', [userId]);
  return result.rows;
};

export const findDoctorIdByUserId = async (userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery('SELECT id FROM doctors WHERE user_id = $1', [userId]);
  return result.rows;
};

export interface InsertAppointmentInput {
  patientId: string;
  doctorId: string;
  caseId: string;
  appointmentDate: string;
  appointmentType: string;
  notes: string;
}

export const insertAppointment = async (input: InsertAppointmentInput): Promise<QueryResultRow> => {
  const result = await dbQuery(
    `INSERT INTO appointments (patient_id, doctor_id, case_id, appointment_date, appointment_type, status, notes)
     VALUES ($1, $2, $3, $4, $5, 'scheduled', $6)
     RETURNING *`,
    [
      input.patientId,
      input.doctorId,
      input.caseId,
      input.appointmentDate,
      input.appointmentType,
      input.notes,
    ]
  );
  return result.rows[0];
};

export const findAppointmentsForPatient = async (patientId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT a.*, 
           d.first_name as doctor_first_name,
           d.last_name as doctor_last_name,
           d.specialty
    FROM appointments a
    JOIN doctors d ON a.doctor_id = d.id
    WHERE a.patient_id = $1
    ORDER BY a.appointment_date DESC`,
    [patientId]
  );
  return result.rows;
};

export const findAppointmentsForDoctor = async (doctorId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT a.*, 
           p.first_name as patient_first_name,
           p.last_name as patient_last_name
    FROM appointments a
    JOIN patients p ON a.patient_id = p.id
    WHERE a.doctor_id = $1
    ORDER BY a.appointment_date DESC`,
    [doctorId]
  );
  return result.rows;
};

export const findAppointmentById = async (appointmentId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT a.*, 
            p.first_name as patient_first_name,
            p.last_name as patient_last_name,
            d.first_name as doctor_first_name,
            d.last_name as doctor_last_name,
            d.specialty
     FROM appointments a
     JOIN patients p ON a.patient_id = p.id
     JOIN doctors d ON a.doctor_id = d.id
     WHERE a.id = $1`,
    [appointmentId]
  );
  return result.rows;
};

export interface UpdateAppointmentInput {
  appointmentId: string;
  appointmentDate?: string;
  status?: string;
  notes?: string;
}

export const updateAppointment = async (input: UpdateAppointmentInput): Promise<void> => {
  await dbQuery(
    `UPDATE appointments SET 
     appointment_date = COALESCE($1, appointment_date),
     status = COALESCE($2, status),
     notes = COALESCE($3, notes),
     updated_at = CURRENT_TIMESTAMP
     WHERE id = $4`,
    [input.appointmentDate, input.status, input.notes, input.appointmentId]
  );
};

export const cancelAppointment = async (appointmentId: string): Promise<void> => {
  await dbQuery(
    'UPDATE appointments SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    ['cancelled', appointmentId]
  );
};

export const findDoctorAvailability = async (
  doctorId: string,
  date: string
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT appointment_date, status 
     FROM appointments 
     WHERE doctor_id = $1 AND DATE(appointment_date) = $2`,
    [doctorId, date]
  );
  return result.rows;
};
