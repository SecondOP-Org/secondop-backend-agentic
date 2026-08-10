import { QueryResultRow } from 'pg';
import { dbQuery } from './db';

export const findPatientIdByUserId = async (userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery('SELECT id FROM patients WHERE user_id = $1', [userId]);
  return result.rows;
};

export interface InsertHealthMetricInput {
  patientId: string;
  metricType: string;
  value: unknown;
  unit: string;
  notes: string;
}

export const insertHealthMetric = async (input: InsertHealthMetricInput): Promise<QueryResultRow> => {
  const result = await dbQuery(
    `INSERT INTO health_metrics (patient_id, metric_type, value, unit, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.patientId, input.metricType, input.value, input.unit, input.notes]
  );
  return result.rows[0];
};

export const findHealthMetricsByPatientId = async (patientId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    'SELECT * FROM health_metrics WHERE patient_id = $1 ORDER BY recorded_date DESC',
    [patientId]
  );
  return result.rows;
};

export const findHealthMetricsByPatientIdAndType = async (
  patientId: string,
  metricType: string
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    'SELECT * FROM health_metrics WHERE patient_id = $1 AND metric_type = $2 ORDER BY recorded_date DESC',
    [patientId, metricType]
  );
  return result.rows;
};

export const deleteHealthMetric = async (metricId: string): Promise<void> => {
  await dbQuery('DELETE FROM health_metrics WHERE id = $1', [metricId]);
};

export interface InsertHealthGoalInput {
  patientId: string;
  goalType: string;
  targetValue: unknown;
  targetDate: string;
  description: string;
}

export const insertHealthGoal = async (input: InsertHealthGoalInput): Promise<QueryResultRow> => {
  const result = await dbQuery(
    `INSERT INTO health_goals (patient_id, goal_type, target_value, target_date, description, status)
     VALUES ($1, $2, $3, $4, $5, 'active')
     RETURNING *`,
    [input.patientId, input.goalType, input.targetValue, input.targetDate, input.description]
  );
  return result.rows[0];
};

export const findHealthGoalsByPatientId = async (patientId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    'SELECT * FROM health_goals WHERE patient_id = $1 ORDER BY created_at DESC',
    [patientId]
  );
  return result.rows;
};

export interface UpdateHealthGoalInput {
  goalId: string;
  status?: string;
  currentValue?: unknown;
  notes?: string;
}

export const updateHealthGoal = async (input: UpdateHealthGoalInput): Promise<void> => {
  await dbQuery(
    `UPDATE health_goals SET 
     status = COALESCE($1, status),
     current_value = COALESCE($2, current_value),
     notes = COALESCE($3, notes),
     updated_at = CURRENT_TIMESTAMP
     WHERE id = $4`,
    [input.status, input.currentValue, input.notes, input.goalId]
  );
};
