import { getOpenAIClient, isLiteLlmMode, validateLiteLlmModelAlias } from '../ai/llmGateway';
import { buildLlmRequestMetadata } from '../ai/llmRequestMetadata';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';
import type OpenAI from 'openai';

export const CASE_TITLE_MAX_CHARS = 80;

const DEFAULT_TITLE = 'Draft second opinion';

/** Strip quotes/markdown and clamp length for patient-facing list labels. */
export const sanitizeCaseTitle = (raw: string): string => {
  let title = raw
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^```[\s\S]*?```$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Drop trailing period for title-style labels.
  title = title.replace(/[.]+$/g, '').trim();

  if (!title) {
    return DEFAULT_TITLE;
  }

  if (title.length <= CASE_TITLE_MAX_CHARS) {
    return title;
  }

  const sliced = title.slice(0, CASE_TITLE_MAX_CHARS - 1).trimEnd();
  const lastSpace = sliced.lastIndexOf(' ');
  if (lastSpace >= 40) {
    return `${sliced.slice(0, lastSpace)}…`;
  }
  return `${sliced}…`;
};

/**
 * Deterministic fallback when LLM is unavailable.
 * Uses the first sentence / clause of the patient's brief description.
 */
export const fallbackTitleFromDescription = (description: string): string => {
  const cleaned = description.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return DEFAULT_TITLE;
  }

  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
  return sanitizeCaseTitle(firstSentence);
};

const resolveSuggestModel = (): string => {
  const configured = process.env.OPENAI_MODEL?.trim();
  if (configured) {
    return configured;
  }
  return isLiteLlmMode() ? 'secondop-case-analysis-fallback' : 'gpt-4o-mini';
};

export interface SuggestCaseTitleInput {
  description: string;
  areaOfConcern?: string;
  symptoms?: string;
}

export interface SuggestCaseTitleResult {
  title: string;
  source: 'llm' | 'fallback';
}

/**
 * Propose a short patient-reference title from a one-sentence case description.
 * Not a diagnosis; patient can edit freely. Falls back locally if LLM is down.
 */
export const suggestCaseTitleForPatient = async (
  input: SuggestCaseTitleInput
): Promise<SuggestCaseTitleResult> => {
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (!description) {
    throw new AppError('description is required to suggest a case title', 400);
  }
  if (description.length > 1000) {
    throw new AppError('description must be 1000 characters or fewer', 400);
  }

  const fallback = fallbackTitleFromDescription(description);
  const client = getOpenAIClient({ optional: true });
  if (!client) {
    return { title: fallback, source: 'fallback' };
  }

  const model = resolveSuggestModel();
  try {
    validateLiteLlmModelAlias(model);
  } catch (error) {
    logger.warn('case_title_suggest_model_rejected', {
      model,
      message: error instanceof Error ? error.message : String(error),
    });
    return { title: fallback, source: 'fallback' };
  }

  const area = typeof input.areaOfConcern === 'string' ? input.areaOfConcern.trim() : '';
  const symptoms = typeof input.symptoms === 'string' ? input.symptoms.trim() : '';

  const userParts = [
    `Patient description: ${description}`,
    area ? `Area of concern (optional): ${area}` : null,
    symptoms ? `Symptoms note (optional): ${symptoms.slice(0, 240)}` : null,
    'Return only the title text.',
  ].filter(Boolean);

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: 40,
      messages: [
        {
          role: 'system',
          content: [
            'You write short case titles for a patient My Cases list.',
            'Output one plain-language title, max 80 characters.',
            'No diagnosis, no treatment advice, no quotes, no emoji.',
            'Prefer the patient\'s own words; keep it specific and scannable.',
            'Examples: "Second look on MRI findings", "Questions about thyroid nodules".',
          ].join(' '),
        },
        {
          role: 'user',
          content: userParts.join('\n'),
        },
      ],
      metadata: buildLlmRequestMetadata({
        workflow: 'case_title_suggest',
        modelAlias: model,
      }),
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

    const raw = completion.choices[0]?.message?.content || '';
    const title = sanitizeCaseTitle(raw);
    if (!title || title === DEFAULT_TITLE) {
      return { title: fallback, source: 'fallback' };
    }
    return { title, source: 'llm' };
  } catch (error) {
    logger.warn('case_title_suggest_llm_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { title: fallback, source: 'fallback' };
  }
};
