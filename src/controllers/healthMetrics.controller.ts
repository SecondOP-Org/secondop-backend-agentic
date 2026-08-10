import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import * as healthMetricsService from '../services/healthMetrics.service';

export const addHealthMetric = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { metricType, value, unit, notes } = req.body;
    const userId = req.user!.id;

    const data = await healthMetricsService.addHealthMetric(userId, metricType, value, unit, notes);

    res.status(201).json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getHealthMetrics = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const data = await healthMetricsService.getHealthMetrics(userId);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getHealthMetricsByType = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { type } = req.params;
    const userId = req.user!.id;

    const data = await healthMetricsService.getHealthMetricsByType(userId, type);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteHealthMetric = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { metricId } = req.params;
    await healthMetricsService.deleteHealthMetric(metricId);

    res.json({
      status: 'success',
      message: 'Health metric deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const createHealthGoal = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { goalType, targetValue, targetDate, description } = req.body;
    const userId = req.user!.id;

    const data = await healthMetricsService.createHealthGoal(
      userId,
      goalType,
      targetValue,
      targetDate,
      description
    );

    res.status(201).json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getHealthGoals = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const data = await healthMetricsService.getHealthGoals(userId);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const updateHealthGoal = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { goalId } = req.params;
    const { status, currentValue, notes } = req.body;

    await healthMetricsService.updateHealthGoal(goalId, status, currentValue, notes);

    res.json({
      status: 'success',
      message: 'Health goal updated successfully',
    });
  } catch (error) {
    next(error);
  }
};
