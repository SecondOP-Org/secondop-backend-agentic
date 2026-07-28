import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { v4 as uuidv4 } from 'uuid';
import { toPatientFacingCaseRef } from '../utils/caseNumber';

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
  /** Optional first name for a personal salutation ("Dear Pat,"). */
  patientFirstName?: string | null;
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
/** Vertical band reserved for the per-page footer (rule + PHI + disclaimer + meta). */
const FOOTER_RESERVED = 100;
/** PDFKit bottom margin must include the footer band so body text auto-paginates above it. */
const BOTTOM_MARGIN = PAGE_MARGIN + FOOTER_RESERVED;
const CONTENT_WIDTH = (doc: PDFKit.PDFDocument) => doc.page.width - PAGE_MARGIN * 2;

/** Exported for tests — body content must stay above this inset from the page bottom. */
export const DOCTOR_OPINION_PDF_LAYOUT = {
  pageMargin: PAGE_MARGIN,
  footerReserved: FOOTER_RESERVED,
  bottomMargin: BOTTOM_MARGIN,
} as const;

/** WinAnsi-safe visible redaction marker (PDF Helvetica cannot reliably render █). */
export const LAST_NAME_REDACTION = '[REDACTED]';

/**
 * Redact the last whitespace-separated name token for display.
 * "Pat Smith" → "Pat [REDACTED]"; "Dr. Doc Jones" → "Dr. Doc [REDACTED]".
 * Single-token names are left unchanged (no last name to redact).
 */
export const redactLastName = (fullName: string): string => {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '—';
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return [...parts.slice(0, -1), LAST_NAME_REDACTION].join(' ');
};

const resolveUploadDir = (): string => {
  const configured = process.env.UPLOAD_DIR || './uploads';
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
};

