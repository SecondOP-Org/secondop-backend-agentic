/**
 * SEC-125 — Patient-facing AI draft answers (doctor inserts → patient PDF).
 *
 * Clinician-facing structured_summary / specialist questions are unchanged.
 * This service only composes warm prose for answers + summary the patient reads.
 *
 * Option A: dedicated LLM call with patient-voice prompt (preferred).
 * Option B: deterministic template prose when LLM is unavailable or fails checks.
 */
import OpenAI from 'openai';
import { getOpenAIClient, isLiteLlmMode, validateLiteLlmModelAlias } from '../ai/llmGateway';
import { buildLlmRequestMetadata } from '../ai/llmRequestMetadata';
import { detectForbiddenClaims } from '../evals/contractChecks';
import { AppError } from '../middleware/errorHandler';
import { query } from '../database/connection';
import logger from '../utils/logger';
import {
  CaseAnalysisArtifact,
  EvidenceRef,
  StructuredSummary,
  hydrateCaseAnalysisArtifact,
} from './analysisArtifact.service';
import {
  DeidentificationMapping,
  deidentifyText,
  mergeMappings,
  reidentifyText,
} from './deidentification.service';
import { resolveSpecialistQuestions } from './doctorResponse.service';

export const PATIENT_VOICE_GUIDANCE = [
  'Write as a specialist speaking directly to the patient in second person ("you", "your").',
  'Warm, professional, and assuring — not casual, not clinical jargon dumps.',
  'Plain language first; put medical terms in parentheses when helpful (e.g. "inflammation marker (hs-CRP)").',
  'Reassure only where the evidence supports it; otherwise be honest that something is worth a closer look.',
  'Never diagnose, prescribe, order treatment, or give emergency directives.',
  'Do not invent findings, measurements, or certainty beyond the provided source material.',
  'Do not use labelled section headers such as "Chief concern:", "Red flags to discuss:", or "Limitations:".',
  'Do not include inline evidence markers like "[Evidence:…]"; a footnote may be appended separately.',
].join(' ');

export type PatientFacingDraftKind = 'question' | 'summary';

export interface PatientFacingDraftRequest {
  kind: PatientFacingDraftKind;
  /** Required when kind === 'question'. */
  questionId?: string;
  questionIndex?: number;
}

export interface PatientFacingDraftResult {
  draft: string;
  kind: PatientFacingDraftKind;
  source: 'llm' | 'template';
  questionId?: string;
}

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Patient-facing draft timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const getModelName = (): string => process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const timeoutMs = (): number => parseInt(process.env.OPENAI_TIMEOUT_MS || '45000', 10);

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const hasPatientFacingLabels = (text: string): boolean =>
  /\b(chief concern from the submitted records|red flags to discuss|key findings relevant to this question|discussion points:|limitations:|regarding your question:)\b/i.test(
    text
  );

/** Subtle footnote-style citation (not inline `[Evidence:…]`). */
export const formatEvidenceFootnote = (reference: EvidenceRef): string => {
  const section = reference.section ? reference.section.replace(/_/g, ' ') : '';
  const location = section ? `${reference.file_name} — ${section}` : reference.file_name;
  const snippet = normalizeWhitespace(reference.snippet || '');
  if (!snippet) {
    return `Source note: ${location}`;
  }
  return `Source note: ${location}. "${snippet}"`;
};

const pickEvidenceRef = (
  artifact: CaseAnalysisArtifact,
  questionIndex: number
): EvidenceRef | null => {
  const refs = artifact.evidence_refs || [];
  if (refs.length === 0) {
    return null;
  }
  return refs[questionIndex] || refs[0] || null;
};

const summarySourceParagraphs = (summary: StructuredSummary): string[] => {
  return [
    summary.chief_concern,
    summary.key_report_findings,
    summary.follow_up_discussion_points,
    summary.red_flags_to_discuss,
    summary.limitations_caveats,
  ]
    .map((value) => normalizeWhitespace(value || ''))
    .filter(Boolean);
};

/**
 * Option B — flowing prose from summary fields (no section labels).
 * Used when LLM is unavailable or fails forbidden-claim / voice checks.
 */
