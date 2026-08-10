/**
 * Provider-agnostic records fetch contract.
 * Swap Synthea → Metriport by implementing this interface; HTTP §5 stays fixed.
 */

export type RecordsProviderResult = {
  documentCount: number;
  medications: number;
  conditions: number;
  labs: number;
  /** Safe, non-PHI summary lines for a synthetic intake document (no raw identifiers). */
  summaryLines: string[];
};

export interface RecordsProvider {
  readonly name: string;
  /**
   * Fetch/normalize records for a verified connection.
   * Must not log PHI. Return aggregate counts + de-identified summary lines only.
   */
  fetchForCase(input: { caseId: string; connectionId: string }): Promise<RecordsProviderResult>;
}
