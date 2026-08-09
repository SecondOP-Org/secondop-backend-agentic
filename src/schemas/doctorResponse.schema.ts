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

export const recordsReviewedItemSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['report', 'imaging']),
  meta: z.string().optional(),
  /** Specialist confirms the record was reviewed. */
  confirmed: z.boolean().optional(),
});

export const concordanceSchema = z.object({
  level: z.enum(['agree', 'partially_agree', 'disagree']),
  rationale: z.string(),
});

export const doctorCitationSchema = z.object({
  id: z.string().min(1),
  source: z.literal('pubmed').optional().default('pubmed'),
  pmid: z.string().min(1),
  title: z.string().min(1),
  journal: z.string().default(''),
  year: z.number().optional().default(0),
  url: z.string().url(),
  relevanceNote: z.string().optional(),
  /** Specialist keep/drop — default keep. */
  kept: z.boolean().optional().default(true),
});

export const doctorTrialMatchSchema = z.object({
  id: z.string().min(1),
  source: z.literal('clinicaltrials').optional().default('clinicaltrials'),
  nctId: z.string().min(1),
  title: z.string().min(1),
  phase: z.string().optional(),
  status: z.string().min(1),
  url: z.string().url(),
  eligibilitySummary: z.string().optional(),
  kept: z.boolean().optional().default(true),
});

export const doctorResponseDraftSchema = z.object({
  questionAnswers: z.array(doctorQuestionAnswerSchema).default([]),
  summary: z.string().default(''),
  status: z.string().optional(),
  // Optional so PUT drafts that omit keyImages do not wipe captures.
  keyImages: z.array(doctorKeyImageSchema).optional(),
  /** Pure AI draft text per questionId, captured when the doctor clicks Insert AI draft (SEC-111). */
  aiDraftBaselines: z.record(z.string()).optional(),
  recordsReviewed: z.array(recordsReviewedItemSchema).optional().default([]),
  clinicalSummary: z.string().default(''),
  assessment: z.string().default(''),
  concordance: concordanceSchema.optional().nullable(),
  /** Dual-write with summary (recommendations is the preferred field going forward). */
  recommendations: z.string().default(''),
  limitations: z.string().default(''),
  /** Clinical grounding citations — specialist may keep/drop (SEC-206). */
  citations: z.array(doctorCitationSchema).optional(),
  trialMatches: z.array(doctorTrialMatchSchema).optional(),
  /** Quality signal: citation ids the specialist removed. */
  droppedCitationIds: z.array(z.string()).optional(),
  droppedTrialIds: z.array(z.string()).optional(),
});

const doctorResponseSendBaseSchema = doctorResponseDraftSchema.extend({
  questionAnswers: z.array(
    doctorQuestionAnswerSchema.extend({
      answer: z.string().min(1, 'Each question must have a non-empty answer'),
    })
  ),
  attestationAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Attestation is required before sending' }),
  }),
});

export const doctorResponseSendSchema = doctorResponseSendBaseSchema
  .superRefine((data, ctx) => {
    if (!data.clinicalSummary.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'clinicalSummary is required',
        path: ['clinicalSummary'],
      });
    }
    if (!data.assessment.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'assessment is required',
        path: ['assessment'],
      });
    }
    if (!data.limitations.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'limitations is required',
        path: ['limitations'],
      });
    }

    const recommendations = (data.recommendations || '').trim();
    const summary = (data.summary || '').trim();
    if (!recommendations && !summary) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'recommendations or summary is required',
        path: ['recommendations'],
      });
    }

    if (!data.concordance || !data.concordance.level) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'concordance level is required',
        path: ['concordance', 'level'],
      });
    } else if (!data.concordance.rationale?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'concordance rationale is required',
        path: ['concordance', 'rationale'],
      });
    }
  })
  .transform((data) => {
    const recommendations =
      (data.recommendations || '').trim() || (data.summary || '').trim();
    return {
      ...data,
      recommendations,
      // Always keep summary in sync for backward-compatible consumers.
      summary: recommendations,
    };
  });

export type DoctorQuestionAnswer = z.infer<typeof doctorQuestionAnswerSchema>;
export type DoctorKeyImage = z.infer<typeof doctorKeyImageSchema>;
export type RecordsReviewedItem = z.infer<typeof recordsReviewedItemSchema>;
export type DoctorConcordance = z.infer<typeof concordanceSchema>;
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

/** Accept structured payloads that include questionAnswers + summary (legacy + new fields OK). */
export const isStructuredDoctorResponsePayload = (
  body: Record<string, unknown>
): body is Record<string, unknown> & {
  questionAnswers: unknown;
  summary: unknown;
} => Array.isArray(body.questionAnswers) && typeof body.summary === 'string';
