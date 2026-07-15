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
  /** Age at case submission when available from intake. */
  patientAge?: number | null;
  /** Sex from intake when available. */
  patientSex?: string | null;
  /** True for preview PDFs — draws a DRAFT watermark. */
  isDraft?: boolean;
  /** ISO timestamp when the specialist signed/sent the opinion. */
  signedAt?: string | null;
  /** Stable report identifier (defaults to generated uuid for file PDFs). */
  reportId?: string | null;
}

export interface DoctorOpinionPdfFile {
  filePath: string;
  filename: string;
  originalName: string;
  size: number;
  reportId: string;
}

const BRAND_COLOR = '#223B6C';
const CREAM_COLOR = '#FAF9F6';
const BODY_COLOR = '#1F2937';
const MUTED_COLOR = '#6B7280';
const RULE_COLOR = '#223B6C';
const PAGE_MARGIN = 50;
const FOOTER_RESERVED = 72;
const CONTENT_WIDTH = (doc: PDFKit.PDFDocument) => doc.page.width - PAGE_MARGIN * 2;

const resolveUploadDir = (): string => {
  const configured = process.env.UPLOAD_DIR || './uploads';
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
};

const resolveLogoPath = (): string | null => {
  const candidates = [
    path.resolve(process.cwd(), 'assets/secondop-logo.png'),
    path.resolve(__dirname, '../../assets/secondop-logo.png'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (_error) {
      // ignore
    }
  }
  return null;
};

const formatDisplayDate = (value?: string | Date | null): string => {
  if (!value) {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const formatDisplayDateTime = (value?: string | Date | null): string => {
  if (!value) {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return `${date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  })} (UTC)`;
};

const space = (doc: PDFKit.PDFDocument, pts = 10): void => {
  doc.y += pts;
};

const ensureSpace = (doc: PDFKit.PDFDocument, requiredHeight: number): void => {
  const bottom = doc.page.height - PAGE_MARGIN - FOOTER_RESERVED;
  if (doc.y + requiredHeight > bottom) {
    doc.addPage();
  }
};

const drawHairline = (doc: PDFKit.PDFDocument, opacity = 0.15): void => {
  const y = doc.y;
  doc.save();
  doc.strokeColor(RULE_COLOR).opacity(opacity).lineWidth(1);
  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(doc.page.width - PAGE_MARGIN, y)
    .stroke();
  doc.restore();
  space(doc, 8);
};

const drawSectionHeader = (doc: PDFKit.PDFDocument, title: string): void => {
  ensureSpace(doc, 36);
  space(doc, 6);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(BRAND_COLOR).text(title, {
    width: CONTENT_WIDTH(doc),
  });
  space(doc, 4);
  drawHairline(doc, 0.2);
};

const drawBodyText = (
  doc: PDFKit.PDFDocument,
  text: string,
  options: { x?: number; width?: number; indent?: number } = {}
): void => {
  const x = options.x ?? PAGE_MARGIN;
  const width = options.width ?? CONTENT_WIDTH(doc) - (options.indent ?? 0);
  const startX = x + (options.indent ?? 0);
  doc.font('Helvetica').fontSize(10.5).fillColor(BODY_COLOR);
  doc.text(text, startX, doc.y, {
    width,
    align: 'left',
    lineGap: 3,
  });
};

const drawLetterhead = (
  doc: PDFKit.PDFDocument,
  input: DoctorOpinionPdfInput,
  reportId: string,
  reportDate: string
): void => {
  const logoPath = resolveLogoPath();
  const metaX = PAGE_MARGIN + CONTENT_WIDTH(doc) * 0.55;
  const metaWidth = CONTENT_WIDTH(doc) * 0.45;
  const topY = PAGE_MARGIN;

  if (logoPath) {
    try {
      doc.image(logoPath, PAGE_MARGIN, topY, { width: 28, height: 28 });
    } catch (_error) {
      doc.roundedRect(PAGE_MARGIN, topY, 28, 28, 6).fill(BRAND_COLOR);
    }
  } else {
    doc.roundedRect(PAGE_MARGIN, topY, 28, 28, 6).fill(BRAND_COLOR);
  }

  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor(BRAND_COLOR)
    .text('SecondOp', PAGE_MARGIN + 36, topY + 5, { width: 200, lineBreak: false });

  doc.font('Helvetica').fontSize(8).fillColor(MUTED_COLOR);
  const metaLines = [
    `Report ID: ${reportId}`,
    `Report date: ${reportDate}`,
    `Case ref: ${input.caseNumber}`,
  ];
  let metaY = topY;
  for (const line of metaLines) {
    doc.text(line, metaX, metaY, { width: metaWidth, align: 'right' });
    metaY = doc.y + 2;
  }

  doc.y = Math.max(topY + 36, metaY) + 6;
  doc
    .strokeColor(BRAND_COLOR)
    .lineWidth(1.5)
    .moveTo(PAGE_MARGIN, doc.y)
    .lineTo(doc.page.width - PAGE_MARGIN, doc.y)
    .stroke();
  space(doc, 14);

  doc
    .font('Helvetica-Bold')
    .fontSize(20)
    .fillColor(BODY_COLOR)
    .text('Independent Second Opinion', PAGE_MARGIN, doc.y, {
      width: CONTENT_WIDTH(doc),
      align: 'left',
    });
  space(doc, 14);
};

const drawInfoGrid = (doc: PDFKit.PDFDocument, input: DoctorOpinionPdfInput): void => {
  ensureSpace(doc, 90);
  const colGap = 24;
  const colWidth = (CONTENT_WIDTH(doc) - colGap) / 2;
  const leftX = PAGE_MARGIN;
  const rightX = PAGE_MARGIN + colWidth + colGap;
  const startY = doc.y;

  const drawLabeled = (x: number, y: number, label: string, value: string): number => {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED_COLOR).text(label.toUpperCase(), x, y, {
      width: colWidth,
      characterSpacing: 0.4,
    });
    const afterLabel = doc.y + 2;
    doc.font('Helvetica').fontSize(10.5).fillColor(BODY_COLOR).text(value || '—', x, afterLabel, {
      width: colWidth,
      lineGap: 2,
    });
    return doc.y + 8;
  };

  const ageSexParts: string[] = [];
  if (input.patientAge != null && !Number.isNaN(Number(input.patientAge))) {
    ageSexParts.push(`${input.patientAge} years`);
  }
  if (input.patientSex?.trim()) {
    ageSexParts.push(input.patientSex.trim());
  }
  const patientLine = ageSexParts.length
    ? `${input.patientName} (${ageSexParts.join(', ')})`
    : input.patientName;

  let leftY = startY;
  leftY = drawLabeled(leftX, leftY, 'Patient', patientLine);
  leftY = drawLabeled(leftX, leftY, 'Case reference', input.caseNumber);
  leftY = drawLabeled(leftX, leftY, 'Case title', input.caseTitle);

  let rightY = startY;
  rightY = drawLabeled(
    rightX,
    rightY,
    'Reviewing specialist',
    input.doctorSpecialty ? `${input.doctorName} — ${input.doctorSpecialty}` : input.doctorName
  );
  rightY = drawLabeled(
    rightX,
    rightY,
    'License / registration',
    input.doctorLicenseNumber?.trim() || '—'
  );
  rightY = drawLabeled(rightX, rightY, 'Case submitted', formatDisplayDate(input.submittedDate));
  rightY = drawLabeled(rightX, rightY, 'Report date', formatDisplayDate(new Date()));

  doc.y = Math.max(leftY, rightY);
  space(doc, 4);
};

const drawCalloutBox = (doc: PDFKit.PDFDocument, title: string, body: string): void => {
  ensureSpace(doc, 80);
  drawSectionHeader(doc, title);

  const boxX = PAGE_MARGIN;
  const boxWidth = CONTENT_WIDTH(doc);
  const padding = 12;
  const accentWidth = 3;
  const textWidth = boxWidth - padding * 2 - accentWidth;

  const textStartY = doc.y + padding;
  doc.font('Helvetica').fontSize(10.5).fillColor(BODY_COLOR);
  const textHeight = doc.heightOfString(body, { width: textWidth, lineGap: 3 });
  const boxHeight = textHeight + padding * 2;

  ensureSpace(doc, boxHeight + 8);
  const boxY = doc.y;

  doc.save();
  doc.rect(boxX, boxY, boxWidth, boxHeight).fill(CREAM_COLOR);
  doc.rect(boxX, boxY, accentWidth, boxHeight).fill(BRAND_COLOR);
  doc.restore();

  doc.font('Helvetica').fontSize(10.5).fillColor(BODY_COLOR);
  doc.text(body, boxX + accentWidth + padding, textStartY, {
    width: textWidth,
    lineGap: 3,
  });
  doc.y = boxY + boxHeight + 10;
};

const drawQaBlock = (
  doc: PDFKit.PDFDocument,
  index: number,
  item: DoctorOpinionQuestionAnswer
): void => {
  const answerIndent = 16;
  const estimated =
    40 +
    doc.heightOfString(item.question, { width: CONTENT_WIDTH(doc) - 28 }) +
    doc.heightOfString(item.answer, { width: CONTENT_WIDTH(doc) - answerIndent - 8 });
  ensureSpace(doc, Math.min(estimated, 120));

  const chipY = doc.y;
  doc.roundedRect(PAGE_MARGIN, chipY, 18, 14, 3).fill(BRAND_COLOR);
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor('#FFFFFF')
    .text('Q', PAGE_MARGIN, chipY + 3, { width: 18, align: 'center' });

  doc
    .font('Helvetica-Bold')
    .fontSize(10.5)
    .fillColor(BODY_COLOR)
    .text(`${index}. ${item.question}`, PAGE_MARGIN + 24, chipY, {
      width: CONTENT_WIDTH(doc) - 24,
      lineGap: 2,
    });
  space(doc, 6);

  const answerTop = doc.y;
  doc
    .strokeColor(BRAND_COLOR)
    .lineWidth(2)
    .moveTo(PAGE_MARGIN + 4, answerTop)
    .lineTo(PAGE_MARGIN + 4, answerTop + 4)
    .stroke();

  doc.font('Helvetica').fontSize(9).fillColor(MUTED_COLOR).text('Specialist response', PAGE_MARGIN + answerIndent, answerTop, {
    width: CONTENT_WIDTH(doc) - answerIndent,
  });
  space(doc, 2);
  const ruleStart = answerTop;
  drawBodyText(doc, item.answer, { indent: answerIndent, width: CONTENT_WIDTH(doc) - answerIndent });
  const ruleEnd = doc.y;
  doc
    .strokeColor(BRAND_COLOR)
    .opacity(0.35)
    .lineWidth(2)
    .moveTo(PAGE_MARGIN + 4, ruleStart)
    .lineTo(PAGE_MARGIN + 4, ruleEnd)
    .stroke();
  doc.opacity(1);
  space(doc, 12);
};

const drawKeyImages = (doc: PDFKit.PDFDocument, images: DoctorOpinionKeyImage[]): void => {
  drawSectionHeader(doc, 'Key Images');
  const gap = 12;
  const colWidth = (CONTENT_WIDTH(doc) - gap) / 2;

  for (let i = 0; i < images.length; i += 2) {
    ensureSpace(doc, 200);
    const rowY = doc.y;
    let rowHeight = 0;

    for (let col = 0; col < 2; col += 1) {
      const image = images[i + col];
      if (!image) {
        continue;
      }
      const x = PAGE_MARGIN + col * (colWidth + gap);
      const framePad = 6;
      const imgMaxW = colWidth - framePad * 2;
      const imgMaxH = 140;

      try {
        doc.rect(x, rowY, colWidth, imgMaxH + 36).strokeColor('#D1D5DB').lineWidth(0.75).stroke();
        doc.image(image.filePath, x + framePad, rowY + framePad, {
          fit: [imgMaxW, imgMaxH],
          align: 'center',
          valign: 'center',
        });
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(MUTED_COLOR)
          .text(image.label || `Image ${i + col + 1}`, x + framePad, rowY + imgMaxH + framePad + 4, {
            width: imgMaxW,
          });
        rowHeight = Math.max(rowHeight, imgMaxH + 40);
      } catch (_error) {
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor(MUTED_COLOR)
          .text('(Unable to embed image file)', x + framePad, rowY + framePad, {
            width: imgMaxW,
          });
        rowHeight = Math.max(rowHeight, 40);
      }
    }

    doc.y = rowY + rowHeight + 10;
  }
};

const drawSignatureBlock = (doc: PDFKit.PDFDocument, input: DoctorOpinionPdfInput): void => {
  drawSectionHeader(doc, 'Specialist Attestation & Signature');
  ensureSpace(doc, 110);

  const boxY = doc.y;
  const boxHeight = 96;
  doc.rect(PAGE_MARGIN, boxY, CONTENT_WIDTH(doc), boxHeight).fill(CREAM_COLOR);
  doc
    .rect(PAGE_MARGIN, boxY, 3, boxHeight)
    .fill(BRAND_COLOR);

  let y = boxY + 12;
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED_COLOR)
    .text('Electronically signed by', PAGE_MARGIN + 14, y, { width: CONTENT_WIDTH(doc) - 28 });
  y = doc.y + 4;

  const credLine = input.doctorSpecialty
    ? `${input.doctorName} — ${input.doctorSpecialty}`
    : input.doctorName;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(BODY_COLOR).text(credLine, PAGE_MARGIN + 14, y, {
    width: CONTENT_WIDTH(doc) - 28,
  });
  y = doc.y + 4;

  if (input.doctorLicenseNumber?.trim()) {
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(BODY_COLOR)
      .text(`License ${input.doctorLicenseNumber.trim()}`, PAGE_MARGIN + 14, y, {
        width: CONTENT_WIDTH(doc) - 28,
      });
    y = doc.y + 2;
  }

  const signedWhen = input.isDraft
    ? 'Pending signature (draft preview)'
    : `Signed: ${formatDisplayDateTime(input.signedAt || new Date())}`;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED_COLOR).text(signedWhen, PAGE_MARGIN + 14, y, {
    width: CONTENT_WIDTH(doc) - 28,
  });

  doc.y = boxY + boxHeight + 10;

  const attestation = `I, ${input.doctorName}${
    input.doctorSpecialty ? `, ${input.doctorSpecialty}` : ''
  }${
    input.doctorLicenseNumber ? ` (License ${input.doctorLicenseNumber})` : ''
  }, attest that this report reflects my independent clinical judgment based on the records and information available at the time of review.`;
  drawBodyText(doc, attestation);
  space(doc, 8);

  doc
    .strokeColor(MUTED_COLOR)
    .opacity(0.5)
    .lineWidth(0.75)
    .moveTo(PAGE_MARGIN, doc.y)
    .lineTo(PAGE_MARGIN + 180, doc.y)
    .stroke();
  doc.opacity(1);
  space(doc, 4);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED_COLOR).text('Electronic signature', {
    width: 180,
  });
};

