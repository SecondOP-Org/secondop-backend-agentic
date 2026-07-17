import { computeEvidenceGroundedness } from '../evals/contractChecks';
import {
  attachOnlineEvalSpanAttributes,
  computeOnlineEvalSignals,
} from '../services/onlineEvals.service';
import { buildCaseAnalysisArtifact } from '../services/analysisArtifact.service';
import type { ExtractedReport } from '../services/reportExtraction.service';

const sampleReport = (overrides: Partial<ExtractedReport> = {}): ExtractedReport => ({
  fileId: 'f1',
  fileName: 'report.pdf',
  text: 'Patient presents with chest pain and elevated troponin.',
  charCount: 50,
  extractionMethod: 'pdf-parse',
  extractionQuality: 'high',
  ocrConfidence: null,
  reused: false,
  ...overrides,
});

const buildArtifact = (snippet: string) =>
  buildCaseAnalysisArtifact({
    model: 'gpt-4.1-mini',
    confidenceScore: 0.8,
    structuredSummary: {
      chief_concern: 'Chest pain',
      key_report_findings: snippet,
      red_flags_to_discuss: 'Worsening pain',
      follow_up_discussion_points: 'Discuss imaging',
      limitations_caveats: 'AI-generated support content; licensed clinician review required.',
    },
    specialistQuestions: ['Q1?', 'Q2?', 'Q3?'],
    reports: [sampleReport()],
  });

describe('online evals (SEC-108)', () => {
  it('computes groundedness percent from evidence snippets', () => {
    const artifact = buildArtifact('elevated troponin');
    const groundedness = computeEvidenceGroundedness(artifact, [sampleReport()]);
    expect(groundedness.total).toBeGreaterThan(0);
    expect(groundedness.percent).toBeGreaterThanOrEqual(0);
    expect(groundedness.percent).toBeLessThanOrEqual(100);
  });

  it('assembles contract/critic/deid signals without LLM calls', () => {
    const artifact = buildArtifact('elevated troponin');
    const signals = computeOnlineEvalSignals({
      contractArtifact: artifact,
      reports: [
        sampleReport({
          deidentification: {
            enabled: true,
            operator: 'token_replace',
            language: 'en',
            minScore: 0.5,
            entityCount: 2,
            entities: [],
            timestamp: new Date().toISOString(),
          },
        }),
      ],
      criticScore: {
        passed: true,
        needsRefinement: false,
        score: 92,
        reasons: [],
        checks: {
          hasThreeQuestions: true,
          hasUniqueQuestions: true,
          hasObservations: true,
          hasCaveatLanguage: true,
        },
      },
    });

    expect(typeof signals.contractPass).toBe('boolean');
    expect(signals.criticScore).toBe(92);
    expect(signals.deidEntityCount).toBe(2);
    expect(signals.groundednessPercent).not.toBeNull();
    expect(signals.contractViolations).toEqual(expect.any(Array));
  });

  it('attaches CODE annotator eval attrs to a span handle', () => {
    const addAttributes = jest.fn();
    attachOnlineEvalSpanAttributes(
      { addAttributes, end: jest.fn(), run: async (fn) => fn() },
      {
        contractPass: true,
        contractViolations: [],
        criticScore: 88,
        criticPassed: true,
        groundednessPercent: 100,
        groundednessMatched: 3,
        groundednessTotal: 3,
        deidEntityCount: 4,
      }
    );

    expect(addAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'eval.annotator_kind': 'CODE',
        'eval.contract_check.label': 'pass',
        'eval.critic_score.score': 88,
        'eval.groundedness.score': 100,
        'eval.deid_entity_count.score': 4,
      })
    );
  });
});
