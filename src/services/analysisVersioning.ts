export const getAnalysisPipelineVersion = (): string =>
  process.env.ANALYSIS_PIPELINE_VERSION || '1.0.0';

export const getAnalysisPromptVersion = (): string =>
  process.env.ANALYSIS_PROMPT_VERSION || 'case-analysis-v1';

export interface AnalysisRunVersionMetadata {
  pipelineVersion: string;
  promptVersion: string;
}

export const getAnalysisRunVersionMetadata = (): AnalysisRunVersionMetadata => ({
  pipelineVersion: getAnalysisPipelineVersion(),
  promptVersion: getAnalysisPromptVersion(),
});
