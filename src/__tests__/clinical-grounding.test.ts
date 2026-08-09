/**
 * Grounding clients + tool registration (SEC-206 Phase 2).
 */
import {
  isGroundingEnabled,
  listRegisteredGroundingTools,
} from '../config/grounding';
import {
  clearClinicalTrialsCacheForTests,
  searchTrials,
} from '../services/grounding/clinicalTrials.client';
import { clearPubMedCacheForTests, searchPubMed } from '../services/grounding/pubmed.client';
import { groundEvidenceTool } from '../agentic/tools/groundEvidence.tool';
import { AgenticLoopState, AgenticRuntimeContext } from '../agentic/core/types';

describe('clinical grounding tools (SEC-206)', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GROUNDING_ENABLED;
    delete process.env.CLINICAL_TRIALS_SPECIALTY_ALLOWLIST;
    clearPubMedCacheForTests();
    clearClinicalTrialsCacheForTests();
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('is disabled by default (ship dark)', () => {
    expect(isGroundingEnabled()).toBe(false);
    expect(listRegisteredGroundingTools({ specialtyContext: 'oncology' })).toEqual([]);
  });

  it('registers pubmed for all specialties and clinicalTrials only on allowlist', () => {
    process.env.GROUNDING_ENABLED = 'true';
    expect(listRegisteredGroundingTools({ specialtyContext: 'oncology' })).toEqual([
      'pubmed',
      'clinicalTrials',
    ]);
    expect(listRegisteredGroundingTools({ specialtyContext: 'cardiology' })).toEqual(['pubmed']);
    expect(listRegisteredGroundingTools({ specialtyContext: 'Hematology Oncology' })).toEqual([
      'pubmed',
      'clinicalTrials',
    ]);
  });

  it('searchPubMed maps PMIDs to resolvable URLs (mocked HTTP)', async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('esearch')) {
        return {
          ok: true,
          json: async () => ({ esearchresult: { idlist: ['12345'] } }),
        };
      }
      if (u.includes('esummary')) {
        return {
          ok: true,
          json: async () => ({
            result: {
              uids: ['12345'],
              '12345': {
                title: 'Example oncology trial review',
                fulljournalname: 'J Clin Oncol',
                pubdate: '2024 Jan',
              },
            },
          }),
        };
      }
      throw new Error(`unexpected url ${u}`);
    }) as unknown as typeof fetch;

    const citations = await searchPubMed(['breast cancer', 'HER2'], 5);
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({
      source: 'pubmed',
      pmid: '12345',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12345/',
    });
  });

  it('searchTrials maps NCT IDs to resolvable URLs (mocked HTTP)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        studies: [
          {
            protocolSection: {
              identificationModule: { nctId: 'NCT01234567', briefTitle: 'Study of X' },
              statusModule: { overallStatus: 'RECRUITING' },
              designModule: { phases: ['PHASE2'] },
              eligibilityModule: { eligibilityCriteria: 'Adults with condition Y' },
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const trials = await searchTrials({ condition: 'breast cancer', status: 'RECRUITING' });
    expect(trials).toHaveLength(1);
    expect(trials[0]).toMatchObject({
      source: 'clinicaltrials',
      nctId: 'NCT01234567',
      url: 'https://clinicaltrials.gov/study/NCT01234567',
    });
    expect(trials[0].eligibilitySummary).toMatch(/Potentially relevant/i);
  });

  it('external call failures fail-soft to empty arrays', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout')) as unknown as typeof fetch;
    await expect(searchPubMed(['x'])).resolves.toEqual([]);
    await expect(searchTrials({ condition: 'y' })).resolves.toEqual([]);
  });

  it('groundEvidenceTool completes analysis path when APIs throw (fail-soft)', async () => {
    process.env.GROUNDING_ENABLED = 'true';
    global.fetch = jest.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch;

    const state: AgenticLoopState = {
      caseId: 'c1',
      runId: 'r1',
      mode: 'agentic',
      stepCount: 1,
      refinementCount: 0,
      criticFeedback: null,
      intake: {
        age: 55,
        sex: 'female',
        specialtyContext: 'oncology',
        symptoms: 'pain',
        symptomDuration: '2 months',
        medicalHistory: 'breast cancer',
        currentMedications: 'tamoxifen',
        allergies: 'none',
      },
      reports: [{ fileId: 'f1', fileName: 'a.pdf', text: 'findings', pageCount: 1 } as never],
      analysis: null,
      observations: [],
      finalArtifact: null,
      criticScore: null,
      normalizedEntities: {
        medications: [],
        conditions: [{ raw: 'breast cancer' }],
        evidenceTerms: ['breast cancer'],
      },
    };

    const context = { caseId: 'c1', runId: 'r1' } as AgenticRuntimeContext;
    const next = await groundEvidenceTool(context, state);
    expect(next.groundingCompleted).toBe(true);
    expect(next.citations).toEqual([]);
    expect(next.trialMatches).toEqual([]);
  });
});

const runLive = process.env.RUN_LIVE_GROUNDING === '1';

(runLive ? describe : describe.skip)('live grounding APIs (RUN_LIVE_GROUNDING=1)', () => {
  jest.setTimeout(30_000);

  it('PubMed returns real PMIDs', async () => {
    const citations = await searchPubMed(['breast cancer HER2'], 3);
    expect(citations.length).toBeGreaterThan(0);
    expect(citations[0].pmid).toMatch(/^\d+$/);
    expect(citations[0].url).toMatch(/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/$/);
  });

  it('ClinicalTrials returns real NCT IDs', async () => {
    const trials = await searchTrials({ condition: 'breast cancer', status: 'RECRUITING' });
    expect(trials.length).toBeGreaterThan(0);
    expect(trials[0].nctId).toMatch(/^NCT\d+$/);
    expect(trials[0].url).toContain(trials[0].nctId);
  });
});
