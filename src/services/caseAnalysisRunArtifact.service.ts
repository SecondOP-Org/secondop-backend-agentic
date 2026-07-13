import { query } from '../database/connection';
import { CaseAnalysisArtifact } from './analysisArtifact.service';
import { CaseAnalysisResult, CaseIntakeData } from './analysis.service';
import {
  aggregateDeidentificationAudits,
  DeidentificationAudit,
} from './deidentification.service';
import { ExtractedReport } from './reportExtraction.service';

export const CASE_ANALYSIS_ARTIFACT_VERSION = '1';

export type CaseAnalysisStageArtifactType =
  | 'validation'
  | 'extraction'
  | 'synthesis'
  | 'guard'
  | 'final';

export type CaseAnalysisStageEngine = 'baseline' | 'agentic';

export interface CaseAnalysisStageArtifact {
  id: string;
  run_id: string;
  case_id: string;
  file_id: string | null;
  artifact_type: CaseAnalysisStageArtifactType;
  stage_name: string;
  engine: CaseAnalysisStageEngine;
  artifact_version: string;
  json_payload: Record<string, unknown>;
  created_at: Date;
}

export interface InsertCaseAnalysisArtifactInput {
  runId: string;
  caseId: string;
  fileId?: string | null;
  artifactType: CaseAnalysisStageArtifactType;
  stageName: string;
  engine: CaseAnalysisStageEngine;
  payload: Record<string, unknown>;
}

export interface ShadowComparisonMetrics {
  baselineRunId: string;
  agenticRunId: string;
  baselineModel: string | null;
  agenticModel: string | null;
  baselineQuestionCount: number;
  agenticQuestionCount: number;
  matchingQuestionCount: number;
  baselineSummaryLength: number;
  agenticSummaryLength: number;
  agenticCriticPassed: boolean | null;
  agenticCriticScore: number | null;
}

const mapArtifactRow = (row: Record<string, unknown>): CaseAnalysisStageArtifact => ({
  id: String(row.id),
  run_id: String(row.run_id),
  case_id: String(row.case_id),
  file_id: row.file_id ? String(row.file_id) : null,
  artifact_type: String(row.artifact_type) as CaseAnalysisStageArtifactType,
  stage_name: String(row.stage_name),
  engine: String(row.engine) as CaseAnalysisStageEngine,
  artifact_version: String(row.artifact_version),
  json_payload:
    row.json_payload && typeof row.json_payload === 'object'
      ? (row.json_payload as Record<string, unknown>)
      : {},
  created_at: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
});

export const insertCaseAnalysisArtifact = async (
  input: InsertCaseAnalysisArtifactInput
): Promise<CaseAnalysisStageArtifact> => {
  const result = await query(
    `INSERT INTO case_analysis_artifacts (
      run_id,
      case_id,
      file_id,
      artifact_type,
      stage_name,
      engine,
      artifact_version,
      json_payload
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, run_id, case_id, file_id, artifact_type, stage_name, engine, artifact_version, json_payload, created_at`,
    [
      input.runId,
      input.caseId,
      input.fileId ?? null,
      input.artifactType,
      input.stageName,
      input.engine,
      CASE_ANALYSIS_ARTIFACT_VERSION,
      JSON.stringify(input.payload),
    ]
  );

  return mapArtifactRow(result.rows[0] as Record<string, unknown>);
};

export const listArtifactsByRunId = async (runId: string): Promise<CaseAnalysisStageArtifact[]> => {
  const result = await query(
    `SELECT id, run_id, case_id, file_id, artifact_type, stage_name, engine, artifact_version, json_payload, created_at
     FROM case_analysis_artifacts
     WHERE run_id = $1
     ORDER BY created_at ASC`,
    [runId]
  );

  return (result.rows as Array<Record<string, unknown>>).map(mapArtifactRow);
};

const normalizeQuestion = (value: string): string => value.trim().toLowerCase();

