import { AgenticCriticScore } from '../agentic/core/types';
import {
  computeEvidenceGroundedness,
  validateCaseAnalysisContract,
} from '../evals/contractChecks';
import { CaseAnalysisArtifact } from './analysisArtifact.service';
import { ExtractedReport } from './reportExtraction.service';
import { SpanHandle } from '../observability/phoenix.service';

export type OnlineEvalSignals = {
  contractPass: boolean | null;
  contractViolations: string[];
  criticScore: number | null;
  criticPassed: boolean | null;
  groundednessPercent: number | null;
  groundednessMatched: number | null;
  groundednessTotal: number | null;
  deidEntityCount: number | null;
};

export const sumDeidEntityCount = (reports: ExtractedReport[]): number =>
  reports.reduce((sum, report) => sum + (report.deidentification?.entityCount ?? 0), 0);

/**
 * Assemble already-computed quality signals for Phoenix attrs + case_analysis_runs.
 * No new LLM calls.
 */
export const computeOnlineEvalSignals = (input: {
  contractArtifact: CaseAnalysisArtifact | null | undefined;
  reports?: ExtractedReport[] | null;
  criticScore?: AgenticCriticScore | null;
}): OnlineEvalSignals => {
  const reports = input.reports || [];
  let contractPass: boolean | null = null;
  let contractViolations: string[] = [];
  let groundednessPercent: number | null = null;
  let groundednessMatched: number | null = null;
  let groundednessTotal: number | null = null;

  if (input.contractArtifact) {
    const contract = validateCaseAnalysisContract(input.contractArtifact, {
      reports: reports.length > 0 ? reports : undefined,
    });
    contractPass = contract.passed;
    contractViolations = contract.violations;

    if (reports.length > 0) {
      const groundedness = computeEvidenceGroundedness(input.contractArtifact, reports);
      groundednessPercent = groundedness.percent;
      groundednessMatched = groundedness.matched;
      groundednessTotal = groundedness.total;
    }
  }

  return {
    contractPass,
    contractViolations,
    criticScore:
      typeof input.criticScore?.score === 'number' && Number.isFinite(input.criticScore.score)
        ? input.criticScore.score
        : null,
    criticPassed: typeof input.criticScore?.passed === 'boolean' ? input.criticScore.passed : null,
    groundednessPercent,
    groundednessMatched,
    groundednessTotal,
    deidEntityCount: reports.length > 0 ? sumDeidEntityCount(reports) : null,
  };
};

/** Attach online-eval attributes to a Phoenix/OTel span (annotator_kind=CODE style keys). */
export const attachOnlineEvalSpanAttributes = (
  span: SpanHandle | null | undefined,
  signals: OnlineEvalSignals
): void => {
  if (!span) {
    return;
  }

  const attrs: Record<string, string | number | boolean> = {
    'eval.annotator_kind': 'CODE',
  };

  if (signals.contractPass !== null) {
    attrs['eval.contract_check.score'] = signals.contractPass ? 1 : 0;
    attrs['eval.contract_check.label'] = signals.contractPass ? 'pass' : 'fail';
  }
  if (signals.contractViolations.length > 0) {
    attrs['eval.contract_check.violations'] = signals.contractViolations.slice(0, 8).join(' | ').slice(0, 500);
    attrs['eval.contract_check.violation_count'] = signals.contractViolations.length;
  }
  if (signals.criticScore !== null) {
    attrs['eval.critic_score.score'] = signals.criticScore;
  }
  if (signals.criticPassed !== null) {
    attrs['eval.critic_score.label'] = signals.criticPassed ? 'pass' : 'fail';
  }
  if (signals.groundednessPercent !== null) {
    attrs['eval.groundedness.score'] = signals.groundednessPercent;
  }
  if (signals.groundednessMatched !== null && signals.groundednessTotal !== null) {
    attrs['eval.groundedness.matched'] = signals.groundednessMatched;
    attrs['eval.groundedness.total'] = signals.groundednessTotal;
  }
  if (signals.deidEntityCount !== null) {
    attrs['eval.deid_entity_count.score'] = signals.deidEntityCount;
  }

  span.addAttributes(attrs);
};
