import fs from 'fs';
import path from 'path';
import {
  DOCTOR_OPINION_PDF_LAYOUT,
  generateDoctorOpinionPdfBuffer,
  LAST_NAME_REDACTION,
  redactLastName,
  resolveLogoPath,
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
  it('redactLastName replaces only the final name token', () => {
    expect(redactLastName('Pat Smith')).toBe(`Pat ${LAST_NAME_REDACTION}`);
    expect(redactLastName('Dr. Doc Jones')).toBe(`Dr. Doc ${LAST_NAME_REDACTION}`);
    expect(redactLastName('Madonna')).toBe('Madonna');
    expect(redactLastName('')).toBe('—');
  });

  it('resolves a high-resolution app brand logo asset', () => {
    const logoPath = resolveLogoPath();
    expect(logoPath).toBeTruthy();
    expect(fs.existsSync(logoPath!)).toBe(true);
    // Prefer ≥4× the 28pt draw size so the mark stays sharp in print/PDF zoom.
    const abs = path.resolve(logoPath!);
    expect(abs.endsWith('secondop-logo.png')).toBe(true);
    expect(fs.statSync(abs).size).toBeGreaterThan(1000);
  });

  it('generates a valid PDF with summary-first branded content', async () => {
    const buffer = await generateDoctorOpinionPdfBuffer({
      ...baseInput(),
      isDraft: false,
      signedAt: '2026-07-14T15:42:00.000Z',
      reportId: 'report-final-001',
    });

    expect(buffer.subarray(0, 4).toString('utf8')).toBe('%PDF');
    const text = extractPdfText(buffer);
    expect(text).toContain('SecondOp');
    expect(text).toContain('Clinical Impression');
    expect(text).toContain('CONFIDENTIAL');
    expect(text).toContain('Electronically signed by');
    expect(text).not.toContain('DRAFT');
    expect(text).toContain('Dear Pat,');
    expect(text).not.toContain('Independent Second Opinion');
  });

  it('does not print Report ID / GUID on the PDF', async () => {
    const guid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const buffer = await generateDoctorOpinionPdfBuffer({
      ...baseInput(),
      isDraft: false,
      reportId: guid,
    });

    const text = extractPdfText(buffer);
    expect(text).not.toMatch(/Report ID/i);
    expect(text).not.toContain(guid);
    expect(text).not.toContain('report-final-001');
    expect(text).toContain('Case ref: SO-1001');
    expect(text).toMatch(/Generated /);
  });

  it('redacts patient and doctor last names with a visible marker', async () => {
    const buffer = await generateDoctorOpinionPdfBuffer({
      ...baseInput(),
      isDraft: false,
      reportId: 'report-redact-001',
    });

    const text = extractPdfText(buffer);
    expect(text).toContain(`Pat ${LAST_NAME_REDACTION} (54 years, Female)`);
    expect(text).toContain(`Dr. Doc ${LAST_NAME_REDACTION}`);
    expect(text).not.toContain('Pat Smith');
    expect(text).not.toContain('Doc Jones');
    expect(text).not.toMatch(/Smith/);
    expect(text).not.toMatch(/Jones/);
  });

  it('uses patientFirstName for salutation when provided', async () => {
    const buffer = await generateDoctorOpinionPdfBuffer({
      ...baseInput(),
      patientFirstName: 'Patricia',
      isDraft: false,
      reportId: 'report-salutation-001',
    });

    const text = extractPdfText(buffer);
    expect(text).toContain('Dear Patricia,');
    expect(text).toContain('CONFIDENTIAL');
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

  it('uses signedAt for Report date when present, not generation time', async () => {
    const signedAt = '2026-07-21T12:00:00.000Z';
    const expectedReportDate = new Date(signedAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const buffer = await generateDoctorOpinionPdfBuffer({
      ...baseInput(),
      isDraft: false,
      signedAt,
      reportId: 'report-signed-date-001',
    });

    const text = extractPdfText(buffer);
    expect(text).toContain(`Report date: ${expectedReportDate}`);
    expect(text).toContain(expectedReportDate);
    expect(text).toMatch(/Generated /);
  });

  it('falls back to generation date for unsigned draft Report date', async () => {
    const before = Date.now();
    const buffer = await generateDoctorOpinionPdfBuffer({
      ...baseInput(),
      isDraft: true,
      signedAt: null,
      reportId: 'report-draft-date-001',
    });
    const after = Date.now();

    const text = extractPdfText(buffer);
    expect(text).toContain('DRAFT');

    const possibleDates = new Set<string>();
    for (let t = before; t <= after; t += 60_000) {
      possibleDates.add(
        new Date(t).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      );
    }
    possibleDates.add(
      new Date(before).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    );
    possibleDates.add(
      new Date(after).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    );

    const matched = [...possibleDates].some((date) => text.includes(`Report date: ${date}`));
    expect(matched).toBe(true);
  });

  it('reserves a bottom margin large enough for the footer band', () => {
    expect(DOCTOR_OPINION_PDF_LAYOUT.bottomMargin).toBe(
      DOCTOR_OPINION_PDF_LAYOUT.pageMargin + DOCTOR_OPINION_PDF_LAYOUT.footerReserved
    );
    expect(DOCTOR_OPINION_PDF_LAYOUT.footerReserved).toBeGreaterThanOrEqual(100);
  });

  it('paginates long clinical content instead of colliding with the footer', async () => {
    const paragraph =
      'The reviewing specialist carefully considered history, exam findings, labs, and imaging. ';
    const longAnswer = paragraph.repeat(60);
    const buffer = await generateDoctorOpinionPdfBuffer({
      ...baseInput(),
      summary: paragraph.repeat(25),
      questionAnswers: Array.from({ length: 6 }, (_, index) => ({
        questionId: `sq-${index + 1}`,
        question: `What is the recommended next step for item ${index + 1}?`,
        answer: longAnswer,
      })),
      aiAssistedReview: true,
      isDraft: false,
      reportId: 'report-footer-pagination-001',
    });

    const text = extractPdfText(buffer);
    expect(text).toContain('CONFIDENTIAL');
    expect(text).toContain('Generated ');
    const pageMatch = text.match(/Page 1 of (\d+)/);
    expect(pageMatch).toBeTruthy();
    expect(Number(pageMatch![1])).toBeGreaterThan(1);
    // Footer markers must remain present on a multi-page report.
    expect(text).toMatch(/Page \d+ of \d+/);
  });
});
