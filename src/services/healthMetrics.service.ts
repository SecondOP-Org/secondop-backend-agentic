import * as healthMetricsRepository from '../repositories/healthMetrics.repository';

export const addHealthMetric = async (
  userId: string,
  metricType: string,
  value: unknown,
  unit: string,
  notes: string
) => {
  const patientResult = await healthMetricsRepository.findPatientIdByUserId(userId);
  const patientId = patientResult[0].id;

  return healthMetricsRepository.insertHealthMetric({
    patientId,
    metricType,
    value,
    unit,
    notes,
  });
};

export const getHealthMetrics = async (userId: string) => {
  const patientResult = await healthMetricsRepository.findPatientIdByUserId(userId);
  const patientId = patientResult[0].id;

  return healthMetricsRepository.findHealthMetricsByPatientId(patientId);
};

export const getHealthMetricsByType = async (userId: string, type: string) => {
  const patientResult = await healthMetricsRepository.findPatientIdByUserId(userId);
  const patientId = patientResult[0].id;

  return healthMetricsRepository.findHealthMetricsByPatientIdAndType(patientId, type);
};

export const deleteHealthMetric = async (metricId: string) => {
  await healthMetricsRepository.deleteHealthMetric(metricId);
};

export const createHealthGoal = async (
  userId: string,
  goalType: string,
  targetValue: unknown,
  targetDate: string,
  description: string
) => {
  const patientResult = await healthMetricsRepository.findPatientIdByUserId(userId);
  const patientId = patientResult[0].id;

  return healthMetricsRepository.insertHealthGoal({
    patientId,
    goalType,
    targetValue,
    targetDate,
    description,
  });
};

export const getHealthGoals = async (userId: string) => {
  const patientResult = await healthMetricsRepository.findPatientIdByUserId(userId);
  const patientId = patientResult[0].id;

  return healthMetricsRepository.findHealthGoalsByPatientId(patientId);
};

export const updateHealthGoal = async (
  goalId: string,
  status?: string,
  currentValue?: unknown,
  notes?: string
) => {
  await healthMetricsRepository.updateHealthGoal({ goalId, status, currentValue, notes });
};
