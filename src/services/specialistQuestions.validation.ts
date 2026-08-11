import { AppError } from '../middleware/errorHandler';
import {
  QuestionSource,
  QuestionnaireItem,
} from './analysisArtifact.service';

/** Shared min length for patient-voice questions (guard + API + contract). */
export const PATIENT_VOICE_QUESTION_MIN_LENGTH = 15;

export const MAX_SPECIALIST_QUESTIONS = 3;

export const normalizeQuestionText = (question: string): string =>
  question.replace(/\s+/g, ' ').trim();

export interface QuestionValidationResult {
  ok: boolean;
  violations: string[];
}

/**
 * Structural validation for patient-voice questions destined for the specialist.
 * Used by question guards, contract checks, and the patient PATCH endpoint.
 */
export const validatePatientVoiceQuestions = (
  questions: string[],
  options: { exactCount?: boolean } = {}
): QuestionValidationResult => {
  const exactCount = options.exactCount !== false;
  const violations: string[] = [];
  const normalized = questions.map(normalizeQuestionText).filter(Boolean);

  if (exactCount && normalized.length !== MAX_SPECIALIST_QUESTIONS) {
    violations.push(`Expected exactly ${MAX_SPECIALIST_QUESTIONS} patient-voice questions.`);
  }

  if (!exactCount && normalized.length > MAX_SPECIALIST_QUESTIONS) {
    violations.push(`At most ${MAX_SPECIALIST_QUESTIONS} patient-voice questions are allowed.`);
  }

  if (!exactCount && normalized.length === 0) {
    violations.push('At least one patient-voice question is required.');
  }

  const unique = new Set(normalized.map((q) => q.toLowerCase()));
  if (unique.size !== normalized.length) {
    violations.push('Patient-voice questions must be unique.');
  }

  if (normalized.some((q) => q.length < PATIENT_VOICE_QUESTION_MIN_LENGTH)) {
    violations.push(
      `Each patient-voice question must be at least ${PATIENT_VOICE_QUESTION_MIN_LENGTH} characters.`
    );
  }

  return { ok: violations.length === 0, violations };
};

const isQuestionSource = (value: unknown): value is QuestionSource =>
  value === 'ai' || value === 'patient';

export const normalizeQuestionnaireItem = (
  value: unknown,
  index: number,
  defaults: { source?: QuestionSource } = {}
): QuestionnaireItem | null => {
  if (typeof value === 'string') {
    const question = normalizeQuestionText(value);
    if (!question) {
      return null;
    }
    return {
      id: `sq-${index + 1}`,
      question,
      source: defaults.source ?? 'patient',
    };
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const questionRaw = candidate.question;
  if (typeof questionRaw !== 'string') {
    return null;
  }

  const question = normalizeQuestionText(questionRaw);
  if (!question) {
    return null;
  }

  const id =
    typeof candidate.id === 'string' && candidate.id.trim()
      ? candidate.id.trim()
      : `sq-${index + 1}`;

  const source = isQuestionSource(candidate.source)
    ? candidate.source
    : (defaults.source ?? 'ai');

  const item: QuestionnaireItem = {
    id,
    question,
    source,
  };

  if (candidate.edited === true) {
    item.edited = true;
  }
  if (candidate.confirmed === true) {
    item.confirmed = true;
  }

  return item;
};

/** Parse string[] or QuestionnaireItem[] from JSONB / request bodies (max 3). */
export const parseFlexibleQuestionnaireItems = (
  input: unknown,
  defaults: { source?: QuestionSource } = {}
): QuestionnaireItem[] => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((value, index) => normalizeQuestionnaireItem(value, index, defaults))
    .filter((item): item is QuestionnaireItem => item !== null)
    .slice(0, MAX_SPECIALIST_QUESTIONS);
};

export const questionnaireItemsToStrings = (items: QuestionnaireItem[]): string[] =>
  items.map((item) => item.question);

/**
 * Validate and normalize a patient PATCH/submit payload of structured questions.
 * Edited AI items keep source: 'ai' and set edited: true when text changes from prior.
 */
export const parseAndValidateSpecialistQuestionsUpdate = (
  input: unknown,
  priorItems: QuestionnaireItem[] = []
): QuestionnaireItem[] => {
  if (!Array.isArray(input)) {
    throw new AppError('questions must be an array', 400);
  }

  if (input.length > MAX_SPECIALIST_QUESTIONS) {
    throw new AppError(`At most ${MAX_SPECIALIST_QUESTIONS} questions are allowed`, 400);
  }

  const priorById = new Map(priorItems.map((item) => [item.id, item]));
  const items: QuestionnaireItem[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const raw = input[index];
    if (!raw || typeof raw !== 'object') {
      throw new AppError(`questions[${index}] must be an object`, 400);
    }

    const candidate = raw as Record<string, unknown>;
    if (typeof candidate.question !== 'string' || !normalizeQuestionText(candidate.question)) {
      throw new AppError(`questions[${index}].question must be a non-empty string`, 400);
    }

    if (candidate.source !== undefined && !isQuestionSource(candidate.source)) {
      throw new AppError(`questions[${index}].source must be 'ai' or 'patient'`, 400);
    }

    if (candidate.confirmed !== undefined && typeof candidate.confirmed !== 'boolean') {
      throw new AppError(`questions[${index}].confirmed must be a boolean`, 400);
    }

    const question = normalizeQuestionText(candidate.question);
    const id =
      typeof candidate.id === 'string' && candidate.id.trim()
        ? candidate.id.trim()
        : `sq-${index + 1}`;
    const prior = priorById.get(id);
    let source: QuestionSource = isQuestionSource(candidate.source)
      ? candidate.source
      : prior?.source ?? 'patient';

    // Product decision: edited AI text keeps source 'ai' and sets edited: true.
    let edited = candidate.edited === true || prior?.edited === true;
    if (prior && prior.source === 'ai' && prior.question !== question) {
      source = 'ai';
      edited = true;
    }

    if (source === 'patient') {
      edited = false;
    }

    const confirmed = candidate.confirmed === true;

    items.push({
      id,
      question,
      source,
      ...(edited ? { edited: true } : {}),
      ...(confirmed ? { confirmed: true } : {}),
    });
  }

  const validation = validatePatientVoiceQuestions(
    items.map((item) => item.question),
    { exactCount: false }
  );
  if (!validation.ok) {
    throw new AppError(validation.violations.join(' '), 400);
  }

  return items;
};
