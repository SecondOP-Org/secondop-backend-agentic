import http from 'http';
import { AddressInfo } from 'net';
import { getAiGatewayStatus } from '../services/aiGatewayStatus.service';
import {
  getLlmGatewayStatus,
  getOpenAIClient,
  resetOpenAIClientForTests,
  validateLiteLlmModelAlias,
} from '../ai/llmGateway';

const originalEnv = process.env;

const withGatewayServer = async (
  handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void | Promise<void>,
  run: (baseUrl: string) => Promise<void>
) => {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      Promise.resolve(handler(req, body, res)).catch((error) => {
        res.statusCode = 500;
        res.end(error instanceof Error ? error.message : 'test server error');
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
};

describe('LLM gateway config and client', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    resetOpenAIClientForTests();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetOpenAIClientForTests();
  });

  it('reports direct mode by default without a gateway base URL', () => {
    process.env.OPENAI_API_KEY = 'direct-openai-key';

    const status = getLlmGatewayStatus();

    expect(status.mode).toBe('direct');
    expect(status.configured).toBe(true);
    expect(status.redactedBaseUrlHost).toBeNull();
  });

  it('fails clearly when LiteLLM mode is missing gateway URL or key', () => {
    process.env.LLM_GATEWAY_MODE = 'litellm';
    process.env.OPENAI_MODEL = 'secondop-case-analysis-primary';

    expect(() => getOpenAIClient()).toThrow('LLM_GATEWAY_BASE_URL is required for LLM_GATEWAY_MODE=litellm.');

    process.env.LLM_GATEWAY_BASE_URL = 'http://localhost:4000';
    expect(() => getOpenAIClient()).toThrow('LLM_GATEWAY_API_KEY is required for LLM_GATEWAY_MODE=litellm.');
  });

  it('validates LiteLLM aliases only in LiteLLM mode', () => {
    process.env.LLM_GATEWAY_MODE = 'direct';
    expect(() => validateLiteLlmModelAlias('gpt-4.1-mini')).not.toThrow();

    process.env.LLM_GATEWAY_MODE = 'litellm';
    expect(() => validateLiteLlmModelAlias('secondop-case-analysis-primary')).not.toThrow();
    expect(() => validateLiteLlmModelAlias('gpt-4.1-mini')).toThrow(
      'LiteLLM mode requires model alias "gpt-4.1-mini"'
    );
  });

  it('routes chat completions to the configured LiteLLM-compatible endpoint with the virtual key', async () => {
    await withGatewayServer(async (req, body, res) => {
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/chat/completions');
      expect(req.headers.authorization).toBe('Bearer litellm-virtual-key');
      expect(JSON.parse(body)).toEqual(expect.objectContaining({
        model: 'secondop-case-analysis-primary',
      }));

      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1,
        model: 'secondop-case-analysis-primary',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: '{"value":"ok"}' },
          },
        ],
        usage: {
          prompt_tokens: 7,
          completion_tokens: 3,
          total_tokens: 10,
        },
      }));
    }, async (baseUrl) => {
      process.env.LLM_GATEWAY_MODE = 'litellm';
      process.env.LLM_GATEWAY_BASE_URL = baseUrl;
      process.env.LLM_GATEWAY_API_KEY = 'litellm-virtual-key';
      process.env.OPENAI_MODEL = 'secondop-case-analysis-primary';

      const client = getOpenAIClient();
      const completion = await client!.chat.completions.create({
        model: 'secondop-case-analysis-primary',
        messages: [{ role: 'user', content: 'hello' }],
      });

      expect(completion.choices[0]?.message?.content).toBe('{"value":"ok"}');
      expect(completion.usage?.total_tokens).toBe(10);
    });
  });

  it('probes LiteLLM models endpoint and sanitizes gateway status', async () => {
    await withGatewayServer(async (req, _body, res) => {
      expect(req.url).toBe('/models');
      expect(req.headers.authorization).toBe('Bearer status-virtual-key');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [] }));
    }, async (baseUrl) => {
      process.env.LLM_GATEWAY_MODE = 'litellm';
      process.env.LLM_GATEWAY_BASE_URL = `${baseUrl}?token=secret`;
      process.env.LLM_GATEWAY_API_KEY = 'status-virtual-key';

      const status = await getAiGatewayStatus();

      expect(status.mode).toBe('litellm');
      expect(status.redactedBaseUrlHost).toMatch(/^127\.0\.0\.1:\d+$/);
      expect(JSON.stringify(status)).not.toContain('status-virtual-key');
      expect(JSON.stringify(status)).not.toContain('secret');
    });
  });
});
