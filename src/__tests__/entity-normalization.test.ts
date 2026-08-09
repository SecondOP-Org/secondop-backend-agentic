/**
 * Entity normalization + RxNorm (SEC-206 Phase 1).
 */
jest.mock('../ai/llmGateway', () => ({
  getOpenAIClient: jest.fn(),
  isLiteLlmMode: jest.fn(() => false),
  validateLiteLlmModelAlias: jest.fn(),
}));

import { getOpenAIClient } from '../ai/llmGateway';
import { normalizeIntakeEntities } from '../services/grounding/entityNormalization.service';
import { clearRxNormCacheForTests, resolveDrug } from '../services/grounding/rxNorm.client';

const mockedGetOpenAIClient = getOpenAIClient as jest.MockedFunction<typeof getOpenAIClient>;

describe('entity normalization + RxNorm (SEC-206)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearRxNormCacheForTests();
    mockedGetOpenAIClient.mockReset();
    global.fetch = originalFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('resolveDrug returns rxcui on match and null on no match / error', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ idGroup: { rxnormId: ['6809'], name: 'Metformin' } }),
    }) as unknown as typeof fetch;

    await expect(resolveDrug('metformin')).resolves.toEqual({
      rxcui: '6809',
      normalizedName: 'Metformin',
    });

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ idGroup: {} }),
    }) as unknown as typeof fetch;
    clearRxNormCacheForTests();
    await expect(resolveDrug('some blood thinner')).resolves.toBeNull();

    global.fetch = jest.fn().mockRejectedValueOnce(new Error('network down')) as unknown as typeof fetch;
    clearRxNormCacheForTests();
    await expect(resolveDrug('aspirin')).resolves.toBeNull();
  });

  it('normalizes metformin/lisinopril with RxCUIs and marks vague med unresolved', async () => {
    mockedGetOpenAIClient.mockReturnValue({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    medications: ['metformin', 'lisinopril', 'some blood thinner'],
                    conditions: [{ raw: 'type 2 diabetes', code: '', system: '' }],
                    evidenceTerms: ['type 2 diabetes', 'hypertension'],
                  }),
                },
              },
            ],
          }),
        },
      },
    } as never);

    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('name=metformin')) {
        return {
          ok: true,
          json: async () => ({ idGroup: { rxnormId: ['6809'], name: 'Metformin' } }),
        };
      }
      if (u.includes('name=lisinopril')) {
        return {
          ok: true,
          json: async () => ({ idGroup: { rxnormId: ['29046'], name: 'Lisinopril' } }),
        };
      }
      return { ok: true, json: async () => ({ idGroup: {} }) };
    }) as unknown as typeof fetch;

    const result = await normalizeIntakeEntities({
      currentMedications: 'metformin, lisinopril, some blood thinner',
      medicalHistory: 'type 2 diabetes',
      symptoms: '',
      specialtyContext: 'endocrinology',
    });

    const resolved = result.medications.filter((m) => !m.unresolved && m.rxcui);
    const unresolved = result.medications.filter((m) => m.unresolved);
    expect(resolved.length).toBeGreaterThanOrEqual(2);
    expect(unresolved.some((m) => /blood thinner/i.test(m.raw))).toBe(true);
  });

  it('fail-soft: LLM throw still returns best-effort entities without throwing', async () => {
    mockedGetOpenAIClient.mockReturnValue({
      chat: {
        completions: {
          create: jest.fn().mockRejectedValue(new Error('LLM boom')),
        },
      },
    } as never);

    global.fetch = jest.fn().mockRejectedValue(new Error('RxNorm boom')) as unknown as typeof fetch;

    await expect(
      normalizeIntakeEntities({
        currentMedications: 'metformin, lisinopril',
        medicalHistory: 'diabetes',
        symptoms: 'fatigue',
        specialtyContext: 'endocrinology',
      })
    ).resolves.toMatchObject({
      medications: expect.arrayContaining([
        expect.objectContaining({ raw: 'metformin', unresolved: true }),
        expect.objectContaining({ raw: 'lisinopril', unresolved: true }),
      ]),
    });
  });
});