export const composePatientFacingQuestionTemplate = (
  questionText: string,
  summary: StructuredSummary,
  evidence: EvidenceRef | null
): string => {
  const paragraphs: string[] = [];
  const q = normalizeWhitespace(questionText);

  paragraphs.push(
    q
      ? `Thank you for asking — "${q}" Here is how I would frame an answer based on the records you submitted.`
      : 'Thank you for your question. Here is how I would frame an answer based on the records you submitted.'
  );

  const concern = normalizeWhitespace(summary.chief_concern || '');
  const findings = normalizeWhitespace(summary.key_report_findings || '');
  if (concern || findings) {
    const parts = [
      concern ? `From what you shared, the main issue reflected in the records is ${concern.replace(/\.$/, '')}.` : '',
      findings ? `The key findings that speak to your question are: ${findings}` : '',
    ].filter(Boolean);
    paragraphs.push(parts.join(' '));
  }

  const discussion = normalizeWhitespace(summary.follow_up_discussion_points || '');
  const redFlags = normalizeWhitespace(summary.red_flags_to_discuss || '');
  if (discussion || redFlags) {
    const meaningBits: string[] = [];
    if (discussion) {
      meaningBits.push(discussion);
    }
    if (redFlags) {
      meaningBits.push(
        `There are also points worth a closer look together: ${redFlags.replace(/\.$/, '')}.`
      );
    }
    paragraphs.push(
      `What this likely means for you: ${meaningBits.join(' ')} I want to be clear and careful — this is guidance for our discussion, not a final diagnosis.`
    );
  } else {
    paragraphs.push(
      'Taken together, these findings give us a useful starting point for discussion. I want to be clear and careful — this is guidance for our conversation, not a final diagnosis.'
    );
  }

  const limitations = normalizeWhitespace(summary.limitations_caveats || '');
  const nextStepBits: string[] = [];
  if (discussion) {
    nextStepBits.push(`I recommend we focus next on: ${discussion}`);
  } else {
    nextStepBits.push(
      'A helpful next step is to review these findings together and decide what follow-up, if any, makes sense for you.'
    );
  }
  if (limitations) {
    nextStepBits.push(`Please keep in mind: ${limitations}`);
  }
  paragraphs.push(nextStepBits.join(' '));

  if (evidence) {
    paragraphs.push(formatEvidenceFootnote(evidence));
  }

  return paragraphs.join('\n\n').trim();
};

export const composePatientFacingSummaryTemplate = (summary: StructuredSummary): string => {
  const paragraphs: string[] = [];
  const concern = normalizeWhitespace(summary.chief_concern || '');
  const findings = normalizeWhitespace(summary.key_report_findings || '');
  const discussion = normalizeWhitespace(summary.follow_up_discussion_points || '');
  const redFlags = normalizeWhitespace(summary.red_flags_to_discuss || '');
  const limitations = normalizeWhitespace(summary.limitations_caveats || '');

  paragraphs.push(
    'Thank you for trusting me with your records. I have reviewed what you submitted and want to share a clear, careful summary in plain language.'
  );

  if (concern || findings) {
    paragraphs.push(
      [
        concern
          ? `Overall, the picture that emerges centers on ${concern.replace(/\.$/, '')}.`
          : 'Overall, here is the picture that emerges from your records.',
        findings ? `The most important findings are: ${findings}` : '',
      ]
        .filter(Boolean)
        .join(' ')
    );
  }

  if (discussion || redFlags) {
    paragraphs.push(
      [
        discussion ? `Recommended next steps to discuss: ${discussion}` : '',
        redFlags
          ? `There are also items that deserve closer attention: ${redFlags.replace(/\.$/, '')}.`
          : '',
      ]
        .filter(Boolean)
        .join(' ')
    );
  } else {
    paragraphs.push(
      'I recommend we walk through these points together and decide on practical next steps that fit your situation.'
    );
  }

  if (limitations) {
    paragraphs.push(
      `A few important caveats: ${limitations} This summary supports our conversation and is not a diagnosis or treatment plan on its own.`
    );
  } else {
    paragraphs.push(
      'This summary supports our conversation and is not a diagnosis or treatment plan on its own. Please bring any questions to our discussion.'
    );
  }

  return paragraphs.join('\n\n').trim();
};

const collectGroundingCorpus = (
  summary: StructuredSummary,
  questionText: string,
  evidence: EvidenceRef | null
): string => {
  return normalizeWhitespace(
    [
      questionText,
      ...summarySourceParagraphs(summary),
      evidence?.file_name || '',
      evidence?.snippet || '',
      evidence?.section || '',
    ].join(' ')
  ).toLowerCase();
};

