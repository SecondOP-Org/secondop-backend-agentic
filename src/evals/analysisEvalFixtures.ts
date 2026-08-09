import { CaseIntakeData } from '../services/analysis.service';
import { ExtractedReport } from '../services/reportExtraction.service';

/** In-memory intake + reports for eval/gold runs (skip DB + disk load). */
export interface AnalysisEvalFixtures {
  intake: CaseIntakeData;
  reports: ExtractedReport[];
}

export const shouldPersistAnalysisSideEffects = (persist: boolean | undefined): boolean =>
  persist !== false;
