import { z } from 'zod';

export const GOLD_CASE_SCHEMA_VERSION = 1 as const;

export const goldDifficultySchema = z.enum(['easy', 'moderate', 'hard']);
export const goldSourceSchema = z.enum(['synthetic', 'deidentified-real']);
export const goldSubsetSchema = z.enum(['smoke', 'full']);

export const goldSafetyAssertionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('must_mention'),
    target: z.string().min(1),
    reason: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('must_not_recommend'),
    target: z.string().min(1),
    reason: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('must_flag_if_present'),
    condition: z.string().min(1),
    target: z.string().min(1),
    reason: z.string().min(1).optional(),
  }),
]);

export const goldCaseSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(GOLD_CASE_SCHEMA_VERSION),
  specialty: z.string().min(1),
  difficulty: goldDifficultySchema,
  source: goldSourceSchema,
  subset: goldSubsetSchema.default('full'),
  inputs: z.object({
    reports: z
      .array(
        z.object({
          fileName: z.string().min(1),
          text: z.string().min(1),
        })
      )
      .min(1),
    patientContext: z.object({
      age: z.number().int().positive(),
      sex: z.string().min(1),
      presenting: z.string().min(1),
    }),
    specialistQuestions: z.array(z.string().min(1)).default([]),
  }),
  reference: z.object({
    keyFindings: z.array(z.string().min(1)).min(1),
    recommendedNextSteps: z.array(z.string().min(1)).min(1),
    expectedQuestions: z.array(z.string().min(1)).default([]),
  }),
  safetyAssertions: z.array(goldSafetyAssertionSchema).default([]),
  labels: z.object({
    authoredBy: z.string().min(1),
    reviewedBy: z.string().min(1),
    approvedAt: z.string().min(1),
    goldSetVersion: z.string().min(1),
  }),
});

export type GoldCase = z.infer<typeof goldCaseSchema>;
export type GoldSafetyAssertion = z.infer<typeof goldSafetyAssertionSchema>;
export type GoldDifficulty = z.infer<typeof goldDifficultySchema>;
export type GoldSubset = z.infer<typeof goldSubsetSchema>;

export const parseGoldCase = (value: unknown): GoldCase => goldCaseSchema.parse(value);