/**
 * Lightweight grounding: content words in the draft should largely appear in source material.
 * Connective / voice words are ignored.
 */
export const draftAppearsGrounded = (draft: string, corpus: string): boolean => {
  const stop = new Set(
    'a an the and or but if to for of in on at by with as is are was were be been being you your we our this that these those it its from into about than then so not no nor can could should would may might will shall do does did done have has had having here there what which who whom whose when where why how please thank based records submitted likely means closer look discuss discussion together guidance final diagnosis treatment plan conversation summary next step steps recommend recommended important careful clear plain language specialist'.split(
      ' '
    )
  );

  const tokens = draft
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 5 && !stop.has(token));

  if (tokens.length === 0) {
    return true;
  }

  const unique = [...new Set(tokens)];
  let matched = 0;
  for (const token of unique) {
    if (corpus.includes(token)) {
      matched += 1;
    }
  }

  const ratio = matched / unique.length;
  // Templates reuse source phrases heavily; LLM drafts may paraphrase — allow moderate novelty.
  return ratio >= 0.35;
};

export const validatePatientFacingDraftText = (
  draft: string,
  corpus: string
): { ok: boolean; violations: string[] } => {
  const violations: string[] = [];
  const trimmed = draft.trim();
  if (!trimmed) {
    violations.push('Draft is empty.');
    return { ok: false, violations };
  }

  violations.push(...detectForbiddenClaims(trimmed));

  if (hasPatientFacingLabels(trimmed)) {
    violations.push('Draft contains clinician field labels unsuitable for patient-facing text.');
  }

  if (!draftAppearsGrounded(trimmed, corpus)) {
    violations.push('Draft does not appear grounded in the provided summary and evidence.');
  }

  return { ok: violations.length === 0, violations };
};

const buildQuestionSystemPrompt = (): string =>
  [
    'You draft patient-facing second-opinion answer text for a licensed specialist to edit and sign.',
    PATIENT_VOICE_GUIDANCE,
    'Structure the answer as short prose paragraphs:',
    '1) Acknowledge the patient question in human terms (no "Regarding your question:").',
    '2) Answer directly in plain language, grounded only in the provided findings.',
    '3) What it likely means for them, with honest reassurance where supported.',
    '4) A clear next step / what to discuss.',
    'Return plain text only (no JSON, no markdown headings, no bullet labels).',
    'Do not append evidence citations; those are added separately.',
  ].join(' ');

const buildSummarySystemPrompt = (): string =>
  [
    'You draft a patient-facing clinical summary/recommendations letter section for a licensed specialist to edit and sign.',
    PATIENT_VOICE_GUIDANCE,
    'Structure as short prose paragraphs:',
    '1) Opening reassurance / thanks for sharing records.',
    '2) Overall picture in plain language from the findings.',
    '3) Recommended next steps to discuss.',
    'Return plain text only (no JSON, no markdown headings, no bullet labels).',
  ].join(' ');

const deidentifyPromptBundle = async (
  parts: Record<string, string>
): Promise<{ parts: Record<string, string>; mapping: DeidentificationMapping }> => {
  let mapping: DeidentificationMapping = {};
  const next: Record<string, string> = {};

  for (const [key, value] of Object.entries(parts)) {
    if (!value.trim()) {
      next[key] = value;
      continue;
    }
    const result = await deidentifyText(value);
    next[key] = result.deidentifiedText;
    mapping = mergeMappings(mapping, result.mapping);
  }

  return { parts: next, mapping };
};

