import {
  buildCaseAnalysisArtifact,
  findGroundedEvidenceSnippet,
} from '../services/analysisArtifact.service';

describe('analysis artifact guardrails', () => {
  const reports = [
    {
      fileId: 'file-1',
      fileName: 'labs.pdf',
      text: 'Hemoglobin A1c 8.2%. Patient reports fatigue. Repeat testing recommended in 3 months.',
      charCount: 80,
      extractionMethod: 'pdf-parse' as const,
      reused: false,
    },
  ];

  it('finds grounded snippets from source report text', () => {
    const match = findGroundedEvidenceSnippet('Patient reports fatigue', reports);
    expect(match).not.toBeNull();
    expect(match?.fileName).toBe('labs.pdf');
    expect(match?.snippet.toLowerCase()).toContain('fatigue');
  });

  it('builds evidence refs from grounded source snippets instead of summary text', () => {
    const artifact = buildCaseAnalysisArtifact({
      structuredSummary: {
        chief_concern: 'Elevated glucose with fatigue',
        key_report_findings: 'Hemoglobin A1c 8.2%',
        red_flags_to_discuss: 'Repeat testing recommended',
        follow_up_discussion_points: 'Monitor symptoms closely',
        limitations_caveats: 'Single lab report only',
      },
      specialistQuestions: [
        'What repeat A1c interval is appropriate?',
        'Should additional metabolic labs be ordered now?',
        'What lifestyle changes should be discussed first?',
      ],
      confidenceScore: 0.55,
      uncertaintyFlags: ['Single lab report only'],
      reports,
      model: 'gpt-4.1-mini',
    });

    expect(artifact.evidence_refs.length).toBeGreaterThan(0);
    expect(
      artifact.evidence_refs.every((ref) =>
        reports[0].text.toLowerCase().includes(ref.snippet.toLowerCase().slice(0, 20))
      )
    ).toBe(true);
    expect(artifact.uncertainty_flags).toEqual(['Single lab report only']);
  });
});
