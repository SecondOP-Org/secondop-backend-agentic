import {
  isNavOrOcrJunkSnippet,
  isProseLikeEvidenceSnippet,
  sanitizeEvidenceSnippetForCitation,
  sanitizeExtractedReportText,
} from '../services/extractedReportSanitize.service';
import {
  buildCaseAnalysisArtifact,
  findBestEffortEvidenceSnippet,
  findGroundedEvidenceSnippet,
} from '../services/analysisArtifact.service';
import { computeEvidenceGroundedness, validateCaseAnalysisContract } from '../evals/contractChecks';

describe('extracted report sanitize (SEC-145)', () => {
  const junk =
    'Your Health 24 Out of Range 24 Biomarkers Filter (1) 85 In Range 0 Improving… · Function_Bi…';

  const clinical =
    'MRI of the brain demonstrates a 12 mm enhancing lesion in the left temporal lobe with surrounding edema.';

  it('flags portal/OCR chrome as junk', () => {
    expect(isNavOrOcrJunkSnippet(junk)).toBe(true);
    expect(isProseLikeEvidenceSnippet(junk)).toBe(false);
  });

  it('flags raw PDF stream operators as junk (SEC-198)', () => {
    const pdfJunk =
      'SecondOp Storage Smoke /Type /Page /Parent 2 0 R /MediaBox stream BT /F1 18 Tf (hello) Tj ET';
    expect(isNavOrOcrJunkSnippet(pdfJunk)).toBe(true);
    expect(isProseLikeEvidenceSnippet(pdfJunk)).toBe(false);
    expect(sanitizeEvidenceSnippetForCitation(pdfJunk)).toBe('');
  });

  it('sanitizes clinical prose for citation', () => {
    expect(sanitizeEvidenceSnippetForCitation(`  ${clinical}  `)).toContain('temporal lobe');
    expect(sanitizeEvidenceSnippetForCitation('hs-CRP 3.2 mg/L')).toBe('hs-CRP 3.2 mg/L');
  });

  it('accepts clinical prose and short lab values', () => {
    expect(isProseLikeEvidenceSnippet(clinical)).toBe(true);
    expect(isProseLikeEvidenceSnippet('Hemoglobin A1c 8.2%')).toBe(true);
    expect(isNavOrOcrJunkSnippet(clinical)).toBe(false);
  });

  it('strips repeated headers and chrome lines from extracted text', () => {
    const raw = [
      'CONFIDENTIAL LAB PORTAL',
      junk,
      clinical,
      'CONFIDENTIAL LAB PORTAL',
      'Patient reports progressive headaches over two weeks.',
      'CONFIDENTIAL LAB PORTAL',
    ].join('\n');

    const cleaned = sanitizeExtractedReportText(raw);
    expect(cleaned).toContain(clinical);
    expect(cleaned).toContain('progressive headaches');
    expect(cleaned).not.toContain('Your Health');
    expect(cleaned).not.toContain('CONFIDENTIAL LAB PORTAL');
  });

  it('prefers clinical prose over OCR junk for evidence chips and stays grounded', () => {
    const reports = [
      {
        fileId: 'file-junk',
        fileName: 'portal-export.pdf',
        text: `${junk}\n${clinical}\nFollow-up imaging is recommended in 8 to 12 weeks.`,
        charCount: 200,
        extractionMethod: 'pdf-parse' as const,
        extractionQuality: 'high' as const,
        ocrConfidence: null,
        reused: false,
      },
    ];

    const match = findGroundedEvidenceSnippet(
      'enhancing lesion in the left temporal lobe with surrounding edema',
      reports
    );
    expect(match).not.toBeNull();
    expect(match?.snippet.toLowerCase()).toContain('temporal');
    expect(match?.snippet.toLowerCase()).not.toContain('biomarkers');

    const bestEffort = findBestEffortEvidenceSnippet('Key imaging finding for specialist review', reports);
    expect(bestEffort).not.toBeNull();
    expect(isNavOrOcrJunkSnippet(bestEffort!.snippet)).toBe(false);

    const artifact = buildCaseAnalysisArtifact({
      structuredSummary: {
        chief_concern: 'Progressive headaches with concerning MRI lesion',
        key_report_findings: 'Enhancing left temporal lesion with edema',
        red_flags_to_discuss: 'Mass effect and need for urgent specialist review',
        follow_up_discussion_points: 'Timing of follow-up imaging',
        limitations_caveats: 'Single imaging study without prior comparison',
      },
      specialistQuestions: [
        'Does this lesion require urgent neurosurgical referral?',
        'What follow-up imaging interval is appropriate?',
        'Are there red-flag symptoms the patient should watch for?',
      ],
      confidenceScore: 0.62,
      uncertaintyFlags: ['Single imaging study without prior comparison'],
      reports,
      model: 'gpt-4.1-mini',
    });

    const keyFinding = artifact.evidence_refs.find((ref) => ref.section === 'key_report_findings');
    expect(keyFinding).toBeDefined();
    expect(isProseLikeEvidenceSnippet(keyFinding!.snippet) || !isNavOrOcrJunkSnippet(keyFinding!.snippet)).toBe(
      true
    );
    expect(keyFinding!.snippet.toLowerCase()).not.toContain('biomarkers filter');

    const groundedness = computeEvidenceGroundedness(artifact, reports);
    expect(groundedness.matched).toBe(groundedness.total);
    expect(validateCaseAnalysisContract(artifact, { reports }).passed).toBe(true);
  });
});
