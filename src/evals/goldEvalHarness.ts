import { runCaseAnalysis } from '../agents/case-analysis/runCaseAnalysis';
import { runAgenticCaseAnalysis } from '../agentic/orchestration/runAgenticCaseAnalysis';
import { CaseAnalysisArtifact } from '../services/analysisArtifact.service';
import { getOpenAIClient } from '../ai/llmGateway';
import { validateCaseAnalysisContract } from './contractChecks';
import { loadGoldCases, LoadGoldCasesOptions } from './gold/loadGoldCases';
import { GoldCase } from './gold/schema';
import {
  evaluateSafetyAssertions,
  flattenOutputText,
  referenceFindingRecall,
} from './gold/safetyAssertions';
import { flattenGoldReferenceAsOutput, mapGoldCaseToFixtures } from './gold/mapGoldCase';
import {
  GOLD_JUDGE_RUBRIC,
  GOLD_JUDGE_RUBRIC_VERSION,
  resolveGoldJudgeModel,
} from './gold/judgeRubric';

export type GoldEngine = 'baseline' | 'agentic';

export interface GoldCaseResult {
  caseId: string;
  engine: GoldEngine;
  correctness: number;
  safetyPassed: boolean;
  safetyFailures: string[];
  quality: number;
  judgeRationale: string;
  findingRecall: number;
  judgeScore: number | null;
}

export interface GoldEngineScorecard {
  engine: GoldEngine;
  goldSetVersion: string;
  caseCount: number;
  meanCorrectness: number | null;
  safetyPassRate: number;
  meanQuality: number | null;
  failingSafetyCases: string[];
}

export interface GoldEvalReport {
  generatedAt: string;
  goldSetVersion: string;
  judgeModel: string;
  judgeRubricVersion: string;
  mode: 'live' | 'score-only';
  baseline: GoldEngineScorecard | null;
  agentic: GoldEngineScorecard | null;
  results: GoldCaseResult[];
  gatePassed: boolean;
  gateFailures: string[];
}

export interface RunGoldEvalHarnessOptions {
  engines?: GoldEngine[] | 'both';
  subset?: LoadGoldCasesOptions['subset'];
  goldSetVersion?: string;
  /** Score reference-as-output without calling engines (no API key). */
  scoreOnly?: boolean;
  /** Skip LLM judge; correctness = finding recall only. */
  skipJudge?: boolean;
  maxCharsPerFile?: number;
  maxTotalChars?: number;
  /** Agentic meanCorrectness must not trail baseline by more than this (live mode). */
  agenticCorrectnessMargin?: number;
}