const drawDraftWatermark = (doc: PDFKit.PDFDocument): void => {
  const range = doc.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    doc.save();
    doc
      .fillColor('#9CA3AF')
      .opacity(0.12)
      .font('Helvetica-Bold')
      .fontSize(72)
      .rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] })
      .text('DRAFT', doc.page.width / 2 - 140, doc.page.height / 2 - 20, {
        width: 280,
        align: 'center',
        lineBreak: false,
      });
    doc.restore();
  }
};

const drawFooter = (
  doc: PDFKit.PDFDocument,
  input: DoctorOpinionPdfInput,
  reportId: string,
  generatedAt: Date
): void => {
  const disclaimerParts = [
    "This document summarizes the reviewing specialist's independent second opinion based on the information provided. It does not replace in-person medical care or emergency services.",
  ];
  if (input.aiAssistedReview) {
    disclaimerParts.push(
      'An AI-assisted review may have been used to organize case materials. All clinical conclusions in this report are those of the reviewing specialist.'
    );
  }
  const disclaimer = disclaimerParts.join(' ');
  const metaLine = `Report ID: ${reportId} · Generated ${formatDisplayDateTime(generatedAt)} · secondop.in`;

  const range = doc.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    const pageWidth = CONTENT_WIDTH(doc);
    const footerTop = doc.page.height - PAGE_MARGIN - FOOTER_RESERVED + 8;

    doc
      .strokeColor(BRAND_COLOR)
      .opacity(0.2)
      .lineWidth(0.75)
      .moveTo(PAGE_MARGIN, footerTop)
      .lineTo(doc.page.width - PAGE_MARGIN, footerTop)
      .stroke();
    doc.opacity(1);

    let y = footerTop + 6;
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(BRAND_COLOR)
      .text('CONFIDENTIAL — Contains Protected Health Information', PAGE_MARGIN, y, {
        width: pageWidth,
        align: 'left',
      });
    y = doc.y + 2;

    doc.font('Helvetica').fontSize(7).fillColor(MUTED_COLOR).text(disclaimer, PAGE_MARGIN, y, {
      width: pageWidth,
      align: 'left',
      lineGap: 1,
    });
    y = doc.y + 2;

    doc.font('Helvetica').fontSize(7).fillColor(MUTED_COLOR).text(metaLine, PAGE_MARGIN, y, {
      width: pageWidth * 0.7,
      align: 'left',
    });
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(MUTED_COLOR)
      .text(`Page ${pageIndex + 1} of ${range.count}`, PAGE_MARGIN, y, {
        width: pageWidth,
        align: 'right',
      });
  }
};

