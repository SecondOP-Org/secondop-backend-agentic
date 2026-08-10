import type { RecordsProvider, RecordsProviderResult } from './recordsProvider';

/**
 * Deterministic Synthea-shaped mock for demos/sandboxes.
 * No network calls; no PHI. Replace with Metriport provider behind the same interface.
 */
export const syntheaMockProvider: RecordsProvider = {
  name: 'synthea_mock',

  async fetchForCase(): Promise<RecordsProviderResult> {
    return {
      documentCount: 3,
      medications: 2,
      conditions: 1,
      labs: 4,
      summaryLines: [
        'Connected records (sandbox): 2 medications, 1 condition, 4 lab observations.',
        'Source: Synthea mock provider — replace with Metriport without changing API contract.',
        'This summary is attached for intake/demo; upload PDFs for full AI report analysis.',
      ],
    };
  },
};
