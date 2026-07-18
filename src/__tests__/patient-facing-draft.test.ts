import { detectForbiddenClaims } from '../evals/contractChecks';
import {
  composePatientFacingQuestionTemplate,
  composePatientFacingSummaryTemplate,
  draftAppearsGrounded,
  formatEvidenceFootnote,
  validatePatientFacingDraftText,
} from '../services/patientFacingDraft.service';
import type { StructuredSummary } from '../services/analysisArtifact.service';

const summary = (): StructuredSummary => ({
  chief_concern: 'Intermittent palpitations after exertion',
  key_report_findings:
    'Holter monitor showed short runs of atrial fibrillation; hs-CRP was mildly elevated.',
  red_flags_to_discuss: 'Any chest pain with exertion should be reviewed promptly.',
  follow_up_discussion_points: 'Rhythm monitoring options and lifestyle factors.',
  limitations_caveats: 'Single-timepoint labs; no prior ECG available for comparison.',
});

describe('patientFacingDraft.service', () => {
  it('composes question drafts as second-person prose without field labels', () => {
    const draft = composePatientFacingQuestionTemplate(
      'What do my Holter results mean for my risk?',
      summary(),
      {
        file_name: 'holter.pdf',
        section: 'key_report_findings',
        snippet: 'short runs of atrial fibrillation',
      }
    );

    expect(draft).toMatch(/thank you for asking/i);
    expect(draft).toMatch(/your|you /i);
    expect(draft).not.toMatch(/Chief concern from the submitted records/i);
    expect(draft).not.toMatch(/Red flags to discuss:/i);
    expect(draft).not.toMatch(/Regarding your question:/i);
    expect(draft).not.toMatch(/\[Evidence:/i);
    expect(draft).toMatch(/Source note:/i);
    expect(detectForbiddenClaims(draft)).toEqual([]);
    expect(validatePatientFacingDraftText(draft, draft.toLowerCase()).ok).toBe(true);
  });

  it('composes summary drafts with a consistent patient letter voice', () => {
    const draft = composePatientFacingSummaryTemplate(summary());

    expect(draft).toMatch(/thank you/i);
    expect(draft).toMatch(/plain language|next steps|overall/i);
    expect(draft).not.toMatch(/Chief concern/i);
    expect(draft).not.toMatch(/Red flags to discuss/i);
    expect(detectForbiddenClaims(draft)).toEqual([]);
  });

  it('rejects forbidden claims and labelled dumps', () => {
    const forbidden = validatePatientFacingDraftText(
      'You are diagnosed with atrial fibrillation. Start taking anticoagulation today.',
      'atrial fibrillation anticoagulation'
    );
    expect(forbidden.ok).toBe(false);
    expect(forbidden.violations.some((item) => item.includes('Forbidden claim'))).toBe(true);

    const labelled = validatePatientFacingDraftText(
      'Chief concern from the submitted records: palpitations\nRed flags to discuss: chest pain',
      'palpitations chest pain'
    );
    expect(labelled.ok).toBe(false);
  });

  it('formats evidence as a subtle footnote', () => {
    expect(
      formatEvidenceFootnote({
        file_name: 'labs.pdf',
        section: 'key_report_findings',
        snippet: 'hs-CRP 3.2',
      })
    ).toBe('Source note: labs.pdf — key report findings. "hs-CRP 3.2"');
  });

  it('groundedness accepts paraphrase within source vocabulary', () => {
    const corpus =
      'intermittent palpitations holter atrial fibrillation monitoring lifestyle factors';
    expect(
      draftAppearsGrounded(
        'Your Holter findings showed atrial fibrillation. Monitoring and lifestyle factors are worth discussing.',
        corpus
      )
    ).toBe(true);
    expect(
      draftAppearsGrounded(
        'Your pancreatic neoplasm requires nephrectomy and chemotherapy protocol tomorrow.',
        corpus
      )
    ).toBe(false);
  });
});
