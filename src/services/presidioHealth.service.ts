import { getPresidioConfig } from './presidioConfig.service';

export interface PresidioProbeResult {
  service: 'analyzer' | 'anonymizer';
  status: 'available' | 'unavailable' | 'skipped';
  statusCode?: number;
  error?: string;
  latencyMs?: number;
}

export interface PresidioStatusResponse {
  enabled: boolean;
  reversibleKeyConfigured: boolean;
  analyzerUrlHost: string | null;
  anonymizerUrlHost: string | null;
  probes: PresidioProbeResult[];
  ready: boolean;
}

const redactHost = (url: string): string | null => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

const probe = async (
  service: 'analyzer' | 'anonymizer',
  baseUrl: string,
  timeoutMs: number
): Promise<PresidioProbeResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(timeoutMs, 3000));
  const started = Date.now();

  try {
    const response = await fetch(new URL('/health', baseUrl), {
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        service,
        status: 'unavailable',
        statusCode: response.status,
        error: `HTTP ${response.status}`,
        latencyMs: Date.now() - started,
      };
    }

    return {
      service,
      status: 'available',
      statusCode: response.status,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      service,
      status: 'unavailable',
      error: error instanceof Error ? error.message : 'Presidio probe failed',
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const getPresidioStatus = async (): Promise<PresidioStatusResponse> => {
  const config = getPresidioConfig();

  if (!config.enabled) {
    return {
      enabled: false,
      reversibleKeyConfigured: config.reversibleKeyConfigured,
      analyzerUrlHost: redactHost(config.analyzerUrl),
      anonymizerUrlHost: redactHost(config.anonymizerUrl),
      probes: [
        { service: 'analyzer', status: 'skipped' },
        { service: 'anonymizer', status: 'skipped' },
      ],
      ready: false,
    };
  }

  const probes = await Promise.all([
    probe('analyzer', config.analyzerUrl, config.timeoutMs),
    probe('anonymizer', config.anonymizerUrl, config.timeoutMs),
  ]);

  const ready =
    config.reversibleKeyConfigured &&
    probes.every((item) => item.status === 'available');

  return {
    enabled: true,
    reversibleKeyConfigured: config.reversibleKeyConfigured,
    analyzerUrlHost: redactHost(config.analyzerUrl),
    anonymizerUrlHost: redactHost(config.anonymizerUrl),
    probes,
    ready,
  };
};
