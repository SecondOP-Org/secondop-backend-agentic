import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { v4 as uuidv4 } from 'uuid';

export interface DoctorOpinionQuestionAnswer {
  questionId: string;
  question: string;
  answer: string;
}

export interface DoctorOpinionKeyImage {
  filePath: string;
  label: string;
}

export interface DoctorOpinionPdfInput {
  caseTitle: string;
  caseNumber: string;
  patientName: string;
  doctorName: string;
  doctorSpecialty: string;
  doctorLicenseNumber?: string | null;
  submittedDate?: string | null;
  clinicalResponse?: string;
  questionAnswers?: DoctorOpinionQuestionAnswer[];
  summary?: string;
  aiAssistedReview?: boolean;
  keyImages?: DoctorOpinionKeyImage[];
}

export interface DoctorOpinionPdfFile {
  filePath: string;
  filename: string;
  originalName: string;
  size: number;
}

const BRAND_COLOR = '#0F766E';
const BODY_COLOR = '#1F2937';
const MUTED_COLOR = '#6B7280';
const PAGE_MARGIN = 50;
const FOOTER_Y_OFFSET = 40;

const resolveUploadDir = (): string => {
  const configured = process.env.UPLOAD_DIR || './uploads';
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
};

const wrapText = (text: string, maxChars = 90): string[] => {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) {
      if (current) {
        lines.push(current);
      }
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
};

const ensureSpace = (doc: PDFKit.PDFDocument, requiredHeight: number): void => {
  const bottom = doc.page.height - PAGE_MARGIN - FOOTER_Y_OFFSET;
  if (doc.y + requiredHeight > bottom) {
    doc.addPage();
  }
};

const drawSectionHeader = (doc: PDFKit.PDFDocument, title: string): void => {
  ensureSpace(doc, 36);
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(BRAND_COLOR).text(title);
  doc.moveDown(0.25);
  doc
    .strokeColor(BRAND_COLOR)
    .lineWidth(1)
    .moveTo(PAGE_MARGIN, doc.y)
    .lineTo(doc.page.width - PAGE_MARGIN, doc.y)
    .stroke();
  doc.moveDown(0.5);
};

const drawBodyParagraph = (doc: PDFKit.PDFDocument, text: string): void => {
  doc.font('Helvetica').fontSize(11).fillColor(BODY_COLOR);
  for (const line of wrapText(text)) {
    ensureSpace(doc, 16);
    doc.text(line);
  }
};

const drawFooterDisclaimer = (doc: PDFKit.PDFDocument, aiAssistedReview: boolean): void => {
  const disclaimerParts = [
    'This document summarizes the reviewing specialist\'s independent second opinion based on the information provided. It does not replace in-person medical care or emergency services.',
  ];

  if (aiAssistedReview) {
    disclaimerParts.push(
      'An AI-assisted review may have been used to organize case materials. All clinical conclusions in this report are those of the reviewing specialist.'
    );
  }

  const disclaimer = disclaimerParts.join(' ');

  const range = doc.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    const footerY = doc.page.height - FOOTER_Y_OFFSET;

    doc.font('Helvetica').fontSize(9).fillColor(MUTED_COLOR);
    doc.text(disclaimer, PAGE_MARGIN, footerY - 28, {
      width: doc.page.width - PAGE_MARGIN * 2,
      align: 'left',
    });

    doc.text(`Page ${pageIndex + 1} of ${range.count}`, PAGE_MARGIN, footerY, {
      width: doc.page.width - PAGE_MARGIN * 2,
      align: 'center',
    });
  }
};

