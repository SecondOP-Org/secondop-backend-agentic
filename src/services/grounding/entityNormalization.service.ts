import OpenAI from 'openai';
import { getOpenAIClient, isLiteLlmMode, validateLiteLlmModelAlias } from '../../ai/llmGateway';
import { buildLlmRequestMetadata } from '../../ai/llmRequestMetadata';
import logger from '../../utils/logger';
import { resolveDrug } from './rxNorm.client';
import {
  NormalizedCondition,
  NormalizedEntities,
  NormalizedMedication,
} from './types';

const ENTITY_NORMALIZATION_PROMPT_VERSION = 'entity-normalization-v1';

const SYSTEM_PROMPT = [
  'You extract discrete clinical entities from free-text intake fields for reference lookup.',
  'Return strict JSON only. Never invent patient identifiers, names, or narrative quotes.',
  'Medications: discrete drug names only (no doses/schedules unless part of the name).',
  'Conditions: short clinical phrases suitable for PubMed/ClinicalTrials queries.',
  'evidenceTerms: 2–6 de-identified search terms combining conditions and key modifiers (specialty context ok).',
  'Optional condition codes may be suggested (SNOMED or ICD10) when confident; otherwise omit.',
  `Prompt version: ${ENTITY_NORMALIZATION_PROMPT_VERSION}`,
].join('\n');

interface LlmExtraction {
  medications?: string[];
  conditions?: Array<{ raw: string; code?: string; system?: 'SNOMED' | 'ICD10' }>;
  evidenceTerms?: string[];
}

const splitMedicationsHeuristic = (raw: string): string[] =>
  raw
    .split(/[,;/\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

const bestEffortFromRaw = (input: {
  currentMedications: string;
  medicalHistory: string;
  symptoms: string;
  specialtyContext: string;
}): NormalizedEntities => {
  const medications: NormalizedMedication[] = splitMedicationsHeuristic(input.currentMedications).map(
    (raw) => ({ raw, unresolved: true })
  );
  const conditions: NormalizedCondition[] = [];
  for (const blob of [input.medicalHistory, input.symptoms]) {
    const phrases = blob
      .split(/[,;\n]+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 2)
      .slice(0, 5);
    for (const raw of phrases) {
      conditions.push({ raw });
    }
  }
  const evidenceTerms = [
    ...conditions.map((c) => c.raw).slice(0, 4),
    input.specialtyContext.trim(),
  ].filter(Boolean);

  return { medications, conditions, evidenceTerms };
};

const extractViaLlm = async (input: {
  currentMedications: string;
  medicalHistory: string;
  symptoms: string;
  specialtyContext: string;
}): Promise<LlmExtraction | null> => {
  const client = getOpenAIClient({ optional: true });
  if (!client) {
    return null;
  }

  const model =
    process.env.GROUNDING_NORMALIZATION_MODEL ||
    process.env.AGENTIC_MODEL ||
    process.env.OPENAI_MODEL ||
    'gpt-4.1-mini';
  validateLiteLlmModelAlias(model);

  const completionRequest: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
    metadata?: Record<string, string>;
  } = {
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          `Specialty context: ${input.specialtyContext || '(none)'}`,
          `Current medications: ${input.currentMedications || '(none)'}`,
          `Medical history: ${input.medicalHistory || '(none)'}`,
          `Symptoms: ${input.symptoms || '(none)'}`,
        ].join('\n'),
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'normalized_intake_entities',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            medications: {
              type: 'array',
              items: { type: 'string' },
            },
            conditions: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  raw: { type: 'string' },
                  code: { type: 'string' },
                  system: { type: 'string' },
                },
                required: ['raw', 'code', 'system'],
              },
            },
            evidenceTerms: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['medications', 'conditions', 'evidenceTerms'],
        },
      },
    },
  };

  if (isLiteLlmMode()) {
    completionRequest.metadata = buildLlmRequestMetadata({
      workflow: 'entity_normalization',
      modelAlias: model,
    });
  }

  const completion = await client.chat.completions.create(completionRequest);
  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    return null;
  }

  return JSON.parse(raw) as LlmExtraction;
};

/**
 * Normalize free-text intake into discrete entities + RxNorm resolution.
 * Fail-soft: never throws into the pipeline.
 */
export const normalizeIntakeEntities = async (input: {
  currentMedications: string;
  medicalHistory: string;
  symptoms: string;
  specialtyContext: string;
}): Promise<NormalizedEntities> => {
  try {
    let medicationsRaw: string[] = [];
    let conditions: NormalizedCondition[] = [];
    let evidenceTerms: string[] = [];

    try {
      const extracted = await extractViaLlm(input);
      if (extracted) {
        medicationsRaw = (extracted.medications || [])
          .map((m) => (typeof m === 'string' ? m.trim() : ''))
          .filter(Boolean);
        conditions = (extracted.conditions || [])
          .filter((c) => c && typeof c.raw === 'string' && c.raw.trim())
          .map((c) => {
            const code = typeof c.code === 'string' && c.code.trim() ? c.code.trim() : undefined;
            const system =
              c.system === 'SNOMED' || c.system === 'ICD10' ? c.system : undefined;
            return {
              raw: c.raw.trim(),
              ...(code ? { code } : {}),
              ...(system ? { system } : {}),
            };
          });
        evidenceTerms = (extracted.evidenceTerms || [])
          .map((t) => (typeof t === 'string' ? t.trim() : ''))
          .filter(Boolean);
      }
    } catch (error) {
      logger.warn('Entity normalization LLM failed; using heuristic split (fail-soft)', {
        message: error instanceof Error ? error.message : 'unknown',
      });
    }

    if (medicationsRaw.length === 0 && conditions.length === 0 && evidenceTerms.length === 0) {
      const fallback = bestEffortFromRaw(input);
      medicationsRaw = fallback.medications.map((m) => m.raw);
      conditions = fallback.conditions;
      evidenceTerms = fallback.evidenceTerms;
    }

    if (medicationsRaw.length === 0) {
      medicationsRaw = splitMedicationsHeuristic(input.currentMedications);
    }

    const medications: NormalizedMedication[] = [];
    for (const raw of medicationsRaw) {
      try {
        const resolved = await resolveDrug(raw);
        if (resolved) {
          medications.push({
            raw,
            rxcui: resolved.rxcui,
            normalizedName: resolved.normalizedName,
            unresolved: false,
          });
        } else {
          medications.push({ raw, unresolved: true });
        }
      } catch {
        medications.push({ raw, unresolved: true });
      }
    }

    if (evidenceTerms.length === 0) {
      evidenceTerms = [
        ...conditions.map((c) => c.raw).slice(0, 4),
        input.specialtyContext.trim(),
      ].filter(Boolean);
    }

    return { medications, conditions, evidenceTerms };
  } catch (error) {
    logger.warn('normalizeIntakeEntities failed entirely (fail-soft)', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return bestEffortFromRaw(input);
  }
};
