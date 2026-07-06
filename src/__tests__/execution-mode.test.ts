import {
  isAgenticPrimaryMode,
  normalizeExecutionMode,
  resolveExecutionMode,
  shouldRunShadowAgentic,
  toLegacyExecutionMode,
} from '../agentic/core/executionMode';

describe('execution mode resolution', () => {
  const originalExecutionMode = process.env.ANALYSIS_EXECUTION_MODE;
  const originalAgenticMode = process.env.ANALYSIS_AGENTIC_MODE;

  afterEach(() => {
    process.env.ANALYSIS_EXECUTION_MODE = originalExecutionMode;
    process.env.ANALYSIS_AGENTIC_MODE = originalAgenticMode;
  });

  it('normalizes legacy values to canonical modes', () => {
    expect(normalizeExecutionMode('off')).toBe('baseline');
    expect(normalizeExecutionMode('direct')).toBe('agentic');
    expect(normalizeExecutionMode('shadow')).toBe('shadow');
    expect(normalizeExecutionMode('baseline')).toBe('baseline');
    expect(normalizeExecutionMode('agentic')).toBe('agentic');
  });

  it('prefers ANALYSIS_EXECUTION_MODE over ANALYSIS_AGENTIC_MODE', () => {
    process.env.ANALYSIS_EXECUTION_MODE = 'shadow';
    process.env.ANALYSIS_AGENTIC_MODE = 'direct';
    expect(resolveExecutionMode()).toBe('shadow');
  });

  it('maps deprecated ANALYSIS_AGENTIC_MODE values when execution mode is unset', () => {
    delete process.env.ANALYSIS_EXECUTION_MODE;
    process.env.ANALYSIS_AGENTIC_MODE = 'off';
    expect(resolveExecutionMode()).toBe('baseline');

    process.env.ANALYSIS_AGENTIC_MODE = 'direct';
    expect(resolveExecutionMode()).toBe('agentic');
  });

  it('exposes legacy aliases for trace compatibility', () => {
    expect(toLegacyExecutionMode('baseline')).toBe('off');
    expect(toLegacyExecutionMode('agentic')).toBe('direct');
    expect(toLegacyExecutionMode('shadow')).toBe('shadow');
  });

  it('routes primary and shadow engines correctly', () => {
    expect(isAgenticPrimaryMode('agentic')).toBe(true);
    expect(isAgenticPrimaryMode('baseline')).toBe(false);
    expect(shouldRunShadowAgentic('shadow')).toBe(true);
    expect(shouldRunShadowAgentic('baseline')).toBe(false);
  });
});
