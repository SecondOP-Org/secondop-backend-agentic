import OpenAI from 'openai';
import { getOpenAIClient, isLiteLlmMode, validateLiteLlmModelAlias } from '../ai/llmGateway';
import { buildLlmRequestMetadata } from '../ai/llmRequestMetadata';
import {
  buildCaseAnalysisArtifact,
  CaseAnalysisArtifact,
  extractObservationsFromArtifact,
  TokenUsageMetrics,
  defaultMedicalDisclaimer,
} from './analysisArtifact.service';
import { ExtractedReport } from './reportExtraction.service';

export interface CaseIntakeData {
  age: number;
  sex: string;
  specialtyContext: string;
  symptoms: string;
  symptomDuration: string;
  medicalHistory: string;
  currentMedications: string;
  allergies: string;
}

export interface CaseAnalysisResult {
  summary: string;
  topQuestions: string[];
  artifact: CaseAnalysisArtifact;
  model: string;
  usage?: TokenUsageMetrics;
}

const timeoutMs = parseInt(process.env.OPENAI_TIMEOUT_MS || '60000', 10);
const getModelName = (): string => process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Analysis timed out after ${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const buildSystemPrompt = (): string => {
  return [
    'You are a medical-report summarization assistant for second-opinion workflows.',
    'Return strict JSON using only the schema provided.',
    'Do not provide a diagnosis, treatment decision, or fabricated medical facts.',
    'Use cautious language when source material is incomplete or uncertain.',
    'The disclaimer must clearly state that a licensed clinician must review the source records.',
    'Confidence score must be between 0 and 1.',
    'Questionnaire items must be actionable specialist-facing questions.',
    'Do not output markdown code fences.',
  ].join('\n');
};

const buildUserPrompt = (intake: CaseIntakeData, reports: ExtractedReport[], guidance?: string): string => {
  const reportText = reports
    .map((report, index) => `Report ${index + 1} (${report.fileName}):\n${report.text}`)
    .join('\n\n');

  return [
    'Patient Intake:',
    `- Age: ${intake.age}`,
    `- Sex: ${intake.sex}`,
    `- Specialty Context: ${intake.specialtyContext}`,
    `- Symptoms: ${intake.symptoms}`,
    `- Symptom Duration: ${intake.symptomDuration}`,
    `- Medical History: ${intake.medicalHistory}`,
    `- Current Medications: ${intake.currentMedications}`,
    `- Allergies: ${intake.allergies}`,
    '',
    'Medical Reports:',
    reportText,
    '',
    `Allowed report file names: ${reports.map((report) => report.fileName).join(', ')}`,
    guidance ? `Agentic Guidance: ${guidance}` : '',
    'Generate a structured_summary, questionnaire with exactly 3 specialist_questions, confidence_score, and disclaimer.',
  ]
    .filter((line) => line !== '')
    .join('\n');
};

const parseAndValidateOutput = (
  raw: string,
  reports: ExtractedReport[],
  model: string,
  usage?: TokenUsageMetrics
): Pick<CaseAnalysisResult, 'summary' | 'topQuestions' | 'artifact'> => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON returned by analysis model.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Analysis response is not an object.');
  }

  const structuredSummary = (parsed as { structured_summary?: unknown }).structured_summary;
  const questionnaire = (parsed as { questionnaire?: unknown }).questionnaire;
  const confidenceScore = (parsed as { confidence_score?: unknown }).confidence_score;
  const disclaimer = (parsed as { disclaimer?: unknown }).disclaimer;

  if (!structuredSummary || typeof structuredSummary !== 'object') {
    throw new Error('Analysis structured_summary is missing.');
  }

  const normalizedStructuredSummary = {
    chief_concern:
      typeof (structuredSummary as { chief_concern?: unknown }).chief_concern === 'string'
        ? (structuredSummary as { chief_concern: string }).chief_concern.trim()
        : '',
    key_report_findings:
      typeof (structuredSummary as { key_report_findings?: unknown }).key_report_findings === 'string'
        ? (structuredSummary as { key_report_findings: string }).key_report_findings.trim()
        : '',
    red_flags_to_discuss:
      typeof (structuredSummary as { red_flags_to_discuss?: unknown }).red_flags_to_discuss === 'string'
        ? (structuredSummary as { red_flags_to_discuss: string }).red_flags_to_discuss.trim()
        : '',
    follow_up_discussion_points:
      typeof (structuredSummary as { follow_up_discussion_points?: unknown }).follow_up_discussion_points === 'string'
        ? (structuredSummary as { follow_up_discussion_points: string }).follow_up_discussion_points.trim()
        : '',
    limitations_caveats:
      typeof (structuredSummary as { limitations_caveats?: unknown }).limitations_caveats === 'string'
        ? (structuredSummary as { limitations_caveats: string }).limitations_caveats.trim()
        : '',
  };

  const specialistQuestions = (
    questionnaire &&
    typeof questionnaire === 'object' &&
    Array.isArray((questionnaire as { specialist_questions?: unknown }).specialist_questions)
      ? (questionnaire as { specialist_questions: unknown[] }).specialist_questions
      : []
  ).map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`questionnaire.specialist_questions[${index}] must be an object.`);
    }

    const question = (item as { question?: unknown }).question;
    if (typeof question !== 'string' || !question.trim()) {
      throw new Error('All analysis questions must be non-empty strings.');
    }

    return question.trim();
  });

  if (specialistQuestions.length !== 3) {
    throw new Error('Analysis must return exactly 3 questions.');
  }

  const artifact = buildCaseAnalysisArtifact({
    structuredSummary: normalizedStructuredSummary,
    specialistQuestions,
    confidenceScore: typeof confidenceScore === 'number' ? confidenceScore : 0.5,
    disclaimer: typeof disclaimer === 'string' ? disclaimer : defaultMedicalDisclaimer,
    reports,
    model,
    tokenUsage: usage,
  });

  return {
    summary: [
      'Chief Concern',
      artifact.structured_summary.chief_concern,
      '',
      'Key Report Findings',
      artifact.structured_summary.key_report_findings,
      '',
      'Red Flags To Discuss',
      artifact.structured_summary.red_flags_to_discuss,
      '',
      'Follow-up Discussion Points',
      artifact.structured_summary.follow_up_discussion_points,
      '',
      'Limitations/Caveats',
      artifact.structured_summary.limitations_caveats,
    ].join('\n'),
    topQuestions: specialistQuestions,
    artifact,
  };
};

