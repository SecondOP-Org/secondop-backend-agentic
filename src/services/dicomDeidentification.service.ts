import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import dcmjs from 'dcmjs';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { encryptPayload, decryptPayload } from './presidio.client';

const { DicomMessage, DicomDict } = dcmjs.data;

const ALGORITHM = 'aes-256-gcm';

/** Tags cleared or replaced (Basic Profile–style subset). Pixel PHI: see IMAGE_DEID_ENABLED / imageRedaction.service. */
const PHI_STRING_TAGS: Array<{ tag: string; name: string; replacement: string }> = [
  { tag: '00100010', name: 'PatientName', replacement: 'ANONYMIZED' },
  { tag: '00100020', name: 'PatientID', replacement: '' },
  { tag: '00100030', name: 'PatientBirthDate', replacement: '' },
  { tag: '00100040', name: 'PatientSex', replacement: '' },
  { tag: '00080050', name: 'AccessionNumber', replacement: '' },
  { tag: '00080080', name: 'InstitutionName', replacement: '' },
  { tag: '00080090', name: 'ReferringPhysicianName', replacement: '' },
  { tag: '00080020', name: 'StudyDate', replacement: '' },
  { tag: '00080021', name: 'SeriesDate', replacement: '' },
  { tag: '00080022', name: 'AcquisitionDate', replacement: '' },
  { tag: '00080023', name: 'ContentDate', replacement: '' },
];

const UID_TAGS: Array<{ tag: string; name: string; scope: 'study' | 'series' | 'sop' }> = [
  { tag: '0020000D', name: 'StudyInstanceUID', scope: 'study' },
  { tag: '0020000E', name: 'SeriesInstanceUID', scope: 'series' },
  { tag: '00080018', name: 'SOPInstanceUID', scope: 'sop' },
];

export interface DicomDeidAuditEntry {
  tag: string;
  name: string;
  action: 'replaced' | 'cleared' | 'uid_remapped';
}

export interface DicomDeidMapping {
  uids: Record<string, string>;
  tags: Record<string, string>;
}

export interface DicomDeidContext {
  caseId: string;
  /** Original UID → remapped UID (shared Study/Series across an ingest). */
  uidMap: Map<string, string>;
}

export interface DicomDeidFileResult {
  mapping: DicomDeidMapping;
  audit: DicomDeidAuditEntry[];
  remappedStudyUid: string | null;
}

export const isDicomDeidEnabled = (): boolean =>
  String(process.env.DICOM_DEID_ENABLED || '').toLowerCase() === 'true';

export const assertDicomDeidReady = (): void => {
  if (!isDicomDeidEnabled()) {
    return;
  }

  if (!process.env.DEID_REVERSIBLE_KEY?.trim()) {
    throw new Error(
      'DICOM_DEID_ENABLED=true requires DEID_REVERSIBLE_KEY so DICOM tag maps can be sealed server-side.'
    );
  }
};

export const createDicomDeidContext = (caseId: string): DicomDeidContext => ({
  caseId,
  uidMap: new Map(),
});

/** DICOM UIDs may only contain digits and dots (ISO 8824). */
export const generateDicomUid = (): string => {
  const hex = uuidv4().replace(/-/g, '');
  return `2.25.${BigInt(`0x${hex}`).toString(10)}`;
};

const readElementValue = (element: { vr?: string; Value?: unknown[] } | undefined): string | null => {
  if (!element || !Array.isArray(element.Value) || element.Value.length === 0) {
    return null;
  }

  const first = element.Value[0];
  if (typeof first === 'string') {
    return first;
  }
  if (first && typeof first === 'object' && 'Alphabetic' in (first as object)) {
    const alphabetic = (first as { Alphabetic?: string }).Alphabetic;
    return typeof alphabetic === 'string' ? alphabetic : null;
  }
  return null;
};

const writeStringElement = (
  dict: Record<string, { vr: string; Value: unknown[] }>,
  tag: string,
  vr: string,
  value: string
): void => {
  if (vr === 'PN') {
    dict[tag] = { vr: 'PN', Value: [{ Alphabetic: value }] };
    return;
  }
  dict[tag] = { vr, Value: [value] };
};

const remapUid = (context: DicomDeidContext, original: string, scope: 'study' | 'series' | 'sop'): string => {
  if (scope === 'sop') {
    // SOP UIDs are always unique per instance.
    const next = generateDicomUid();
    context.uidMap.set(original, next);
    return next;
  }

  const existing = context.uidMap.get(original);
  if (existing) {
    return existing;
  }

  const next = generateDicomUid();
  context.uidMap.set(original, next);
  return next;
};

/**
 * Rewrite a Part-10 DICOM file in place: strip/replace PHI tags and remap UIDs.
 * Pixel data is preserved via dcmjs round-trip of the existing dataset.
 */
