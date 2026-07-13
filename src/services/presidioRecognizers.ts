export interface PresidioAdHocRecognizer {
  name: string;
  supported_language: string;
  supported_entity: string;
  patterns?: Array<{
    name: string;
    regex: string;
    score: number;
  }>;
  context?: string[];
  deny_list?: string[];
}

/**
 * Custom medical-identifier recognizers (Phase 3).
 * Sent as Presidio ad_hoc_recognizers on each /analyze call.
 */
export const MEDICAL_AD_HOC_RECOGNIZERS: PresidioAdHocRecognizer[] = [
  {
    name: 'MRN Recognizer',
    supported_language: 'en',
    supported_entity: 'MRN',
    patterns: [
      {
        name: 'mrn_labeled',
        regex: '\\b(?:MRN|Medical\\s*Record\\s*(?:No\\.?|Number|#)?)[:\\s#-]*([A-Z0-9-]{4,20})\\b',
        score: 0.55,
      },
      {
        name: 'mrn_hash',
        regex: '\\bMRN[:\\s#-]*([A-Z0-9-]{4,20})\\b',
        score: 0.65,
      },
    ],
    context: ['mrn', 'medical', 'record', 'patient'],
  },
  {
    name: 'Insurance ID Recognizer',
    supported_language: 'en',
    supported_entity: 'INSURANCE_ID',
    patterns: [
      {
        name: 'insurance_member',
        regex:
          '\\b(?:Member\\s*(?:ID|No\\.?)|Insurance\\s*(?:ID|No\\.?)|Policy\\s*(?:ID|No\\.?)|Subscriber\\s*ID)[:\\s#-]*([A-Z0-9-]{5,24})\\b',
        score: 0.55,
      },
    ],
    context: ['insurance', 'member', 'policy', 'subscriber'],
  },
  {
    name: 'Accession Number Recognizer',
    supported_language: 'en',
    supported_entity: 'ACCESSION_NUMBER',
    patterns: [
      {
        name: 'accession_labeled',
        regex: '\\b(?:Accession(?:\\s*(?:No\\.?|Number|#))?|Acc\\s*#)[:\\s#-]*([A-Z0-9-]{5,24})\\b',
        score: 0.55,
      },
    ],
    context: ['accession', 'acc', 'lab', 'specimen'],
  },
];