export const generateCaseAnalysis = async (
  intake: CaseIntakeData,
  reports: ExtractedReport[],
  guidance?: string,
  overrideModel?: string
): Promise<CaseAnalysisResult> => {
  const client = getOpenAIClient();
  if (!client) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const selectedModel = overrideModel || getModelName();
  validateLiteLlmModelAlias(selectedModel);

  const completionRequest: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
    metadata?: Record<string, string>;
  } = {
    model: selectedModel,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: buildSystemPrompt(),
      },
      {
        role: 'user',
        content: buildUserPrompt(intake, reports, guidance),
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'case_analysis',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            structured_summary: {
              type: 'object',
              additionalProperties: false,
              properties: {
                chief_concern: { type: 'string' },
                key_report_findings: { type: 'string' },
                red_flags_to_discuss: { type: 'string' },
                follow_up_discussion_points: { type: 'string' },
                limitations_caveats: { type: 'string' },
              },
              required: [
                'chief_concern',
                'key_report_findings',
                'red_flags_to_discuss',
                'follow_up_discussion_points',
                'limitations_caveats',
              ],
            },
            questionnaire: {
              type: 'object',
              additionalProperties: false,
              properties: {
                specialist_questions: {
                  type: 'array',
                  minItems: 3,
                  maxItems: 3,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      question: { type: 'string' },
                    },
                    required: ['question'],
                  },
                },
              },
              required: ['specialist_questions'],
            },
            confidence_score: { type: 'number' },
            disclaimer: { type: 'string' },
          },
          required: ['structured_summary', 'questionnaire', 'confidence_score', 'disclaimer'],
        },
      },
    },
  };

  if (isLiteLlmMode()) {
    completionRequest.metadata = buildLlmRequestMetadata({
      workflow: 'case_analysis',
      modelAlias: selectedModel,
    });
  }

  const completionPromise = client.chat.completions.create(completionRequest);

  const completion = (await withTimeout(completionPromise, timeoutMs)) as any;
  const rawContent = completion.choices[0]?.message?.content;

  if (!rawContent) {
    throw new Error('Analysis model returned an empty response.');
  }

  const usageMetrics = {
    promptTokens: Number(completion?.usage?.prompt_tokens || 0),
    completionTokens: Number(completion?.usage?.completion_tokens || 0),
    totalTokens: Number(completion?.usage?.total_tokens || 0),
  };

  const validated = parseAndValidateOutput(rawContent, reports, selectedModel, usageMetrics);

  return {
    summary: validated.summary,
    topQuestions: validated.topQuestions,
    artifact: validated.artifact,
    model: selectedModel,
    usage: usageMetrics,
  };
};

export const extractObservationsFromSummary = (summary: string): string[] => {
  const lines = summary
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const artifact = buildCaseAnalysisArtifact({
    structuredSummary: {
      chief_concern: lines[1] || '',
      key_report_findings: lines[3] || '',
      red_flags_to_discuss: lines[5] || '',
      follow_up_discussion_points: lines[7] || '',
      limitations_caveats: lines[9] || '',
    },
    specialistQuestions: [],
    model: 'legacy-summary',
  });

  return extractObservationsFromArtifact(artifact);
};
