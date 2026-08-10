import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import * as appointmentService from '../services/appointment.service';

export const createAppointment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { doctorId, caseId, appointmentDate, appointmentType, notes } = req.body;
    const userId = req.user!.id;

    const data = await appointmentService.createAppointment(
      userId,
      doctorId,
      caseId,
      appointmentDate,
      appointmentType,
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

export const getAppointments = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const userType = req.user!.type;

    const data = await appointmentService.getAppointments(userId, userType);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getAppointmentById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { appointmentId } = req.params;

    const data = await appointmentService.getAppointmentById(appointmentId);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const updateAppointment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { appointmentId } = req.params;
    const { appointmentDate, status, notes } = req.body;

    await appointmentService.updateAppointment(appointmentId, appointmentDate, status, notes);

    res.json({
      status: 'success',
      message: 'Appointment updated successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const cancelAppointment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { appointmentId } = req.params;

    await appointmentService.cancelAppointment(appointmentId);

    res.json({
      status: 'success',
      message: 'Appointment cancelled successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const getDoctorAvailability = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { doctorId } = req.params;
    const { date } = req.query;

    const data = await appointmentService.getDoctorAvailability(doctorId, date as string);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};
