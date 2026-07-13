import {
  buildTokenizedText,
  deidentifyText,
  filterAnalyzerResults,
  findLeakedPhiValues,
  reidentifyText,
  unsealMapping,
} from '../services/deidentification.service';
import { reidentifyArtifact } from '../services/analysisDeidentification.service';
import { analyzeText } from '../services/presidio.client';
import { MEDICAL_AD_HOC_RECOGNIZERS } from '../services/presidioRecognizers';
import { CaseAnalysisArtifact } from '../services/analysisArtifact.service';
import { buildUserPrompt, CaseIntakeData } from '../services/analysis.service';
import { ExtractedReport } from '../services/reportExtraction.service';

jest.mock('../services/presidio.client', () => {
  const actualCrypto = jest.requireActual('../services/presidio.client');
  return {
    ...actualCrypto,
    analyzeText: jest.fn(),
    anonymizeText: jest.fn(),
    PresidioClientError: class PresidioClientError extends Error {
      statusCode?: number;
      constructor(message: string, statusCode?: number) {
        super(message);
        this.name = 'PresidioClientError';
        this.statusCode = statusCode;
      }
    },
  };
});

const mockedAnalyze = analyzeText as jest.MockedFunction<typeof analyzeText>;

describe('deidentification.service (full spec)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.DEID_ENABLED = 'true';
    process.env.PRESIDIO_MIN_SCORE = '0.5';
    process.env.PRESIDIO_LANGUAGE = 'en';
    process.env.DEID_REVERSIBLE_KEY = 'unit-test-reversible-key';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('passes through unchanged when DEID_ENABLED is false', async () => {
    process.env.DEID_ENABLED = 'false';
    const text = 'Patient Jane Doe DOB 01/02/1980, MRN 12345.';

    const result = await deidentifyText(text);

    expect(result.deidentifiedText).toBe(text);
    expect(result.mapping).toEqual({});
    expect(result.audit.enabled).toBe(false);
    expect(mockedAnalyze).not.toHaveBeenCalled();
  });

  it('tokenizes seeded PHI and restores it via reidentify round-trip', async () => {
    const text = 'Patient Jane Doe, phone 555-123-4567, email jane@example.com presented with cough.';
    mockedAnalyze.mockResolvedValue([
      { start: 8, end: 16, score: 0.95, entity_type: 'PERSON' },
      { start: 24, end: 36, score: 0.9, entity_type: 'PHONE_NUMBER' },
      { start: 44, end: 60, score: 0.92, entity_type: 'EMAIL_ADDRESS' },
    ]);

    const result = await deidentifyText(text);

    expect(findLeakedPhiValues(result.deidentifiedText, ['Jane Doe', '555-123-4567', 'jane@example.com'])).toEqual(
      []
    );
    expect(result.deidentifiedText).toContain('<PERSON_1>');
    expect(result.mapping['<PERSON_1>']).toBe('Jane Doe');
    expect(reidentifyText(result.deidentifiedText, result.mapping)).toBe(text);
    expect(mockedAnalyze).toHaveBeenCalledWith(
      text,
      expect.objectContaining({
        adHocRecognizers: MEDICAL_AD_HOC_RECOGNIZERS,
      })
    );
  });

  it('tokenizes custom medical identifiers (MRN / insurance / accession)', async () => {
    const text =
      'MRN: AB12-3456 Insurance Member ID: POL998877 Accession Number: ACC-2024-7788 stable findings.';
    const mrnStart = text.indexOf('AB12-3456');
    const insuranceStart = text.indexOf('POL998877');
    const accessionStart = text.indexOf('ACC-2024-7788');
    mockedAnalyze.mockResolvedValue([
      { start: mrnStart, end: mrnStart + 'AB12-3456'.length, score: 0.8, entity_type: 'MRN' },
      {
        start: insuranceStart,
        end: insuranceStart + 'POL998877'.length,
        score: 0.75,
        entity_type: 'INSURANCE_ID',
      },
      {
        start: accessionStart,
        end: accessionStart + 'ACC-2024-7788'.length,
        score: 0.7,
        entity_type: 'ACCESSION_NUMBER',
      },
    ]);

    const result = await deidentifyText(text);

    expect(findLeakedPhiValues(result.deidentifiedText, ['AB12-3456', 'POL998877', 'ACC-2024-7788'])).toEqual([]);
    expect(result.audit.entities.map((e) => e.entityType).sort()).toEqual([
      'ACCESSION_NUMBER',
      'INSURANCE_ID',
      'MRN',
    ]);
    expect(reidentifyText(result.deidentifiedText, result.mapping)).toContain('AB12-3456');
  });

  it('filters clinical deny-list spans and low-confidence detections', () => {
    const text = 'Patient takes Metformin daily.';
    const filtered = filterAnalyzerResults(
      text,
      [
        { start: 14, end: 23, score: 0.8, entity_type: 'PERSON' },
        { start: 0, end: 7, score: 0.2, entity_type: 'PERSON' },
      ],
      0.5
    );

    expect(filtered).toEqual([]);
  });

  it('fails closed when DEID_ENABLED without DEID_REVERSIBLE_KEY', async () => {
    delete process.env.DEID_REVERSIBLE_KEY;

    await expect(deidentifyText('Patient Jane Doe presented with chest pain.')).rejects.toThrow(
      /DEID_REVERSIBLE_KEY/
    );
    expect(mockedAnalyze).not.toHaveBeenCalled();
  });

  it('fails closed when Presidio is unavailable', async () => {
    const { PresidioClientError } = jest.requireMock('../services/presidio.client');
    mockedAnalyze.mockRejectedValue(new PresidioClientError('connect ECONNREFUSED'));

    await expect(deidentifyText('Patient Jane Doe presented with chest pain.')).rejects.toThrow(
      /De-identification unavailable/
    );
  });

  it('seals and unseals mapping when DEID_REVERSIBLE_KEY is set', async () => {
    process.env.DEID_REVERSIBLE_KEY = 'unit-test-reversible-key';
    const text = 'Patient Jane Doe presented.';
    mockedAnalyze.mockResolvedValue([{ start: 8, end: 16, score: 0.95, entity_type: 'PERSON' }]);

    const result = await deidentifyText(text);

    expect(result.sealedMapping).toBeTruthy();
    expect(unsealMapping(result.sealedMapping as string)).toEqual(result.mapping);
  });

  it('buildTokenizedText is stable for repeated values', () => {
    const text = 'Jane Doe saw Jane Doe again.';
    const { text: tokenized, mapping } = buildTokenizedText(text, [
      { start: 0, end: 8, score: 0.9, entity_type: 'PERSON' },
      { start: 13, end: 21, score: 0.9, entity_type: 'PERSON' },
    ]);

    expect(tokenized).toBe('<PERSON_1> saw <PERSON_1> again.');
    expect(Object.keys(mapping)).toHaveLength(1);
    expect(reidentifyText(tokenized, mapping)).toBe(text);
  });

  it('resolves overlapping analyzer spans without corrupting text', () => {
    const text = 'email jane.doe@example.com today';
    const emailStart = text.indexOf('jane.doe@example.com');
    const filtered = filterAnalyzerResults(
      text,
      [
        {
          start: emailStart,
          end: emailStart + 'jane.doe@example.com'.length,
          score: 1,
          entity_type: 'EMAIL_ADDRESS',
        },
        {
          start: emailStart,
          end: emailStart + 'jane.doe'.length,
          score: 0.5,
          entity_type: 'URL',
        },
      ],
      0.4
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0].entity_type).toBe('EMAIL_ADDRESS');
    const { text: tokenized, mapping } = buildTokenizedText(text, filtered);
    expect(tokenized).toBe('email <EMAIL_ADDRESS_1> today');
    expect(reidentifyText(tokenized, mapping)).toBe(text);
  });
});