const renderDoctorOpinionPdf = (
  doc: PDFKit.PDFDocument,
  input: DoctorOpinionPdfInput,
  reportId: string,
  generatedAt: Date
): void => {
  const reportDate = formatDisplayDate(generatedAt);

  drawLetterhead(doc, input, reportId, reportDate);
  drawInfoGrid(doc, input);

  const structuredAnswers = (input.questionAnswers || []).filter(
    (item) => item.question.trim() && item.answer.trim()
  );
  const summary = input.summary?.trim() || '';
  const legacyResponse = input.clinicalResponse?.trim() || '';

  if (summary) {
    drawCalloutBox(doc, 'Clinical Impression / Summary', summary);
  } else if (legacyResponse && structuredAnswers.length === 0) {
    drawCalloutBox(doc, 'Clinical Opinion', legacyResponse);
  }

  if (structuredAnswers.length > 0) {
    drawSectionHeader(doc, 'Patient Questions & Specialist Responses');
    structuredAnswers.forEach((item, index) => {
      drawQaBlock(doc, index + 1, item);
    });
  }

  if (!summary && legacyResponse && structuredAnswers.length > 0) {
    drawCalloutBox(doc, 'Clinical Opinion', legacyResponse);
  }

  const keyImages = (input.keyImages || []).filter((image) => {
    try {
      return Boolean(image.filePath) && fs.existsSync(image.filePath);
    } catch (_error) {
      return false;
    }
  });

  if (keyImages.length > 0) {
    drawKeyImages(doc, keyImages);
  }

  drawSignatureBlock(doc, input);

  if (input.isDraft) {
    drawDraftWatermark(doc);
  }

  drawFooter(doc, input, reportId, generatedAt);
};

