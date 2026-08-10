import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import * as labResultsService from '../services/labResults.service';

export const addLabResult = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { patientId, caseId, testName, testType, results, referenceRange, unit, status, notes } =
      req.body;
    const userId = req.user!.id;

    const data = await labResultsService.addLabResult(
      userId,
      patientId,
      caseId,
      testName,
      testType,
      results,
      referenceRange,
      unit,
      status,
      notes
    );

    res.status(201).json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getLabResults = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const data = await labResultsService.getLabResults(userId);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getLabResultById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { labResultId } = req.params;

    const data = await labResultsService.getLabResultById(labResultId);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const updateLabResult = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { labResultId } = req.params;
    const { results, status, notes } = req.body;

    await labResultsService.updateLabResult(labResultId, results, status, notes);

    res.json({
      status: 'success',
      message: 'Lab result updated successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const deleteLabResult = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { labResultId } = req.params;
    await labResultsService.deleteLabResult(labResultId);

    res.json({
      status: 'success',
      message: 'Lab result deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
