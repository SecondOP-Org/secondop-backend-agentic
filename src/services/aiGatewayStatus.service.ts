import {
  getLastLlmGatewayError,
  getLlmGatewayConfig,
  getLlmGatewayStatus,
  recordLlmGatewayError,
} from '../ai/llmGateway';

export interface AiGatewayStatusResponse {
  mode: 'direct' | 'litellm';
  configured: boolean;
  redactedBaseUrlHost: string | null;
  approvedModelAliases: string[];
  configuredModelAliases: string[];
  probe: {
    attempted: boolean;
    status: 'skipped' | 'available' | 'unavailable';
    statusCode?: number;
    error?: string;
  };
  lastError: string | null;
}

const probeTimeoutMs = 1500;

export const getAiGatewayStatus = async (): Promise<AiGatewayStatusResponse> => {
  const baseStatus = getLlmGatewayStatus();
  const config = getLlmGatewayConfig();

  if (config.mode !== 'litellm') {
    return {
      ...baseStatus,
      probe: {
        attempted: false,
        status: 'skipped',
      },
      lastError: getLastLlmGatewayError(),
    };
  }

  if (!config.configured || !config.baseUrl) {
    return {
      ...baseStatus,
      probe: {
        attempted: false,
        status: 'unavailable',
        error: 'LiteLLM gateway URL/key is not fully configured.',
      },
      lastError: getLastLlmGatewayError(),
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), probeTimeoutMs);

  try {
    const response = await fetch(new URL('/models', config.baseUrl), {
      headers: {
        Authorization: `Bearer ${process.env.LLM_GATEWAY_API_KEY || ''}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`LiteLLM /models probe returned HTTP ${response.status}.`);
    }

    return {
      ...baseStatus,
      probe: {
        attempted: true,
        status: 'available',
        statusCode: response.status,
      },
      lastError: getLastLlmGatewayError(),
    };
  } catch (error) {
    recordLlmGatewayError(error);
    return {
      ...baseStatus,
      probe: {
        attempted: true,
        status: 'unavailable',
        error: getLastLlmGatewayError() || 'LiteLLM gateway probe failed.',
      },
      lastError: getLastLlmGatewayError(),
    };
  } finally {
    clearTimeout(timeout);
  }
};