const renderDoctorOpinionPdf = (
  doc: PDFKit.PDFDocument,
  input: DoctorOpinionPdfInput
): void => {
  const reportDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  doc.font('Helvetica-Bold').fontSize(14).fillColor(BRAND_COLOR).text('SecondOp', {
    align: 'center',
  });
  doc.moveDown(0.25);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(BODY_COLOR).text('Independent Second Opinion Report', {
    align: 'center',
  });
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(11).fillColor(MUTED_COLOR);
  doc.text(`Reference: ${input.caseNumber}`, { align: 'center' });
  doc.text(`Report date: ${reportDate}`, { align: 'center' });
  if (input.submittedDate) {
    doc.text(`Case submitted: ${new Date(input.submittedDate).toLocaleDateString()}`, {
      align: 'center',
    });
  }
  doc.moveDown(1.25);

  drawSectionHeader(doc, 'Patient & Case Information');
  doc.font('Helvetica').fontSize(11).fillColor(BODY_COLOR);
  doc.text(`Patient: ${input.patientName}`);
  doc.text(`Case: ${input.caseTitle}`);
  if (input.doctorSpecialty) {
    doc.text(`Specialty: ${input.doctorSpecialty}`);
  }
  doc.moveDown(0.75);

  drawSectionHeader(doc, 'Reviewing Specialist');
  doc.font('Helvetica').fontSize(11).fillColor(BODY_COLOR);
  doc.text(
    `${input.doctorName}${input.doctorSpecialty ? ` — ${input.doctorSpecialty}` : ''}`
  );
  if (input.doctorLicenseNumber) {
    doc.text(`License / registration: ${input.doctorLicenseNumber}`);
  }
  doc.moveDown(0.75);

  const structuredAnswers = (input.questionAnswers || []).filter(
    (item) => item.question.trim() && item.answer.trim()
  );
  const summary = input.summary?.trim() || '';
  const legacyResponse = input.clinicalResponse?.trim() || '';

  if (structuredAnswers.length > 0) {
    drawSectionHeader(doc, 'Patient Questions & Specialist Responses');
    structuredAnswers.forEach((item, index) => {
      ensureSpace(doc, 48);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(BODY_COLOR).text(`Question ${index + 1}`);
      doc.font('Helvetica').fontSize(11).fillColor(BODY_COLOR).text(item.question);
      doc.moveDown(0.25);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND_COLOR).text('Specialist Response');
      drawBodyParagraph(doc, item.answer);
      doc.moveDown(0.5);
    });
  }

  if (summary) {
    drawSectionHeader(doc, 'Clinical Summary & Recommendations');
    drawBodyParagraph(doc, summary);
  } else if (legacyResponse) {
    drawSectionHeader(doc, 'Clinical Opinion');
    drawBodyParagraph(doc, legacyResponse);
  }

  const keyImages = (input.keyImages || []).filter((image) => {
    try {
      return Boolean(image.filePath) && fs.existsSync(image.filePath);
    } catch (_error) {
      return false;
    }
  });

  if (keyImages.length > 0) {
    drawSectionHeader(doc, 'Key Images');
    keyImages.forEach((image, index) => {
      ensureSpace(doc, 220);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(BODY_COLOR).text(`Image ${index + 1}`);
      doc.font('Helvetica').fontSize(10).fillColor(MUTED_COLOR).text(image.label);
      doc.moveDown(0.25);
      try {
        const maxWidth = doc.page.width - PAGE_MARGIN * 2;
        doc.image(image.filePath, {
          fit: [maxWidth, 280],
          align: 'center',
        });
      } catch (_error) {
        doc.font('Helvetica').fontSize(10).fillColor(MUTED_COLOR).text('(Unable to embed image file)');
      }
      doc.moveDown(0.75);
    });
  }

  drawSectionHeader(doc, 'Specialist Attestation');
  drawBodyParagraph(
    doc,
    `I, ${input.doctorName}${input.doctorSpecialty ? `, ${input.doctorSpecialty}` : ''}${
      input.doctorLicenseNumber ? ` (License ${input.doctorLicenseNumber})` : ''
    }, attest that this report reflects my independent clinical judgment based on the records and information available at the time of review.`
  );

  drawFooterDisclaimer(doc, Boolean(input.aiAssistedReview));
};

const pipePdfToBuffer = (input: DoctorOpinionPdfInput): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      renderDoctorOpinionPdf(doc, input);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });

const pipePdfToFile = (input: DoctorOpinionPdfInput, filePath: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, bufferPages: true });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    try {
      renderDoctorOpinionPdf(doc, input);
      doc.end();
    } catch (error) {
      reject(error);
      return;
    }

    stream.on('finish', () => resolve());
    stream.on('error', reject);
    doc.on('error', reject);
  });

export const buildDoctorOpinionOriginalName = (caseNumber: string): string =>
  `SecondOp-Opinion-${caseNumber.replace(/[^a-zA-Z0-9-]/g, '')}.pdf`;

export const generateDoctorOpinionPdfBuffer = async (
  input: DoctorOpinionPdfInput
): Promise<Buffer> => pipePdfToBuffer(input);

export const generateDoctorOpinionPdf = async (
  input: DoctorOpinionPdfInput
): Promise<DoctorOpinionPdfFile> => {
  const uploadDir = resolveUploadDir();
  fs.mkdirSync(uploadDir, { recursive: true });

  const filename = `${uuidv4()}.pdf`;
  const filePath = path.join(uploadDir, filename);
  const originalName = buildDoctorOpinionOriginalName(input.caseNumber);

  await pipePdfToFile(input, filePath);

  const stats = fs.statSync(filePath);

  return {
    filePath,
    filename,
    originalName,
    size: stats.size,
  };
};
