import {
  assertAgenticRuntimeConfigAtStartup,
  isLangChainFallbackAllowed,
  isLangChainRuntimeEnabled,
  resolveAgenticRuntimeConfig,
} from '../config/agenticRuntime';

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import logger from '../utils/logger';

describe('agentic runtime config (SEC-14)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AGENTIC_RUNTIME;
    delete process.env.AGENTIC_LANGCHAIN_ALLOW_FALLBACK;
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('defaults to native when AGENTIC_RUNTIME is unset', () => {
    expect(resolveAgenticRuntimeConfig({})).toEqual({
      runtime: 'native',
      langchainFallbackAllowed: true,
    });
    expect(isLangChainRuntimeEnabled({})).toBe(false);
  });

  it('accepts langchain and surfaces fallback policy', () => {
    expect(
      resolveAgenticRuntimeConfig({
        AGENTIC_RUNTIME: 'langchain',
        AGENTIC_LANGCHAIN_ALLOW_FALLBACK: 'false',
      })
    ).toEqual({
      runtime: 'langchain',
      langchainFallbackAllowed: false,
    });
    expect(isLangChainRuntimeEnabled({ AGENTIC_RUNTIME: 'LangChain' })).toBe(true);
  });

  it('rejects unsupported AGENTIC_RUNTIME values', () => {
    expect(() =>
      resolveAgenticRuntimeConfig({ AGENTIC_RUNTIME: 'temporal' })
    ).toThrow(/Unsupported AGENTIC_RUNTIME="temporal"/);
  });

  it('treats AGENTIC_LANGCHAIN_ALLOW_FALLBACK default as true', () => {
    expect(isLangChainFallbackAllowed({})).toBe(true);
    expect(isLangChainFallbackAllowed({ AGENTIC_LANGCHAIN_ALLOW_FALLBACK: 'false' })).toBe(false);
  });

  it('logs native path at startup', () => {
    assertAgenticRuntimeConfigAtStartup({ AGENTIC_RUNTIME: 'native' });
    expect(logger.info).toHaveBeenCalledWith('Agentic runtime: native (default)');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs explicit langchain fallback-enabled warning at startup', () => {
    assertAgenticRuntimeConfigAtStartup({
      AGENTIC_RUNTIME: 'langchain',
      AGENTIC_LANGCHAIN_ALLOW_FALLBACK: 'true',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('fall back to the native runtime')
    );
  });

  it('logs explicit langchain no-fallback warning at startup', () => {
    assertAgenticRuntimeConfigAtStartup({
      AGENTIC_RUNTIME: 'langchain',
      AGENTIC_LANGCHAIN_ALLOW_FALLBACK: 'false',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no native fallback')
    );
  });

  it('fails startup validation for unsupported runtime', () => {
    expect(() =>
      assertAgenticRuntimeConfigAtStartup({ AGENTIC_RUNTIME: 'noop' })
    ).toThrow(/Unsupported AGENTIC_RUNTIME/);
  });
});
