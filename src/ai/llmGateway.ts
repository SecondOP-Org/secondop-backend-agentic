import OpenAI from 'openai';

export type LlmGatewayMode = 'direct' | 'litellm';

export interface LlmGatewayConfig {
  mode: LlmGatewayMode;
  baseUrl: string | null;
  configured: boolean;
}

export interface LlmGatewayStatus {
  mode: LlmGatewayMode;
  configured: boolean;
  redactedBaseUrlHost: string | null;
  approvedModelAliases: string[];
  configuredModelAliases: string[];
  lastError: string | null;
}

export const APPROVED_LITELLM_MODEL_ALIASES = [
  'secondop-case-analysis-primary',
  'secondop-case-analysis-fallback',
  'secondop-agentic-planner',
] as const;

const approvedAliasSet = new Set<string>(APPROVED_LITELLM_MODEL_ALIASES);

let cachedClient: OpenAI | null = null;
let cachedClientKey: string | null = null;
let lastGatewayError: string | null = null;

const normalizeMode = (value: string | undefined): LlmGatewayMode => {
  const normalized = (value || 'direct').trim().toLowerCase();
  if (normalized === 'direct' || normalized === 'litellm') {
    return normalized;
  }
  throw new Error(`Unsupported LLM_GATEWAY_MODE "${value}". Expected "direct" or "litellm".`);
};

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for LLM_GATEWAY_MODE=litellm.`);
  }
  return value;
};

export const getLlmGatewayConfig = (): LlmGatewayConfig => {
  const mode = normalizeMode(process.env.LLM_GATEWAY_MODE);
  if (mode === 'direct') {
    return {
      mode,
      baseUrl: null,
      configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    };
  }

  return {
    mode,
    baseUrl: process.env.LLM_GATEWAY_BASE_URL?.trim() || null,
    configured: Boolean(process.env.LLM_GATEWAY_BASE_URL?.trim() && process.env.LLM_GATEWAY_API_KEY?.trim()),
  };
};

export const isLiteLlmMode = (): boolean => getLlmGatewayConfig().mode === 'litellm';

export const validateLiteLlmModelAlias = (model: string): void => {
  if (!isLiteLlmMode()) {
    return;
  }

  if (!approvedAliasSet.has(model)) {
    throw new Error(
      `LiteLLM mode requires model alias "${model}" to be one of ${APPROVED_LITELLM_MODEL_ALIASES.join(', ')}.`
    );
  }
};

export const validateConfiguredModelAliases = (): void => {
  if (!isLiteLlmMode()) {
    return;
  }

  [
    process.env.OPENAI_MODEL,
    process.env.OPENAI_FALLBACK_MODEL,
    process.env.AGENTIC_MODEL,
    process.env.AGENTIC_PLANNER_FALLBACK_MODEL,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .forEach(validateLiteLlmModelAlias);
};

export const getOpenAIClient = (options?: { optional?: boolean }): OpenAI | null => {
  const mode = normalizeMode(process.env.LLM_GATEWAY_MODE);
  const clientKey = [
    mode,
    process.env.OPENAI_API_KEY || '',
    process.env.LLM_GATEWAY_BASE_URL || '',
    process.env.LLM_GATEWAY_API_KEY || '',
  ].join('|');

  if (cachedClient && cachedClientKey === clientKey) {
    return cachedClient;
  }

  if (mode === 'direct') {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      if (options?.optional) {
        return null;
      }
      throw new Error('OPENAI_API_KEY is not configured.');
    }

    cachedClient = new OpenAI({ apiKey });
    cachedClientKey = clientKey;
    return cachedClient;
  }

  const baseURL = requireEnv('LLM_GATEWAY_BASE_URL');
  const apiKey = requireEnv('LLM_GATEWAY_API_KEY');
  validateConfiguredModelAliases();

  cachedClient = new OpenAI({ apiKey, baseURL });
  cachedClientKey = clientKey;
  return cachedClient;
};

export const resetOpenAIClientForTests = (): void => {
  cachedClient = null;
  cachedClientKey = null;
  lastGatewayError = null;
};

export const sanitizeGatewayError = (value: unknown): string => {
  const text = value instanceof Error ? value.message : String(value ?? '');
  return text
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '$1 [REDACTED_TOKEN]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[REDACTED_TOKEN]')
    .replace(/https?:\/\/[^\s]+(?:token|code|state|auth|password|secret|key)=[^\s)]+/gi, '[REDACTED_URL]')
    .replace(/postgres(?:ql)?:\/\/[^\s)]+/gi, '[REDACTED_DATABASE_URL]');
};

export const recordLlmGatewayError = (error: unknown): void => {
  lastGatewayError = sanitizeGatewayError(error);
};

export const getLastLlmGatewayError = (): string | null => lastGatewayError;

export const redactBaseUrlHost = (baseUrl: string | null): string | null => {
  if (!baseUrl) {
    return null;
  }

  try {
    const parsed = new URL(baseUrl);
    return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  } catch {
    return '[invalid-url]';
  }
};

export const getConfiguredModelAliases = (): string[] => {
  return [
    process.env.OPENAI_MODEL,
    process.env.OPENAI_FALLBACK_MODEL,
    process.env.AGENTIC_MODEL,
    process.env.AGENTIC_PLANNER_FALLBACK_MODEL,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
};

export const getLlmGatewayStatus = (): LlmGatewayStatus => {
  const config = getLlmGatewayConfig();
  return {
    mode: config.mode,
    configured: config.configured,
    redactedBaseUrlHost: redactBaseUrlHost(config.baseUrl),
    approvedModelAliases: [...APPROVED_LITELLM_MODEL_ALIASES],
    configuredModelAliases: getConfiguredModelAliases(),
    lastError: lastGatewayError,
  };
};