export const deidentifyDicomFileInPlace = async (
  filePath: string,
  context: DicomDeidContext
): Promise<DicomDeidFileResult> => {
  assertDicomDeidReady();

  const fileBuffer = await fs.readFile(filePath);
  const arrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength
  );

  let dicomDict: { meta: Record<string, unknown>; dict: Record<string, { vr: string; Value: unknown[] }> };
  try {
    dicomDict = DicomMessage.readFile(arrayBuffer) as typeof dicomDict;
  } catch (error) {
    throw new Error(
      `Unable to parse DICOM for de-identification: ${
        error instanceof Error ? error.message : 'unknown parse error'
      }`
    );
  }

  const mapping: DicomDeidMapping = { uids: {}, tags: {} };
  const audit: DicomDeidAuditEntry[] = [];
  const dict = dicomDict.dict;

  for (const { tag, name, replacement } of PHI_STRING_TAGS) {
    const element = dict[tag];
    if (!element) {
      continue;
    }

    const original = readElementValue(element);
    if (original === null) {
      continue;
    }

    mapping.tags[name] = original;
    writeStringElement(dict, tag, element.vr || 'LO', replacement);
    audit.push({
      tag,
      name,
      action: replacement === '' ? 'cleared' : 'replaced',
    });
  }

  let remappedStudyUid: string | null = null;

  for (const { tag, name, scope } of UID_TAGS) {
    const element = dict[tag];
    if (!element) {
      continue;
    }

    const original = readElementValue(element);
    if (!original) {
      continue;
    }

    const remapped = remapUid(context, original, scope);
    mapping.uids[original] = remapped;
    writeStringElement(dict, tag, 'UI', remapped);
    audit.push({ tag, name, action: 'uid_remapped' });

    if (scope === 'study') {
      remappedStudyUid = remapped;
    }

    if (scope === 'sop' && dicomDict.meta && typeof dicomDict.meta === 'object') {
      const meta = dicomDict.meta as Record<string, { vr?: string; Value?: unknown[] }>;
      if (meta['00020003']) {
        meta['00020003'] = { vr: 'UI', Value: [remapped] };
      }
    }
  }

  const outDict = new DicomDict(dicomDict.meta || {});
  outDict.dict = dict;
  const written = Buffer.from(outDict.write());
  await fs.writeFile(filePath, written);

  logger.info('De-identified DICOM headers on ingest', {
    caseId: context.caseId,
    tagCount: audit.length,
    remappedStudyUid,
  });

  return { mapping, audit, remappedStudyUid };
};

export const sealDicomDeidMapping = (mapping: DicomDeidMapping): string => {
  assertDicomDeidReady();
  const secret = process.env.DEID_REVERSIBLE_KEY?.trim();
  if (!secret) {
    throw new Error('DEID_REVERSIBLE_KEY is not configured.');
  }
  return encryptPayload(JSON.stringify(mapping), secret);
};

export const unsealDicomDeidMapping = (sealed: string): DicomDeidMapping => {
  const secret = process.env.DEID_REVERSIBLE_KEY?.trim();
  if (!secret) {
    throw new Error('DEID_REVERSIBLE_KEY is not configured.');
  }
  const parsed = JSON.parse(decryptPayload(sealed, secret)) as DicomDeidMapping;
  return {
    uids: parsed.uids || {},
    tags: parsed.tags || {},
  };
};

export const upsertDicomDeidVault = async (input: {
  fileId: string;
  caseId: string;
  studyInstanceUid: string | null;
  mapping: DicomDeidMapping;
  audit: DicomDeidAuditEntry[];
}): Promise<void> => {
  if (!input.fileId || input.audit.length === 0) {
    return;
  }

  const sealed = sealDicomDeidMapping(input.mapping);

  await query(
    `INSERT INTO dicom_deid_vault (
       file_id, case_id, study_instance_uid, sealed_mapping, algorithm, tag_count, audit_json, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (file_id) DO UPDATE
       SET case_id = EXCLUDED.case_id,
           study_instance_uid = EXCLUDED.study_instance_uid,
           sealed_mapping = EXCLUDED.sealed_mapping,
           algorithm = EXCLUDED.algorithm,
           tag_count = EXCLUDED.tag_count,
           audit_json = EXCLUDED.audit_json,
           created_at = CURRENT_TIMESTAMP`,
    [
      input.fileId,
      input.caseId,
      input.studyInstanceUid,
      sealed,
      ALGORITHM,
      input.audit.length,
      JSON.stringify(input.audit),
    ]
  );

  logger.info('Persisted sealed DICOM de-identification vault entry', {
    fileId: input.fileId,
    caseId: input.caseId,
    tagCount: input.audit.length,
    algorithm: ALGORITHM,
  });
};
