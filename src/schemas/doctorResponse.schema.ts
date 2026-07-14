import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';

export const doctorQuestionAnswerSchema = z.object({
  questionId: z.string().min(1),
  question: z.string().min(1),
  answer: z.string(),
});

export const doctorKeyImageSchema = z.object({
  id: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().default('image/png'),
  seriesUid: z.string().min(1),
  seriesDescription: z.string().nullable().optional(),
  instanceNumber: z.number().nullable().optional(),
  sopInstanceUid: z.string().nullable().optional(),
  sourceFileId: z.string().nullable().optional(),
  caption: z.string().optional(),
  capturedAt: z.string().min(1),
});

export const doctorResponseDraftSchema = z.object({
  questionAnswers: z.array(doctorQuestionAnswerSchema).default([]),
  summary: z.string().default(''),
  status: z.string().optional(),
  // Optional so PUT drafts that omit keyImages do not wipe captures.
  keyImages: z.array(doctorKeyImageSchema).optional(),
});

export const doctorResponseSendSchema = doctorResponseDraftSchema.extend({
  questionAnswers: z.array(
    doctorQuestionAnswerSchema.extend({
      answer: z.string().min(1, 'Each question must have a non-empty answer'),
    })
  ),
  summary: z.string().min(1, 'summary is required'),
  attestationAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Attestation is required before sending' }),
  }),
});

export type DoctorQuestionAnswer = z.infer<typeof doctorQuestionAnswerSchema>;
export type DoctorKeyImage = z.infer<typeof doctorKeyImageSchema>;
export type DoctorResponseDraft = z.infer<typeof doctorResponseDraftSchema>;
export type DoctorResponseSendPayload = z.infer<typeof doctorResponseSendSchema>;

export const parseDoctorResponseDraft = (input: unknown): DoctorResponseDraft => {
  const result = doctorResponseDraftSchema.safeParse(input);
  if (!result.success) {
    throw new AppError(result.error.issues[0]?.message || 'Invalid doctor response payload', 400);
  }
  return result.data;
};

export const parseDoctorResponseSend = (input: unknown): DoctorResponseSendPayload => {
  const result = doctorResponseSendSchema.safeParse(input);
  if (!result.success) {
    throw new AppError(result.error.issues[0]?.message || 'Invalid doctor response payload', 400);
  }
  return result.data;
};

export const isStructuredDoctorResponsePayload = (
  body: Record<string, unknown>
): body is Record<string, unknown> & {
  questionAnswers: unknown;
  summary: unknown;
} => Array.isArray(body.questionAnswers) && typeof body.summary === 'string';
