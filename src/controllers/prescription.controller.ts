import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import * as prescriptionService from '../services/prescription.service';

export const createPrescription = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { patientId, caseId, diagnosis, notes } = req.body;
    const userId = req.user!.id;

    const data = await prescriptionService.createPrescription(
      userId,
      patientId,
      caseId,
      diagnosis,
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

export const getPrescriptions = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const userType = req.user!.type;

    const data = await prescriptionService.getPrescriptions(userId, userType);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getPrescriptionById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { prescriptionId } = req.params;

    const data = await prescriptionService.getPrescriptionById(prescriptionId);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const addMedication = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { prescriptionId } = req.params;
    const { medicationName, dosage, frequency, duration, instructions } = req.body;

    const data = await prescriptionService.addMedication(
      prescriptionId,
      medicationName,
      dosage,
      frequency,
      duration,
      instructions
    );

    res.status(201).json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const updateMedication = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { medicationId } = req.params;
    const { dosage, frequency, instructions } = req.body;

    await prescriptionService.updateMedication(medicationId, dosage, frequency, instructions);

    res.json({
      status: 'success',
      message: 'Medication updated successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const trackAdherence = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { medicationId } = req.params;
    const { taken, takenAt, notes } = req.body;

    const data = await prescriptionService.trackAdherence(medicationId, taken, takenAt, notes);

    res.status(201).json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};
