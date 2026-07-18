import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';

export const patientFacingDraftRequestSchema = z.object({
  kind: z.enum(['question', 'summary']),
  questionId: z.string().min(1).optional(),
  questionIndex: z.number().int().min(0).optional(),
});

export type PatientFacingDraftRequestBody = z.infer<typeof patientFacingDraftRequestSchema>;

export const parsePatientFacingDraftRequest = (input: unknown): PatientFacingDraftRequestBody => {
  const result = patientFacingDraftRequestSchema.safeParse(input);
  if (!result.success) {
    throw new AppError(result.error.issues[0]?.message || 'Invalid draft request', 400);
  }
  return result.data;
};