describe('clinician reidentify + prompt PHI leak', () => {
  it('restores clinician artifact values while model-bound prompt stays tokenized', () => {
    const mapping = {
      '<PERSON_1>': 'Jane Doe',
      '<DATE_TIME_1>': '01/02/1980',
    };
    const artifact: CaseAnalysisArtifact = {
      structured_summary: {
        chief_concern: 'Follow-up for <PERSON_1>',
        key_report_findings: 'DOB <DATE_TIME_1> noted in chart',
        red_flags_to_discuss: 'None',
        follow_up_discussion_points: 'Confirm history with <PERSON_1>',
        limitations_caveats: 'OCR limited',
      },
      questionnaire: {
        specialist_questions: [
          { id: 'q1', question: 'Any prior imaging for <PERSON_1>?' },
          { id: 'q2', question: 'Clarify timeline around <DATE_TIME_1>?' },
          { id: 'q3', question: 'Other meds?' },
        ],
      },
      confidence_score: 0.7,
      uncertainty_flags: ['Name referenced as <PERSON_1>'],
      disclaimer: 'AI-generated support content; licensed clinician review required.',
      evidence_refs: [
        {
          file_name: 'report.pdf',
          section: 'chief_concern',
          snippet: 'Patient <PERSON_1> DOB <DATE_TIME_1>',
        },
      ],
      model: 'test-model',
      token_usage: null,
    };

    const clinician = reidentifyArtifact(artifact, mapping);

    expect(clinician.artifact.structured_summary.chief_concern).toContain('Jane Doe');
    expect(clinician.artifact.evidence_refs[0].snippet).toContain('Jane Doe');
    expect(clinician.topQuestions[0]).toContain('Jane Doe');

    const intake: CaseIntakeData = {
      age: 45,
      sex: 'F',
      specialtyContext: 'cardiology',
      symptoms: 'Chest pain for <PERSON_1>',
      symptomDuration: '2 weeks',
      medicalHistory: 'None',
      currentMedications: 'None',
      allergies: 'NKDA',
    };
    const reports: ExtractedReport[] = [
      {
        fileId: 'f1',
        fileName: 'report.pdf',
        text: 'Patient <PERSON_1> DOB <DATE_TIME_1> with stable chest pain.',
        charCount: 50,
        extractionMethod: 'pdf-parse',
        extractionQuality: 'high',
        ocrConfidence: null,
        reused: false,
      },
    ];

    const prompt = buildUserPrompt(intake, reports);
    expect(findLeakedPhiValues(prompt, ['Jane Doe', '01/02/1980'])).toEqual([]);
    expect(prompt).toContain('<PERSON_1>');
  });
});
