/**
 * LLM gateway — OpenAI / LiteLLM client factory.
 *
 * PHI RULE (spans): NEVER attach prompt or completion message bodies to Phoenix/OTel spans.
 * Attribute allowlist only: model names, token counts, latency, cost, ids/workflow purpose.
 * Clinical text stays in application memory and audited DB paths — not in traces.
 */
import OpenAI from 'openai';
import {
  estimateTokenCostUsd,
  startPhoenixSpan,
} from '../observability/phoenix.service';

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

const resolveLlmPurpose = (
  params: OpenAI.Chat.Completions.ChatCompletionCreateParams
): string => {
  const metadata = (params as { metadata?: Record<string, string> }).metadata;
  const workflow = metadata?.workflow?.trim();
  if (workflow) {
    return workflow.replace(/[^a-zA-Z0-9._-]/g, '_');
  }
  return 'chat';
};

const instrumentChatCompletions = (client: OpenAI): OpenAI => {
  const originalCreate = client.chat.completions.create.bind(client.chat.completions);

  client.chat.completions.create = (async (
    params: OpenAI.Chat.Completions.ChatCompletionCreateParams,
    options?: OpenAI.RequestOptions
  ) => {
    const purpose = resolveLlmPurpose(params);
    const requestModel = typeof params.model === 'string' ? params.model : String(params.model);
    const startedAt = Date.now();
    const span = startPhoenixSpan(
      `llm.${purpose}`,
      {
        'gen_ai.request.model': requestModel,
        'gen_ai.operation.name': 'chat',
        purpose,
      },
      'LLM'
    );

    try {
      const result = await span.run(() => originalCreate(params as any, options));
      const usage = (result as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } })
        ?.usage;
      const promptTokens = Number(usage?.prompt_tokens || 0);
      const completionTokens = Number(usage?.completion_tokens || 0);
      const totalTokens = Number(usage?.total_tokens || promptTokens + completionTokens);
      const responseModel =
        typeof (result as { model?: string })?.model === 'string'
          ? (result as { model: string }).model
          : requestModel;

      span.addAttributes({
        'gen_ai.response.model': responseModel,
        'gen_ai.usage.prompt_tokens': promptTokens,
        'gen_ai.usage.completion_tokens': completionTokens,
        'gen_ai.usage.total_tokens': totalTokens,
        latency_ms: Date.now() - startedAt,
        estimated_cost_usd: estimateTokenCostUsd(promptTokens, completionTokens),
      });
      span.end('OK');
      return result;
    } catch (error) {
      span.addAttributes({ latency_ms: Date.now() - startedAt });
      span.end('ERROR', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }) as typeof client.chat.completions.create;

  return client;
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

    cachedClient = instrumentChatCompletions(new OpenAI({ apiKey }));
    cachedClientKey = clientKey;
    return cachedClient;
  }

  const baseURL = requireEnv('LLM_GATEWAY_BASE_URL');
  const apiKey = requireEnv('LLM_GATEWAY_API_KEY');
  validateConfiguredModelAliases();

  cachedClient = instrumentChatCompletions(new OpenAI({ apiKey, baseURL }));
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