const mean = (values: number[]): number | null => {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const resolveEngines = (engines: RunGoldEvalHarnessOptions['engines']): GoldEngine[] => {
  if (!engines || engines === 'both') return ['baseline', 'agentic'];
  return engines;
};

const artifactToOutputText = (artifact: CaseAnalysisArtifact | null | undefined, summary?: string): string =>
  flattenOutputText({
    summary: summary || artifact?.structured_summary?.chief_concern || '',
    structuredSummary: artifact?.structured_summary || null,
    questions: artifact?.questionnaire?.specialist_questions?.map((q) => q.question) || [],
  });

const scoreQualityFromArtifact = (
  artifact: CaseAnalysisArtifact | null | undefined,
  reports: { text: string; fileName: string; fileId?: string }[]
): number => {
  if (!artifact) return 0;
  const result = validateCaseAnalysisContract(artifact, {
    reports: reports.map((report, index) => ({
      fileId: report.fileId || `r-${index}`,
      fileName: report.fileName,
      text: report.text,
      charCount: report.text.length,
      extractionMethod: 'cache' as const,
      extractionQuality: 'high' as const,
      ocrConfidence: null,
      reused: false,
    })),
  });
  return result.passed ? 1 : Math.max(0, 1 - result.violations.length * 0.2);
};

export const scoreGoldCaseAgainstOutput = async (input: {
  goldCase: GoldCase;
  engine: GoldEngine;
  outputText: string;
  artifact?: CaseAnalysisArtifact | null;
  skipJudge?: boolean;
}): Promise<GoldCaseResult> => {
  const safety = evaluateSafetyAssertions(input.goldCase, input.outputText);
  const findingRecall = referenceFindingRecall(input.goldCase, input.outputText);

  let judgeScore: number | null = null;
  let judgeRationale = 'judge skipped';

  if (!input.skipJudge) {
    const judged = await runGoldJudge({
      goldCase: input.goldCase,
      outputText: input.outputText,
    });
    judgeScore = judged.score;
    judgeRationale = judged.rationale;
  }

  const correctness =
    judgeScore === null ? findingRecall : Number((0.5 * findingRecall + 0.5 * judgeScore).toFixed(4));

  const quality = input.artifact
    ? scoreQualityFromArtifact(
        input.artifact,
        input.goldCase.inputs.reports.map((report, index) => ({
          fileName: report.fileName,
          text: report.text,
          fileId: `gold-${input.goldCase.id}-${index}`,
        }))
      )
    : findingRecall;

  return {
    caseId: input.goldCase.id,
    engine: input.engine,
    correctness,
    safetyPassed: safety.passed,
    safetyFailures: safety.failures,
    quality,
    judgeRationale,
    findingRecall,
    judgeScore,
  };
};

const runGoldJudge = async (input: {
  goldCase: GoldCase;
  outputText: string;
}): Promise<{ score: number; rationale: string }> => {
  const client = getOpenAIClient({ optional: true });
  if (!client) {
    return { score: 0, rationale: 'judge unavailable: OPENAI_API_KEY not configured' };
  }

  const model = resolveGoldJudgeModel();
  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: GOLD_JUDGE_RUBRIC },
        {
          role: 'user',
          content: JSON.stringify({
            rubricVersion: GOLD_JUDGE_RUBRIC_VERSION,
            reference: input.goldCase.reference,
            engineOutput: input.outputText.slice(0, 12000),
          }),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw) as { score?: unknown; rationale?: unknown };
    const scoreInt = typeof parsed.score === 'number' ? parsed.score : Number(parsed.score);
    const clamped = Number.isFinite(scoreInt) ? Math.min(5, Math.max(1, Math.round(scoreInt))) : 1;
    return {
      score: clamped / 5,
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : 'no rationale',
    };
  } catch (error) {
    return {
      score: 0,
      rationale: `judge error: ${error instanceof Error ? error.message : 'unknown'}`,
    };
  }
};

const aggregateScorecard = (
  engine: GoldEngine,
  goldSetVersion: string,
  results: GoldCaseResult[]
): GoldEngineScorecard => {
  const engineResults = results.filter((result) => result.engine === engine);
  const safetyPassed = engineResults.filter((result) => result.safetyPassed).length;
  return {
    engine,
    goldSetVersion,
    caseCount: engineResults.length,
    meanCorrectness: mean(engineResults.map((result) => result.correctness)),
    safetyPassRate: engineResults.length === 0 ? 0 : safetyPassed / engineResults.length,
    meanQuality: mean(engineResults.map((result) => result.quality)),
    failingSafetyCases: engineResults.filter((result) => !result.safetyPassed).map((result) => result.caseId),
  };
};

