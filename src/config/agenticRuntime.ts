import logger from '../utils/logger';

export const SUPPORTED_AGENTIC_RUNTIMES = ['native', 'langchain'] as const;

export type AgenticRuntimeName = (typeof SUPPORTED_AGENTIC_RUNTIMES)[number];

export interface AgenticRuntimeConfig {
  runtime: AgenticRuntimeName;
  langchainFallbackAllowed: boolean;
}

const normalizeRuntime = (raw: string | undefined): string =>
  (raw || 'native').trim().toLowerCase();

export const isSupportedAgenticRuntime = (value: string): value is AgenticRuntimeName =>
  (SUPPORTED_AGENTIC_RUNTIMES as readonly string[]).includes(value);

export const isLangChainFallbackAllowed = (
  env: NodeJS.ProcessEnv = process.env
): boolean => (env.AGENTIC_LANGCHAIN_ALLOW_FALLBACK || 'true').toLowerCase() !== 'false';

/**
 * Resolve AGENTIC_RUNTIME. Throws for unsupported values so misconfiguration
 * fails before analysis jobs run.
 */
export const resolveAgenticRuntimeConfig = (
  env: NodeJS.ProcessEnv = process.env
): AgenticRuntimeConfig => {
  const runtime = normalizeRuntime(env.AGENTIC_RUNTIME);

  if (!isSupportedAgenticRuntime(runtime)) {
    throw new Error(
      `Unsupported AGENTIC_RUNTIME="${env.AGENTIC_RUNTIME}". ` +
        `Supported values: ${SUPPORTED_AGENTIC_RUNTIMES.join(', ')}. ` +
        'Unset AGENTIC_RUNTIME or set AGENTIC_RUNTIME=native for the default path.'
    );
  }

  return {
    runtime,
    langchainFallbackAllowed: isLangChainFallbackAllowed(env),
  };
};

export const isLangChainRuntimeEnabled = (
  env: NodeJS.ProcessEnv = process.env
): boolean => resolveAgenticRuntimeConfig(env).runtime === 'langchain';

/**
 * Validate agentic runtime env at process startup and log the active path.
 * Unsupported values abort startup; langchain fallback policy is always explicit.
 */
export const assertAgenticRuntimeConfigAtStartup = (
  env: NodeJS.ProcessEnv = process.env
): AgenticRuntimeConfig => {
  const config = resolveAgenticRuntimeConfig(env);

  if (config.runtime === 'native') {
    logger.info('Agentic runtime: native (default)');
    return config;
  }

  if (config.langchainFallbackAllowed) {
    logger.warn(
      'Agentic runtime: langchain. AGENTIC_LANGCHAIN_ALLOW_FALLBACK=true — ' +
        'LangGraph failures fall back to the native runtime for the same analysis job.'
    );
  } else {
    logger.warn(
      'Agentic runtime: langchain. AGENTIC_LANGCHAIN_ALLOW_FALLBACK=false — ' +
        'LangGraph failures fail the analysis job (no native fallback).'
    );
  }

  return config;
};