const createPdfDocument = (input: DoctorOpinionPdfInput): PDFKit.PDFDocument =>
  new PDFDocument({
    margin: PAGE_MARGIN,
    bufferPages: true,
    // Keep content streams plaintext so reports remain searchable and tests can assert copy.
    compress: false,
    info: {
      Title: `SecondOp Independent Second Opinion — ${input.caseNumber}`,
      Author: 'SecondOp',
      Subject: 'Second opinion report',
      Keywords: 'second opinion, clinical report, SecondOp',
      CreationDate: new Date(),
    },
  });

const pipePdfToBuffer = (input: DoctorOpinionPdfInput, reportId: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const generatedAt = new Date();
    const doc = createPdfDocument(input);
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      renderDoctorOpinionPdf(doc, input, reportId, generatedAt);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });

const pipePdfToFile = (
  input: DoctorOpinionPdfInput,
  filePath: string,
  reportId: string
): Promise<void> =>
  new Promise((resolve, reject) => {
    const generatedAt = new Date();
    const doc = createPdfDocument(input);
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    try {
      renderDoctorOpinionPdf(doc, input, reportId, generatedAt);
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
): Promise<Buffer> => {
  const reportId = input.reportId?.trim() || uuidv4();
  return pipePdfToBuffer(input, reportId);
};

export const generateDoctorOpinionPdf = async (
  input: DoctorOpinionPdfInput
): Promise<DoctorOpinionPdfFile> => {
  const uploadDir = resolveUploadDir();
  fs.mkdirSync(uploadDir, { recursive: true });

  const reportId = input.reportId?.trim() || uuidv4();
  const filename = `${reportId}.pdf`;
  const filePath = path.join(uploadDir, filename);
  const originalName = buildDoctorOpinionOriginalName(input.caseNumber);

  await pipePdfToFile(input, filePath, reportId);

  const stats = fs.statSync(filePath);

  return {
    filePath,
    filename,
    originalName,
    size: stats.size,
    reportId,
  };
};
