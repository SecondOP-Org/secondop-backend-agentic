import {
  generateDoctorOpinionPdfBuffer,
  type DoctorOpinionPdfInput,
} from '../services/doctorOpinionPdf.service';

/** PDFKit emits WinAnsi text as hex `<...>` fragments; join them for assertions. */
const extractPdfText = (buffer: Buffer): string => {
  const raw = buffer.toString('latin1');
  const decoded = [...raw.matchAll(/<([0-9a-fA-F]+)>/g)]
    .map((match) => {
      try {
        return Buffer.from(match[1], 'hex').toString('latin1');
      } catch (_error) {
        return '';
      }
    })
    .join('');
  return `${raw}\n${decoded}`;
};

const baseInput = (): DoctorOpinionPdfInput => ({
  caseTitle: 'Suspected atrial fibrillation',
  caseNumber: 'SO-1001',
  patientName: 'Pat Smith',
  doctorName: 'Dr. Doc Jones',
  doctorSpecialty: 'Cardiology',
  doctorLicenseNumber: 'MD123456',
  submittedDate: '2026-01-01T00:00:00.000Z',
  patientAge: 54,
  patientSex: 'Female',
  questionAnswers: [
    {
      questionId: 'sq-1',
      question: 'What is the most likely diagnosis?',
      answer: 'Paroxysmal atrial fibrillation is most likely based on the available records.',
    },
  ],
  summary: 'Clinical impression: likely paroxysmal AF; recommend rhythm monitoring.',
  aiAssistedReview: true,
});

describe('doctorOpinionPdf.service', () => {
  it('generates a valid PDF with summary-first branded content', async () => {
    const buffer = await generateDoctorOpinionPdfBuffer({
      ...baseInput(),
      isDraft: false,
      signedAt: '2026-07-14T15:42:00.000Z',
      reportId: 'report-final-001',
    });

    expect(buffer.subarray(0, 4).toString('utf8')).toBe('%PDF');
    const text = extractPdfText(buffer);
    expect(text).toContain('Independent Second Opinion');
    expect(text).toContain('Clinical Impression');
    expect(text).toContain('CONFIDENTIAL');
    expect(text).toContain('report-final-001');
    expect(text).toContain('Electronically signed by');
    expect(text).not.toContain('DRAFT');
    expect(text).toContain('Pat Smith (54 years, Female)');
  });

  it('stamps DRAFT on preview PDFs', async () => {
    const buffer = await generateDoctorOpinionPdfBuffer({
      ...baseInput(),
      isDraft: true,
      reportId: 'report-draft-001',
    });

    const text = extractPdfText(buffer);
    expect(text).toContain('DRAFT');
    expect(text).toContain('Pending signature');
  });

  it('supports legacy clinicalResponse without structured Q&A', async () => {
    const buffer = await generateDoctorOpinionPdfBuffer({
      caseTitle: 'Legacy case',
      caseNumber: 'SO-2002',
      patientName: 'Alex Doe',
      doctorName: 'Dr. Lee',
      doctorSpecialty: 'Neurology',
      clinicalResponse: 'Legacy free-text clinical opinion body.',
      isDraft: false,
      reportId: 'report-legacy-001',
    });

    const text = extractPdfText(buffer);
    expect(text).toContain('Clinical Opinion');
    expect(text).toContain('Legacy free-text');
  });
});
