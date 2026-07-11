import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { v4 as uuidv4 } from 'uuid';

interface DoctorOpinionPdfInput {
  caseTitle: string;
  caseNumber: string;
  patientName: string;
  doctorName: string;
  doctorSpecialty: string;
  clinicalResponse: string;
  submittedDate?: string | null;
}

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

export const generateDoctorOpinionPdf = async (
  input: DoctorOpinionPdfInput
): Promise<{ filePath: string; filename: string; originalName: string; size: number }> => {
  const uploadDir = resolveUploadDir();
  fs.mkdirSync(uploadDir, { recursive: true });

  const filename = `${uuidv4()}.pdf`;
  const filePath = path.join(uploadDir, filename);
  const originalName = `SecondOp-Opinion-${input.caseNumber.replace(/[^a-zA-Z0-9-]/g, '')}.pdf`;

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    doc.fontSize(20).text('Second Opinion Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(11).fillColor('#555555').text(`Case: ${input.caseTitle}`, { align: 'center' });
    doc.text(`Reference: ${input.caseNumber}`, { align: 'center' });
    if (input.submittedDate) {
      doc.text(`Submitted: ${new Date(input.submittedDate).toLocaleDateString()}`, { align: 'center' });
    }
    doc.moveDown(1.5);

    doc.fillColor('#000000').fontSize(12).text('Patient', { underline: true });
    doc.fontSize(11).text(input.patientName);
    doc.moveDown();

    doc.fontSize(12).text('Reviewing Specialist', { underline: true });
    doc.fontSize(11).text(`${input.doctorName}${input.doctorSpecialty ? ` — ${input.doctorSpecialty}` : ''}`);
    doc.moveDown(1.5);

    doc.fontSize(12).text('Clinical Opinion', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11);
    for (const line of wrapText(input.clinicalResponse)) {
      doc.text(line);
    }
    doc.moveDown(2);

    doc.fontSize(9).fillColor('#666666').text(
      'This document summarizes the reviewing specialist\'s independent second opinion based on the information provided. It does not replace in-person medical care or emergency services.',
      { align: 'left' }
    );

    doc.end();

    stream.on('finish', () => resolve());
    stream.on('error', reject);
    doc.on('error', reject);
  });

  const stats = fs.statSync(filePath);

  return {
    filePath,
    filename,
    originalName,
    size: stats.size,
  };
};