const runPatientVoiceLlm = async (params: {
  systemPrompt: string;
  userPrompt: string;
  caseId: string;
}): Promise<string | null> => {
  const client = getOpenAIClient({ optional: true });
  if (!client) {
    return null;
  }

  const selectedModel = getModelName();
  try {
    validateLiteLlmModelAlias(selectedModel);
  } catch (error) {
    logger.warn('Patient-facing draft: model alias rejected', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const completionRequest: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
    metadata?: Record<string, string>;
  } = {
    model: selectedModel,
    temperature: 0.35,
    messages: [
      { role: 'system', content: params.systemPrompt },
      { role: 'user', content: params.userPrompt },
    ],
  };

  if (isLiteLlmMode()) {
    completionRequest.metadata = buildLlmRequestMetadata({
      workflow: 'patient_facing_draft',
      modelAlias: selectedModel,
      caseId: params.caseId,
    });
  }

  try {
    const completion = (await withTimeout(
      client.chat.completions.create(completionRequest),
      timeoutMs()
    )) as OpenAI.Chat.Completions.ChatCompletion;
    const raw = completion.choices[0]?.message?.content;
    if (typeof raw !== 'string' || !raw.trim()) {
      return null;
    }
    return raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim();
  } catch (error) {
    logger.warn('Patient-facing draft LLM call failed; falling back to template', {
      error: error instanceof Error ? error.message : String(error),
      caseIdHash: params.caseId.slice(0, 8),
    });
    return null;
  }
};

const appendEvidenceFootnote = (draft: string, evidence: EvidenceRef | null): string => {
  if (!evidence) {
    return draft.trim();
  }
  const footnote = formatEvidenceFootnote(evidence);
  if (draft.includes(footnote) || /source note:/i.test(draft)) {
    return draft.trim();
  }
  return `${draft.trim()}\n\n${footnote}`;
};

export const buildPatientFacingQuestionDraft = async (params: {
  caseId: string;
  questionText: string;
  questionIndex: number;
  artifact: CaseAnalysisArtifact;
}): Promise<{ draft: string; source: 'llm' | 'template' }> => {
  const summary = params.artifact.structured_summary;
  const evidence = pickEvidenceRef(params.artifact, params.questionIndex);
  const template = composePatientFacingQuestionTemplate(params.questionText, summary, evidence);
  const corpus = collectGroundingCorpus(summary, params.questionText, evidence);

  const deid = await deidentifyPromptBundle({
    question: params.questionText,
    chief_concern: summary.chief_concern || '',
    key_report_findings: summary.key_report_findings || '',
    follow_up_discussion_points: summary.follow_up_discussion_points || '',
    red_flags_to_discuss: summary.red_flags_to_discuss || '',
    limitations_caveats: summary.limitations_caveats || '',
    evidence_snippet: evidence?.snippet || '',
    evidence_file: evidence?.file_name || '',
  });

  const userPrompt = [
    'Patient question:',
    deid.parts.question,
    '',
    'Grounding material (use ONLY these facts; do not add new findings):',
    `- Main concern: ${deid.parts.chief_concern || '(none provided)'}`,
    `- Key findings: ${deid.parts.key_report_findings || '(none provided)'}`,
    `- Discussion points: ${deid.parts.follow_up_discussion_points || '(none provided)'}`,
    `- Points for closer look: ${deid.parts.red_flags_to_discuss || '(none provided)'}`,
    `- Caveats: ${deid.parts.limitations_caveats || '(none provided)'}`,
    deid.parts.evidence_snippet
      ? `- Supporting excerpt from ${deid.parts.evidence_file}: "${deid.parts.evidence_snippet}"`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const llmRaw = await runPatientVoiceLlm({
    systemPrompt: buildQuestionSystemPrompt(),
    userPrompt,
    caseId: params.caseId,
  });

  if (llmRaw) {
    const reidentified = reidentifyText(llmRaw, deid.mapping);
    const withFootnote = appendEvidenceFootnote(reidentified, evidence);
    const check = validatePatientFacingDraftText(withFootnote, corpus);
    if (check.ok) {
      return { draft: withFootnote, source: 'llm' };
    }
    logger.warn('Patient-facing question draft failed contract checks; using template', {
      violations: check.violations,
    });
  }

  const templateCheck = validatePatientFacingDraftText(template, corpus);
  if (!templateCheck.ok) {
    // Template is deterministic from source — still return it after stripping forbidden phrases if needed.
    logger.warn('Patient-facing template draft has contract warnings', {
      violations: templateCheck.violations,
    });
  }
  return { draft: template, source: 'template' };
};

export const buildPatientFacingSummaryDraft = async (params: {
  caseId: string;
  artifact: CaseAnalysisArtifact;
}): Promise<{ draft: string; source: 'llm' | 'template' }> => {
  const summary = params.artifact.structured_summary;
  const template = composePatientFacingSummaryTemplate(summary);
  const corpus = collectGroundingCorpus(summary, '', null);

  const deid = await deidentifyPromptBundle({
    chief_concern: summary.chief_concern || '',
    key_report_findings: summary.key_report_findings || '',
    follow_up_discussion_points: summary.follow_up_discussion_points || '',
    red_flags_to_discuss: summary.red_flags_to_discuss || '',
    limitations_caveats: summary.limitations_caveats || '',
  });

  const userPrompt = [
    'Grounding material (use ONLY these facts; do not add new findings):',
    `- Main concern: ${deid.parts.chief_concern || '(none provided)'}`,
    `- Key findings: ${deid.parts.key_report_findings || '(none provided)'}`,
    `- Discussion points: ${deid.parts.follow_up_discussion_points || '(none provided)'}`,
    `- Points for closer look: ${deid.parts.red_flags_to_discuss || '(none provided)'}`,
    `- Caveats: ${deid.parts.limitations_caveats || '(none provided)'}`,
  ].join('\n');

  const llmRaw = await runPatientVoiceLlm({
    systemPrompt: buildSummarySystemPrompt(),
    userPrompt,
    caseId: params.caseId,
  });

  if (llmRaw) {
    const reidentified = reidentifyText(llmRaw, deid.mapping);
    const check = validatePatientFacingDraftText(reidentified, corpus);
    if (check.ok) {
      return { draft: reidentified.trim(), source: 'llm' };
    }
    logger.warn('Patient-facing summary draft failed contract checks; using template', {
      violations: check.violations,
    });
  }

  return { draft: template, source: 'template' };
};

export const generatePatientFacingDraftForCase = async (
  caseId: string,
  doctorUserId: string,
  request: PatientFacingDraftRequest
): Promise<PatientFacingDraftResult> => {
  if (request.kind !== 'question' && request.kind !== 'summary') {
    throw new AppError('kind must be "question" or "summary"', 400);
  }

  const caseResult = await query(
    `SELECT c.id,
            c.specialist_questions,
            c.analysis_questions,
            c.analysis_artifact,
            c.analysis_summary,
            c.analysis_model,
            c.share_ai_analysis_with_specialists,
            c.analysis_status
     FROM cases c
     JOIN case_assignments ca ON ca.case_id = c.id
     JOIN doctors d ON d.id = ca.doctor_id
     WHERE c.id = $1 AND d.user_id = $2
     LIMIT 1`,
    [caseId, doctorUserId]
  );

  if (caseResult.rows.length === 0) {
    throw new AppError('Case not found for assigned doctor', 404);
  }

  const row = caseResult.rows[0] as {
    specialist_questions?: string[] | null;
    analysis_questions?: string[] | null;
    analysis_artifact?: unknown;
    analysis_summary?: string | null;
    analysis_model?: string | null;
    share_ai_analysis_with_specialists?: boolean | null;
    analysis_status?: string | null;
  };

  if (row.share_ai_analysis_with_specialists === false) {
    throw new AppError('AI analysis is not shared for this case', 403);
  }

  if (row.analysis_status !== 'succeeded') {
    throw new AppError('AI analysis is not available for drafting yet', 400);
  }

  const artifact = hydrateCaseAnalysisArtifact({
    artifact: row.analysis_artifact,
    summary: row.analysis_summary ?? null,
    questions: row.analysis_questions ?? null,
    model: row.analysis_model ?? null,
  });

  if (!artifact) {
    throw new AppError('No analysis artifact available for AI draft', 400);
  }

  if (request.kind === 'summary') {
    const built = await buildPatientFacingSummaryDraft({ caseId, artifact });
    return { draft: built.draft, kind: 'summary', source: built.source };
  }

  const questions = resolveSpecialistQuestions(row);
  const questionId = typeof request.questionId === 'string' ? request.questionId.trim() : '';
  if (!questionId) {
    throw new AppError('questionId is required when kind is "question"', 400);
  }

  const questionIndex =
    typeof request.questionIndex === 'number' && Number.isFinite(request.questionIndex)
      ? Math.max(0, Math.floor(request.questionIndex))
      : Math.max(
          0,
          questions.findIndex((item) => item.id === questionId)
        );

  const question =
    questions.find((item) => item.id === questionId) ||
    questions[questionIndex] ||
    null;

  if (!question) {
    throw new AppError('Question not found for AI draft', 404);
  }

  const built = await buildPatientFacingQuestionDraft({
    caseId,
    questionText: question.question,
    questionIndex,
    artifact,
  });

  return {
    draft: built.draft,
    kind: 'question',
    source: built.source,
    questionId: question.id,
  };
};