const evaluateGate = (
  report: Pick<GoldEvalReport, 'baseline' | 'agentic' | 'mode'>,
  margin: number
): { gatePassed: boolean; gateFailures: string[] } => {
  const failures: string[] = [];
  for (const card of [report.baseline, report.agentic]) {
    if (!card) continue;
    if (card.safetyPassRate < 1) {
      failures.push(
        `${card.engine} safetyPassRate=${card.safetyPassRate.toFixed(3)} failing=[${card.failingSafetyCases.join(',')}]`
      );
    }
  }

  if (
    report.mode === 'live' &&
    report.baseline?.meanCorrectness != null &&
    report.agentic?.meanCorrectness != null &&
    report.agentic.meanCorrectness + margin < report.baseline.meanCorrectness
  ) {
    failures.push(
      `agentic correctness ${report.agentic.meanCorrectness.toFixed(3)} trails baseline ${report.baseline.meanCorrectness.toFixed(3)} by more than margin ${margin}`
    );
  }

  return { gatePassed: failures.length === 0, gateFailures: failures };
};

export const runGoldEvalHarness = async (
  options: RunGoldEvalHarnessOptions = {}
): Promise<GoldEvalReport> => {
  const engines = resolveEngines(options.engines);
  const cases = loadGoldCases({
    subset: options.subset,
    goldSetVersion: options.goldSetVersion,
  });
  const goldSetVersion =
    options.goldSetVersion || cases[0]?.labels.goldSetVersion || 'unknown';
  const skipJudge = options.skipJudge === true || options.scoreOnly === true;
  const maxCharsPerFile = options.maxCharsPerFile ?? 20000;
  const maxTotalChars = options.maxTotalChars ?? 80000;
  const margin = options.agenticCorrectnessMargin ?? 0.03;

  const results: GoldCaseResult[] = [];

  for (const goldCase of cases) {
    if (options.scoreOnly) {
      const outputText = flattenGoldReferenceAsOutput(goldCase);
      for (const engine of engines) {
        results.push(
          await scoreGoldCaseAgainstOutput({
            goldCase,
            engine,
            outputText,
            skipJudge: true,
          })
        );
      }
      continue;
    }

    const fixtures = mapGoldCaseToFixtures(goldCase);

    for (const engine of engines) {
      const caseId = `gold-eval-${goldCase.id}`;
      const runId = `gold-run-${engine}-${goldCase.id}-${Date.now()}`;

      if (engine === 'baseline') {
        const state = await runCaseAnalysis({
          caseId,
          runId,
          maxCharsPerFile,
          maxTotalChars,
          executionMode: 'baseline',
          fixtures,
          persist: false,
        });
        const artifact = state.analysis?.artifact || null;
        const outputText = artifactToOutputText(artifact, state.analysis?.summary);
        results.push(
          await scoreGoldCaseAgainstOutput({
            goldCase,
            engine,
            outputText,
            artifact,
            skipJudge,
          })
        );
      } else {
        const agentic = await runAgenticCaseAnalysis({
          caseId,
          runId,
          mode: 'agentic',
          maxCharsPerFile,
          maxTotalChars,
          fixtures,
          persist: false,
        });
        const artifact = agentic.artifact?.artifact || agentic.analysis?.artifact || null;
        const outputText = artifactToOutputText(artifact, agentic.artifact?.summary || agentic.analysis?.summary);
        results.push(
          await scoreGoldCaseAgainstOutput({
            goldCase,
            engine,
            outputText,
            artifact,
            skipJudge,
          })
        );
      }
    }
  }

  const baseline = engines.includes('baseline')
    ? aggregateScorecard('baseline', goldSetVersion, results)
    : null;
  const agentic = engines.includes('agentic')
    ? aggregateScorecard('agentic', goldSetVersion, results)
    : null;

  const partial = {
    baseline,
    agentic,
    mode: options.scoreOnly ? ('score-only' as const) : ('live' as const),
  };
  const gate = evaluateGate(partial, margin);

  return {
    generatedAt: new Date().toISOString(),
    goldSetVersion,
    judgeModel: resolveGoldJudgeModel(),
    judgeRubricVersion: GOLD_JUDGE_RUBRIC_VERSION,
    mode: partial.mode,
    baseline,
    agentic,
    results,
    gatePassed: gate.gatePassed,
    gateFailures: gate.gateFailures,
  };
};
