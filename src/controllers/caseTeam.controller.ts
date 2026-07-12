import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  createCaseInternalNote,
  listCaseInternalNotes,
  type CaseInternalNoteVisibility,
} from '../services/caseInternalNotes.service';

const parseVisibility = (value: unknown): CaseInternalNoteVisibility => {
  if (value === 'coordinator_only') {
    return 'coordinator_only';
  }
  return 'team';
};

export const getCaseInternalNotesHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { caseId } = req.params;
    const notes = await listCaseInternalNotes(caseId, req.user!.id);

    res.json({
      status: 'success',
      data: { notes },
    });
  } catch (error) {
    next(error);
  }
};

export const createCaseInternalNoteHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { caseId } = req.params;
    const note = typeof req.body.note === 'string' ? req.body.note : '';
    const visibility = parseVisibility(req.body.visibility);

    const created = await createCaseInternalNote(caseId, req.user!.id, note, visibility);

    res.status(201).json({
      status: 'success',
      data: { note: created },
      message: 'Internal note added',
    });
  } catch (error) {
    next(error);
  }
};