export const countMatchingQuestions = (baselineQuestions: string[], agenticQuestions: string[]): number => {
  const agenticSet = new Set(agenticQuestions.map(normalizeQuestion));
  return baselineQuestions.filter((question) => agenticSet.has(normalizeQuestion(question))).length;
};

export const buildShadowComparisonMetrics = (input: {
  baselineRunId: string;
  agenticRunId: string;
  baselineAnalysis: CaseAnalysisResult;
  agenticSummary: string;
  agenticQuestions: string[];
  agenticModel: string | null;
  criticPassed: boolean | null;
  criticScore: number | null;
}): ShadowComparisonMetrics => ({
  baselineRunId: input.baselineRunId,
  agenticRunId: input.agenticRunId,
  baselineModel: input.baselineAnalysis.model,
  agenticModel: input.agenticModel,
  baselineQuestionCount: input.baselineAnalysis.topQuestions.length,
  agenticQuestionCount: input.agenticQuestions.length,
  matchingQuestionCount: countMatchingQuestions(input.baselineAnalysis.topQuestions, input.agenticQuestions),
  baselineSummaryLength: input.baselineAnalysis.summary.length,
  agenticSummaryLength: input.agenticSummary.length,
  agenticCriticPassed: input.criticPassed,
  agenticCriticScore: input.criticScore,
});

export const buildBaselineValidationPayload = (intake: CaseIntakeData): Record<string, unknown> => ({
  age: intake.age,
  sex: intake.sex,
  specialtyContext: intake.specialtyContext,
  symptoms: intake.symptoms,
  symptomDuration: intake.symptomDuration,
  medicalHistory: intake.medicalHistory,
  currentMedications: intake.currentMedications,
  allergies: intake.allergies,
});

export const buildExtractionPayload = (reports: ExtractedReport[]): Record<string, unknown> => {
  const deidentification = aggregateDeidentificationAudits(
    reports
      .map((report) => report.deidentification)
      .filter((audit): audit is DeidentificationAudit => Boolean(audit))
  );

  return {
    reportCount: reports.length,
    totalChars: reports.reduce((sum, report) => sum + report.charCount, 0),
    reusedCount: reports.filter((report) => report.reused).length,
    deidentification,
    reports: reports.map((report) => ({
      fileId: report.fileId,
      fileName: report.fileName,
      charCount: report.charCount,
      extractionMethod: report.extractionMethod,
      reused: report.reused,
      textPreview: report.text.slice(0, 500),
      deidentification: report.deidentification
        ? {
            enabled: report.deidentification.enabled,
            entityCount: report.deidentification.entityCount,
            entities: report.deidentification.entities,
            operator: report.deidentification.operator,
          }
        : null,
    })),
  };
};

export const buildSynthesisPayload = (analysis: CaseAnalysisResult, observations: string[] | undefined): Record<string, unknown> => ({
  model: analysis.model,
  summary: analysis.summary,
  topQuestions: analysis.topQuestions,
  observations: observations || [],
  usage: analysis.usage || null,
});

export const buildGuardPayload = (analysis: CaseAnalysisResult): Record<string, unknown> => ({
  questionCount: analysis.topQuestions.length,
  uniqueQuestionCount: new Set(analysis.topQuestions.map((question) => question.toLowerCase())).size,
  questions: analysis.topQuestions,
});

export const buildFinalPayload = (analysis: CaseAnalysisResult): Record<string, unknown> => ({
  summary: analysis.summary,
  topQuestions: analysis.topQuestions,
  artifact: analysis.artifact,
  model: analysis.model,
});

export const buildAgenticFinalPayload = (input: {
  summary: string;
  questions: string[];
  observations: string[];
  artifact: CaseAnalysisArtifact;
  model: string;
}): Record<string, unknown> => ({
  summary: input.summary,
  topQuestions: input.questions,
  observations: input.observations,
  artifact: input.artifact,
  model: input.model,
});
