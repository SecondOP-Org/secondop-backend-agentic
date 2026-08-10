import { QueryResultRow } from 'pg';
import { dbQuery } from './db';

export const findDoctorIdByUserId = async (userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery('SELECT id FROM doctors WHERE user_id = $1', [userId]);
  return result.rows;
};

export const findPatientIdByUserId = async (userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery('SELECT id FROM patients WHERE user_id = $1', [userId]);
  return result.rows;
};

export interface InsertPrescriptionInput {
  patientId: string;
  doctorId: string;
  caseId: string;
  diagnosis: string;
  notes: string;
}

export const insertPrescription = async (input: InsertPrescriptionInput): Promise<QueryResultRow> => {
  const result = await dbQuery(
    `INSERT INTO prescriptions (patient_id, doctor_id, case_id, diagnosis, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.patientId, input.doctorId, input.caseId, input.diagnosis, input.notes]
  );
  return result.rows[0];
};

export const findPrescriptionsByPatientId = async (patientId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    'SELECT * FROM prescriptions WHERE patient_id = $1 ORDER BY prescribed_date DESC',
    [patientId]
  );
  return result.rows;
};

export const findPrescriptionsByDoctorId = async (doctorId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    'SELECT * FROM prescriptions WHERE doctor_id = $1 ORDER BY prescribed_date DESC',
    [doctorId]
  );
  return result.rows;
};

export const findPrescriptionById = async (prescriptionId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT p.*, 
            d.first_name as doctor_first_name, 
            d.last_name as doctor_last_name,
            pt.first_name as patient_first_name,
            pt.last_name as patient_last_name
     FROM prescriptions p
     JOIN doctors d ON p.doctor_id = d.id
     JOIN patients pt ON p.patient_id = pt.id
     WHERE p.id = $1`,
    [prescriptionId]
  );
  return result.rows;
};

export interface InsertMedicationInput {
  prescriptionId: string;
  medicationName: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

export const insertMedication = async (input: InsertMedicationInput): Promise<QueryResultRow> => {
  const result = await dbQuery(
    `INSERT INTO medications (prescription_id, medication_name, dosage, frequency, duration, instructions)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.prescriptionId,
      input.medicationName,
      input.dosage,
      input.frequency,
      input.duration,
      input.instructions,
    ]
  );
  return result.rows[0];
};

export interface UpdateMedicationInput {
  medicationId: string;
  dosage?: string;
  frequency?: string;
  instructions?: string;
}

export const updateMedication = async (input: UpdateMedicationInput): Promise<void> => {
  await dbQuery(
    `UPDATE medications SET 
     dosage = COALESCE($1, dosage),
     frequency = COALESCE($2, frequency),
     instructions = COALESCE($3, instructions),
     updated_at = CURRENT_TIMESTAMP
     WHERE id = $4`,
    [input.dosage, input.frequency, input.instructions, input.medicationId]
  );
};

export interface InsertMedicationAdherenceInput {
  medicationId: string;
  taken: boolean;
  takenAt: Date;
  notes: string;
}

export const insertMedicationAdherence = async (
  input: InsertMedicationAdherenceInput
): Promise<QueryResultRow> => {
  const result = await dbQuery(
    `INSERT INTO medication_adherence (medication_id, taken, taken_at, notes)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.medicationId, input.taken, input.takenAt, input.notes]
  );
  return result.rows[0];
};
