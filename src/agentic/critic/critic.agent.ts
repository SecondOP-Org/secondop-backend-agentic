import { AgenticCriticScore, AgenticFinalArtifact, AgenticLoopState } from '../core/types';
import {
  collectUncertaintySignals,
  validateEvidenceGrounding,
  validateLowConfidenceUncertainty,
  validateQuestionContract,
} from '../../evals/contractChecks';

const caveatPattern = /(may|might|possible|uncertain|cannot\s+exclude|limited|caveat)/i;

export class CriticAgent {
  public async evaluate(artifact: AgenticFinalArtifact, state: AgenticLoopState): Promise<AgenticCriticScore> {
    const questionViolations = validateQuestionContract(artifact.questions);
    const hasObservations = artifact.observations.length > 0;
    const hasCaveatLanguage = caveatPattern.test(artifact.summary);
    const evidenceViolations = validateEvidenceGrounding(artifact.artifact, state.reports);
    const lowConfidenceHasUncertaintyFlags = validateLowConfidenceUncertainty(
      artifact.artifact.confidence_score,
      collectUncertaintySignals(artifact.artifact)
    );

    const checks = {
      hasThreeQuestions: artifact.questions.length === 3,
      hasUniqueQuestions: new Set(artifact.questions.map((question) => question.toLowerCase())).size === artifact.questions.length,
      hasObservations,
      hasCaveatLanguage,
      hasEvidenceRefs: (artifact.artifact.evidence_refs || []).length > 0,
      evidenceRefsCoverSummary: !evidenceViolations.some((violation) =>
        violation.includes('cover all populated summary sections')
      ),
      evidenceRefsReferenceKnownReports: !evidenceViolations.some((violation) =>
        violation.includes('map to extracted reports')
      ),
      evidenceSnippetsGroundedInReports: !evidenceViolations.some((violation) =>
        violation.includes('not grounded in extracted report text')
      ),
      lowConfidenceHasUncertaintyFlags,
    };

    const reasons: string[] = [...questionViolations, ...evidenceViolations];
    if (!hasObservations) {
      reasons.push('Observation extraction did not produce items.');
    }
    if (!hasCaveatLanguage) {
      reasons.push('Summary is missing uncertainty/caveat language.');
    }
    if (!lowConfidenceHasUncertaintyFlags) {
      reasons.push('Low-confidence outputs must include explicit uncertainty flags.');
    }

    const passed = reasons.length === 0;
    const needsRefinement = !passed && state.refinementCount < (parseInt(process.env.AGENTIC_MAX_REFINEMENTS || '1', 10) || 1);
    const score = Math.max(0, 100 - reasons.length * 12);

    return {
      passed,
      needsRefinement,
      score,
      reasons,
      checks,
    };
  }
}
