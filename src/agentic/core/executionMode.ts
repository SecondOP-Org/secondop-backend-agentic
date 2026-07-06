export type AnalysisExecutionMode = 'baseline' | 'shadow' | 'agentic';

/** @deprecated Prefer AnalysisExecutionMode. Kept for transitional API compatibility. */
export type LegacyAnalysisExecutionMode = 'off' | 'shadow' | 'direct';

const VALID_MODES: AnalysisExecutionMode[] = ['baseline', 'shadow', 'agentic'];

export const normalizeExecutionMode = (raw: string | null | undefined): AnalysisExecutionMode => {
  const value = (raw || '').trim().toLowerCase();

  switch (value) {
    case 'baseline':
    case 'off':
      return 'baseline';
    case 'shadow':
      return 'shadow';
    case 'agentic':
    case 'direct':
      return 'agentic';
    default:
      return 'baseline';
  }
};

export const resolveExecutionMode = (): AnalysisExecutionMode => {
  const raw = process.env.ANALYSIS_EXECUTION_MODE || process.env.ANALYSIS_AGENTIC_MODE || 'baseline';
  return normalizeExecutionMode(raw);
};

export const isValidExecutionMode = (value: string): value is AnalysisExecutionMode =>
  VALID_MODES.includes(value as AnalysisExecutionMode);

export const toLegacyExecutionMode = (mode: AnalysisExecutionMode): LegacyAnalysisExecutionMode => {
  switch (mode) {
    case 'baseline':
      return 'off';
    case 'shadow':
      return 'shadow';
    case 'agentic':
      return 'direct';
  }
};

export const isAgenticPrimaryMode = (mode: AnalysisExecutionMode): boolean => mode === 'agentic';

export const shouldRunShadowAgentic = (mode: AnalysisExecutionMode): boolean => mode === 'shadow';
