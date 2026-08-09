/** Shared clinical grounding types (SEC-206). Citations/trials come only from live APIs. */

export interface Citation {
  id: string;
  source: 'pubmed';
  pmid: string;
  title: string;
  journal: string;
  year: number;
  url: string;
  relevanceNote?: string;
}

export interface TrialMatch {
  id: string;
  source: 'clinicaltrials';
  nctId: string;
  title: string;
  phase?: string;
  status: string;
  url: string;
  /** Always "potentially relevant" framing — never eligibility claims. */
  eligibilitySummary?: string;
}

export interface NormalizedMedication {
  raw: string;
  rxcui?: string;
  normalizedName?: string;
  unresolved: boolean;
}

export interface NormalizedCondition {
  raw: string;
  code?: string;
  system?: 'SNOMED' | 'ICD10';
}

export interface NormalizedEntities {
  medications: NormalizedMedication[];
  conditions: NormalizedCondition[];
  /** Condition + key modifiers for PubMed/trials queries (de-identified concepts only). */
  evidenceTerms: string[];
}

export interface CitationLink {
  /** Structured summary section or free-form claim key. */
  section: string;
  citationIds: string[];
}
