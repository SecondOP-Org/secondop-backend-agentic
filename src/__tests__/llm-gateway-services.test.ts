import http from 'http';
import { AddressInfo } from 'net';
import { PlannerAgent } from '../agentic/planner/planner.agent';
import { AgenticLoopState, AgenticRuntimeContext } from '../agentic/core/types';
import { resetOpenAIClientForTests } from '../ai/llmGateway';
import { generateCaseAnalysis } from '../services/analysis.service';

const originalEnv = process.env;

const withJsonServer = async (
  responseContent: string,
  run: (baseUrl: string, requests: Array<{ url?: string; authorization?: string; body: string }>) => Promise<void>
) => {
  const requests: Array<{ url?: string; authorization?: string; body: string }> = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({
        url: req.url,
        authorization: req.headers.authorization,
        body,
      });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        id: 'chatcmpl-service-test',
        object: 'chat.completion',
        created: 1,
        model: 'secondop-case-analysis-primary',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: responseContent },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
};

describe('LLM gateway service integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      LLM_GATEWAY_MODE: 'litellm',
      LLM_GATEWAY_API_KEY: 'service-virtual-key',
      OPENAI_MODEL: 'secondop-case-analysis-primary',
      AGENTIC_MODEL: 'secondop-agentic-planner',
    };
    resetOpenAIClientForTests();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetOpenAIClientForTests();
  });

  it('routes case analysis through the shared LiteLLM client without changing output parsing', async () => {
    const analysisResponse = JSON.stringify({
      structured_summary: {
        chief_concern: 'Chest pressure',
        key_report_findings: 'Report text reviewed',
        red_flags_to_discuss: 'Worsening symptoms',
        follow_up_discussion_points: 'Discuss diagnostics',
        limitations_caveats: 'Requires clinician review',
      },
      questionnaire: {
        specialist_questions: [
          { question: 'What diagnostic testing is recommended now?' },
          { question: 'What red flags should prompt urgent care?' },
          { question: 'What follow-up interval is appropriate?' },
        ],
      },
      confidence_score: 0.7,
      disclaimer: 'A licensed clinician must review the source records.',
    });

    await withJsonServer(analysisResponse, async (baseUrl, requests) => {
      process.env.LLM_GATEWAY_BASE_URL = baseUrl;

      const result = await generateCaseAnalysis(
        {
          age: 42,
          sex: 'female',
          specialtyContext: 'cardiology',
          symptoms: 'Chest pressure',
          symptomDuration: '2 weeks',
          medicalHistory: 'Hypertension',
          currentMedications: 'Aspirin',
          allergies: 'None',
        },
        [
          {
            fileId: 'file-1',
            fileName: 'report.pdf',
            text: 'Report text reviewed',
            charCount: 20,
          },
        ]
      );

      expect(result.model).toBe('secondop-case-analysis-primary');
      expect(result.topQuestions).toHaveLength(3);
      expect(requests[0]).toEqual(expect.objectContaining({
        url: '/chat/completions',
        authorization: 'Bearer service-virtual-key',
      }));
    });
  });

  it('keeps planner fallback when direct mode has no OpenAI key', async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      LLM_GATEWAY_MODE: 'direct',
      OPENAI_API_KEY: '',
    };
    resetOpenAIClientForTests();

    const planner = new PlannerAgent();
    const context: AgenticRuntimeContext = {
      caseId: 'case-1',
      runId: 'run-1',
      mode: 'shadow',
      maxCharsPerFile: 12000,
      maxTotalChars: 30000,
      model: 'gpt-4.1-mini',
      policy: {
        allowedActions: ['VALIDATE_INTAKE', 'EXTRACT_REPORTS', 'SYNTHESIZE_SUMMARY', 'GUARD_QUESTIONS', 'FINALIZE'],
        maxSteps: 8,
        maxRefinements: 1,
      },
    };
    const state: AgenticLoopState = {
      caseId: 'case-1',
      runId: 'run-1',
      mode: 'shadow',
      stepCount: 0,
      refinementCount: 0,
      criticFeedback: null,
      intake: null,
      reports: [],
      analysis: null,
      observations: [],
      finalArtifact: null,
      criticScore: null,
    };

    const decision = await planner.planNextAction(context, state, []);

    expect(decision.action).toBe('VALIDATE_INTAKE');
    expect(decision.rationale).toBe('Fallback planner action selected without model client.');
  });
});