/** High-res app mark (navy square + white shield) — same chrome as UnifiedHeader. */
export const resolveLogoPath = (): string | null => {
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

/** Draw the in-app brand mark when the PNG cannot be embedded. */
const drawAppBrandMarkFallback = (doc: PDFKit.PDFDocument, x: number, y: number, size: number): void => {
  doc.save();
  doc.translate(x, y);
  const scale = size / 64;
  doc.scale(scale);
  doc.roundedRect(0, 0, 64, 64, 14).fill(BRAND_COLOR);
  // Same shield path as public/secondop-favicon.svg / header icon.
  doc
    .path(
      'M32 13.5 16 20.2v12.6c0 10 6.8 19.3 16 22.2 9.2-2.9 16-12.2 16-22.2V20.2L32 13.5Zm0 5.4 10.7 4.5v9.4c0 7.3-4.7 14.7-10.7 17.4-6-2.7-10.7-10.1-10.7-17.4v-9.4L32 18.9Z'
    )
    .fill('#FFFFFF');
  doc.restore();
};

const drawLetterheadBrandMark = (doc: PDFKit.PDFDocument, x: number, y: number, size: number): void => {
  const logoPath = resolveLogoPath();
  if (logoPath) {
    try {
      doc.image(logoPath, x, y, { width: size, height: size });
      return;
    } catch (_error) {
      // fall through to vector mark
    }
  }
  try {
    drawAppBrandMarkFallback(doc, x, y, size);
  } catch (_error) {
    doc.roundedRect(x, y, size, size, 6).fill(BRAND_COLOR);
  }
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
  // Prefer PDFKit's margin-aware maxY so this stays aligned with auto page breaks.
  const bottom = doc.page.maxY();
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
  reportDate: string
): void => {
  const metaX = PAGE_MARGIN + CONTENT_WIDTH(doc) * 0.55;
  const metaWidth = CONTENT_WIDTH(doc) * 0.45;
  const topY = PAGE_MARGIN;

  drawLetterheadBrandMark(doc, PAGE_MARGIN, topY, 28);

  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor(BRAND_COLOR)
    .text('SecondOp', PAGE_MARGIN + 36, topY + 5, { width: 200, lineBreak: false });

  doc.font('Helvetica').fontSize(8).fillColor(MUTED_COLOR);
  // Do not print Report ID / GUID — case ref is the patient-facing identifier.
  const metaLines = [`Report date: ${reportDate}`, `Case ref: ${input.caseNumber}`];
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
};

const drawInfoGrid = (
  doc: PDFKit.PDFDocument,
  input: DoctorOpinionPdfInput,
  reportDate: string
): void => {
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
  rightY = drawLabeled(rightX, rightY, 'Report date', reportDate);

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

  doc.font('Helvetica').fontSize(10.5).fillColor(BODY_COLOR);
  const textHeight = doc.heightOfString(body, { width: textWidth, lineGap: 3 });
  const boxHeight = textHeight + padding * 2;
  const maxBoxHeight = Math.max(80, doc.page.maxY() - doc.y - 8);

  // Very tall impressions: flow as normal body text so PDFKit can paginate above the footer.
  if (boxHeight > maxBoxHeight) {
    drawBodyText(doc, body);
    space(doc, 10);
    return;
  }

  ensureSpace(doc, boxHeight + 8);
  const boxY = doc.y;
  const textStartY = boxY + padding;

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
  doc.font('Helvetica-Bold').fontSize(10.5);
  const questionHeight = doc.heightOfString(`${index}. ${item.question}`, {
    width: CONTENT_WIDTH(doc) - 24,
    lineGap: 2,
  });
  // Reserve room for the question chip + label; the answer itself paginates via bottom margin.
  ensureSpace(doc, Math.min(40 + questionHeight + 36, 160));

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
  const ruleStart = doc.y;
  drawBodyText(doc, item.answer, { indent: answerIndent, width: CONTENT_WIDTH(doc) - answerIndent });
  const ruleEnd = Math.min(doc.y, doc.page.maxY());
  // Only draw the accent rule on the page where the answer started (avoid spanning footers).
  if (ruleEnd > ruleStart) {
    doc
      .strokeColor(BRAND_COLOR)
      .opacity(0.35)
      .lineWidth(2)
      .moveTo(PAGE_MARGIN + 4, ruleStart)
      .lineTo(PAGE_MARGIN + 4, ruleEnd)
      .stroke();
    doc.opacity(1);
  }
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
  const metaLine = `Generated ${formatDisplayDateTime(generatedAt)} · secondop.in`;

  const range = doc.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    const pageWidth = CONTENT_WIDTH(doc);
    // Footer sits inside the reserved bottom margin band (not in the body flow area).
    const footerTop = doc.page.height - BOTTOM_MARGIN + 8;

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

const withRedactedDisplayNames = (input: DoctorOpinionPdfInput): DoctorOpinionPdfInput => ({
  ...input,
  patientName: redactLastName(input.patientName),
  doctorName: redactLastName(input.doctorName),
});

const withCustomerFacingFields = (input: DoctorOpinionPdfInput): DoctorOpinionPdfInput => ({
  ...withRedactedDisplayNames(input),
  caseNumber: toPatientFacingCaseRef(input.caseNumber),
});

const renderDoctorOpinionPdf = (
  doc: PDFKit.PDFDocument,
  input: DoctorOpinionPdfInput,
  generatedAt: Date
): void => {
  // Signed opinions freeze REPORT DATE to signedAt; drafts fall back to generation time.
  // Footer "Generated …" always uses generatedAt for provenance.
  const reportDate = formatDisplayDate(input.signedAt || generatedAt);
  const display = withCustomerFacingFields(input);

  drawLetterhead(doc, display, reportDate);
  drawInfoGrid(doc, display, reportDate);

  const salutationName =
    input.patientFirstName?.trim() ||
    input.patientName?.trim().split(/\s+/)[0] ||
    '';
  if (salutationName && !/^patient$/i.test(salutationName)) {
    ensureSpace(doc, 28);
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor(BODY_COLOR)
      .text(`Dear ${salutationName},`, PAGE_MARGIN, doc.y, {
        width: CONTENT_WIDTH(doc),
      });
    space(doc, 12);
  }

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

  drawSignatureBlock(doc, display);

  if (input.isDraft) {
    drawDraftWatermark(doc);
  }

  drawFooter(doc, display, generatedAt);
};

const createPdfDocument = (input: DoctorOpinionPdfInput): PDFKit.PDFDocument => {
  const caseRef = toPatientFacingCaseRef(input.caseNumber);
  return new PDFDocument({
    // Bottom margin includes the footer band so PDFKit page-breaks body text above it.
    margins: {
      top: PAGE_MARGIN,
      left: PAGE_MARGIN,
      right: PAGE_MARGIN,
      bottom: BOTTOM_MARGIN,
    },
    bufferPages: true,
    // Keep content streams plaintext so reports remain searchable and tests can assert copy.
    compress: false,
    info: {
      Title: `SecondOp Opinion — ${caseRef}`,
      Author: 'SecondOp',
      Subject: 'Second opinion report',
      Keywords: 'second opinion, clinical report, SecondOp',
      CreationDate: new Date(),
    },
  });
};

const pipePdfToBuffer = (input: DoctorOpinionPdfInput): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const generatedAt = new Date();
    const doc = createPdfDocument(input);
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      renderDoctorOpinionPdf(doc, input, generatedAt);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });

const pipePdfToFile = (input: DoctorOpinionPdfInput, filePath: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const generatedAt = new Date();
    const doc = createPdfDocument(input);
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    try {
      renderDoctorOpinionPdf(doc, input, generatedAt);
      doc.end();
    } catch (error) {
      reject(error);
      return;
    }

    stream.on('finish', () => resolve());
    stream.on('error', reject);
    doc.on('error', reject);
  });

export const buildDoctorOpinionOriginalName = (caseNumber: string): string => {
  const caseRef = toPatientFacingCaseRef(caseNumber);
  return `SecondOp-Opinion-${caseRef.replace(/[^a-zA-Z0-9-]/g, '')}.pdf`;
};

export const generateDoctorOpinionPdfBuffer = async (
  input: DoctorOpinionPdfInput
): Promise<Buffer> => pipePdfToBuffer(input);

export const generateDoctorOpinionPdf = async (
  input: DoctorOpinionPdfInput
): Promise<DoctorOpinionPdfFile> => {
  const uploadDir = resolveUploadDir();
  fs.mkdirSync(uploadDir, { recursive: true });

  const reportId = input.reportId?.trim() || uuidv4();
  const filename = `${reportId}.pdf`;
  const filePath = path.join(uploadDir, filename);
  const originalName = buildDoctorOpinionOriginalName(input.caseNumber);

  await pipePdfToFile(input, filePath);

  const stats = fs.statSync(filePath);

  return {
    filePath,
    filename,
    originalName,
    size: stats.size,
    reportId,
  };
};
