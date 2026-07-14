import fs from 'fs/promises';
import dicomParser from 'dicom-parser';
import { query } from '../database/connection';

export interface DicomAnnotationPoint {
  x: number;
  y: number;
}

export interface DicomAnnotationPayload {
  id: string;
  type: 'distance' | 'area' | 'arrow' | 'text' | 'angle';
  points: DicomAnnotationPoint[];
  text?: string;
  color: string;
  measurement?: number;
  huStats?: {
    mean: number;
    min: number;
    max: number;
  };
  createdByUserId?: string;
  createdByName?: string;
  createdAt?: string;
  updatedByUserId?: string;
  updatedAt?: string;
}

export type AnnotationAuditAction = 'created' | 'updated' | 'deleted';

export interface AnnotationAuditEvent {
  annotationId: string;
  action: AnnotationAuditAction;
  before: DicomAnnotationPayload | null;
  after: DicomAnnotationPayload | null;
}

export interface DicomViewportPayload {
  zoom: number;
  rotation: number;
  brightness: number[];
  contrast: number[];
  windowLevel: number[];
  windowWidth: number[];
  windowPreset: string;
}

export interface PersistedAnnotationRecord {
  fileId: string;
  annotations: DicomAnnotationPayload[];
  viewport: DicomViewportPayload | null;
  sopInstanceUid: string | null;
  updatedAt: string | null;
}

interface ExtractDicomMetadataInput {
  fileId: string;
  caseId: string;
  filePath: string;
}

interface DicomInstanceRow {
  file_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  description: string | null;
  study_instance_uid: string | null;
  series_instance_uid: string | null;
  sop_instance_uid: string | null;
  modality: string | null;
  study_date: string | null;
  series_description: string | null;
  instance_number: number | null;
  body_part_examined: string | null;
  rows: number | null;
  columns: number | null;
  patient_name: string | null;
  patient_id: string | null;
  dicom_metadata: Record<string, unknown>;
  dicom_extraction_status: 'pending' | 'succeeded' | 'failed';
  dicom_extraction_error: string | null;
}

const sanitizePersonName = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  return value
    .split('^')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
    .trim() || null;
};

const normalizeDate = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  const match = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
};

const toOptionalString = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const toOptionalInteger = (value: string | undefined | number): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const extractDicomMetadata = async (filePath: string) => {
  const buffer = await fs.readFile(filePath);
  const dataset = dicomParser.parseDicom(new Uint8Array(buffer));

  const metadata = {
    studyInstanceUid: toOptionalString(dataset.string('x0020000d')),
    seriesInstanceUid: toOptionalString(dataset.string('x0020000e')),
    sopInstanceUid: toOptionalString(dataset.string('x00080018')),
    modality: toOptionalString(dataset.string('x00080060')),
    studyDate: normalizeDate(dataset.string('x00080020')),
    seriesDescription: toOptionalString(dataset.string('x0008103e')),
    studyDescription: toOptionalString(dataset.string('x00081030')),
    instanceNumber: toOptionalInteger(dataset.string('x00200013')),
    bodyPartExamined: toOptionalString(dataset.string('x00180015')),
    rows: toOptionalInteger(dataset.uint16('x00280010')),
    columns: toOptionalInteger(dataset.uint16('x00280011')),
    patientName: sanitizePersonName(dataset.string('x00100010')),
    patientId: toOptionalString(dataset.string('x00100020')),
  };

  return {
    ...metadata,
    raw: {
      study_instance_uid: metadata.studyInstanceUid,
      series_instance_uid: metadata.seriesInstanceUid,
      sop_instance_uid: metadata.sopInstanceUid,
      modality: metadata.modality,
      study_date: metadata.studyDate,
      series_description: metadata.seriesDescription,
      study_description: metadata.studyDescription,
      instance_number: metadata.instanceNumber,
      body_part_examined: metadata.bodyPartExamined,
      rows: metadata.rows,
      columns: metadata.columns,
      patient_name: metadata.patientName,
      patient_id: metadata.patientId,
    },
  };
};

export const extractAndPersistDicomMetadata = async ({
  fileId,
  caseId,
  filePath,
}: ExtractDicomMetadataInput): Promise<void> => {
  try {
    const metadata = await extractDicomMetadata(filePath);

    await query(
      `INSERT INTO dicom_instances (
         file_id,
         case_id,
         study_instance_uid,
         series_instance_uid,
         sop_instance_uid,
         modality,
         study_date,
         series_description,
         instance_number,
         body_part_examined,
         rows,
         columns,
         patient_name,
         patient_id,
         dicom_metadata,
         dicom_extraction_status,
         dicom_extraction_error,
         extracted_at,
         updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, 'succeeded', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       )
       ON CONFLICT (file_id)
       DO UPDATE SET
         case_id = EXCLUDED.case_id,
         study_instance_uid = EXCLUDED.study_instance_uid,
         series_instance_uid = EXCLUDED.series_instance_uid,
         sop_instance_uid = EXCLUDED.sop_instance_uid,
         modality = EXCLUDED.modality,
         study_date = EXCLUDED.study_date,
         series_description = EXCLUDED.series_description,
         instance_number = EXCLUDED.instance_number,
         body_part_examined = EXCLUDED.body_part_examined,
         rows = EXCLUDED.rows,
         columns = EXCLUDED.columns,
         patient_name = EXCLUDED.patient_name,
         patient_id = EXCLUDED.patient_id,
         dicom_metadata = EXCLUDED.dicom_metadata,
         dicom_extraction_status = 'succeeded',
         dicom_extraction_error = NULL,
         extracted_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
      [
        fileId,
        caseId,
        metadata.studyInstanceUid,
        metadata.seriesInstanceUid,
        metadata.sopInstanceUid,
        metadata.modality,
        metadata.studyDate,
        metadata.seriesDescription,
        metadata.instanceNumber,
        metadata.bodyPartExamined,
        metadata.rows,
        metadata.columns,
        metadata.patientName,
        metadata.patientId,
        JSON.stringify(metadata.raw),
      ]
    );
  } catch (error) {
    const extractionError = error instanceof Error ? error.message : String(error);

    await query(
      `INSERT INTO dicom_instances (
         file_id,
         case_id,
         dicom_metadata,
         dicom_extraction_status,
         dicom_extraction_error,
         extracted_at,
         updated_at
       )
       VALUES ($1, $2, '{}'::jsonb, 'failed', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (file_id)
       DO UPDATE SET
         case_id = EXCLUDED.case_id,
         dicom_metadata = '{}'::jsonb,
         dicom_extraction_status = 'failed',
         dicom_extraction_error = EXCLUDED.dicom_extraction_error,
         extracted_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
      [fileId, caseId, extractionError]
    );
  }
};

export const getImagingStudiesForCase = async (caseId: string) => {
  const result = await query(
    `SELECT di.file_id,
            mf.file_name,
            mf.file_type,
            mf.file_size,
            mf.description,
            di.study_instance_uid,
            di.series_instance_uid,
            di.sop_instance_uid,
            di.modality,
            di.study_date,
            di.series_description,
            di.instance_number,
            di.body_part_examined,
            di.rows,
            di.columns,
            di.patient_name,
            di.patient_id,
            di.dicom_metadata,
            di.dicom_extraction_status,
            di.dicom_extraction_error
     FROM dicom_instances di
     JOIN medical_files mf ON mf.id = di.file_id
     WHERE di.case_id = $1
     ORDER BY di.study_date NULLS LAST,
              di.study_instance_uid NULLS LAST,
              di.series_instance_uid NULLS LAST,
              di.instance_number NULLS LAST,
              mf.created_at ASC`,
    [caseId]
  );

  const studyMap = new Map<string, any>();

  for (const row of result.rows as DicomInstanceRow[]) {
    const studyUid = row.study_instance_uid || `study-${row.file_id}`;
    const seriesUid = row.series_instance_uid || `series-${row.file_id}`;

    if (!studyMap.has(studyUid)) {
      studyMap.set(studyUid, {
        studyUid,
        studyDate: row.study_date,
        modalitySummary: [],
        patientName: row.patient_name,
        patientId: row.patient_id,
        series: [],
      });
    }

    const study = studyMap.get(studyUid);
    if (row.modality && !study.modalitySummary.includes(row.modality)) {
      study.modalitySummary.push(row.modality);
    }

    let series = study.series.find((item: any) => item.seriesUid === seriesUid);
    if (!series) {
      series = {
        seriesUid,
        seriesDescription: row.series_description || 'Untitled Series',
        modality: row.modality,
        bodyPartExamined: row.body_part_examined,
        instanceCount: 0,
        instances: [],
      };
      study.series.push(series);
    }

    series.instances.push({
      fileId: row.file_id,
      fileName: row.file_name,
      fileType: row.file_type,
      fileSize: row.file_size,
      description: row.description,
      studyUid,
      seriesUid,
      sopInstanceUid: row.sop_instance_uid,
      modality: row.modality,
      studyDate: row.study_date,
      seriesDescription: row.series_description,
      instanceNumber: row.instance_number,
      bodyPartExamined: row.body_part_examined,
      rows: row.rows,
      columns: row.columns,
      patientName: row.patient_name,
      patientId: row.patient_id,
      extractionStatus: row.dicom_extraction_status,
      extractionError: row.dicom_extraction_error,
      metadata: row.dicom_metadata || {},
    });

    series.instanceCount = series.instances.length;
  }

  return Array.from(studyMap.values());
};

const isAnnotationPoint = (value: unknown): value is DicomAnnotationPoint => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const point = value as DicomAnnotationPoint;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
};

export const parseDicomAnnotations = (input: unknown): DicomAnnotationPayload[] => {
  if (!Array.isArray(input)) {
    throw new Error('annotations must be an array');
  }

  return input.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`annotations[${index}] must be an object`);
    }

    const annotation = item as DicomAnnotationPayload;
    if (typeof annotation.id !== 'string' || !annotation.id.trim()) {
      throw new Error(`annotations[${index}].id is required`);
    }

    if (!['distance', 'area', 'arrow', 'text', 'angle'].includes(annotation.type)) {
      throw new Error(`annotations[${index}].type is invalid`);
    }

    if (!Array.isArray(annotation.points) || annotation.points.length === 0 || !annotation.points.every(isAnnotationPoint)) {
      throw new Error(`annotations[${index}].points is invalid`);
    }

    if (typeof annotation.color !== 'string' || !annotation.color.trim()) {
      throw new Error(`annotations[${index}].color is required`);
    }

    const huStats =
      annotation.huStats &&
      typeof annotation.huStats === 'object' &&
      Number.isFinite(annotation.huStats.mean) &&
      Number.isFinite(annotation.huStats.min) &&
      Number.isFinite(annotation.huStats.max)
        ? {
            mean: Number(annotation.huStats.mean),
            min: Number(annotation.huStats.min),
            max: Number(annotation.huStats.max),
          }
        : undefined;

    // Author metadata is server-stamped on save; ignore client-supplied values.
    return {
      id: annotation.id.trim(),
      type: annotation.type,
      points: annotation.points,
      color: annotation.color.trim(),
      text: typeof annotation.text === 'string' ? annotation.text : undefined,
      measurement: Number.isFinite(annotation.measurement as number) ? Number(annotation.measurement) : undefined,
      huStats,
    };
  });
};

const geometryKey = (annotation: DicomAnnotationPayload): string =>
  JSON.stringify({
    type: annotation.type,
    points: annotation.points,
    text: annotation.text ?? null,
    color: annotation.color,
    measurement: annotation.measurement ?? null,
    huStats: annotation.huStats ?? null,
  });

export const buildSharedAnnotationState = (
  previous: DicomAnnotationPayload[],
  incoming: DicomAnnotationPayload[],
  actorUserId: string,
  actorName: string,
  nowIso: string
): { annotations: DicomAnnotationPayload[]; events: AnnotationAuditEvent[] } => {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const incomingIds = new Set(incoming.map((item) => item.id));
  const annotations: DicomAnnotationPayload[] = [];
  const events: AnnotationAuditEvent[] = [];

  for (const item of incoming) {
    const prior = previousById.get(item.id);
    if (!prior) {
      const created: DicomAnnotationPayload = {
        ...item,
        createdByUserId: actorUserId,
        createdByName: actorName,
        createdAt: nowIso,
        updatedByUserId: actorUserId,
        updatedAt: nowIso,
      };
      annotations.push(created);
      events.push({ annotationId: item.id, action: 'created', before: null, after: created });
      continue;
    }

    if (geometryKey(prior) === geometryKey(item)) {
      annotations.push(prior);
      continue;
    }

    const updated: DicomAnnotationPayload = {
      ...item,
      createdByUserId: prior.createdByUserId || actorUserId,
      createdByName: prior.createdByName || actorName,
      createdAt: prior.createdAt || nowIso,
      updatedByUserId: actorUserId,
      updatedAt: nowIso,
    };
    annotations.push(updated);
    events.push({ annotationId: item.id, action: 'updated', before: prior, after: updated });
  }

  for (const prior of previous) {
    if (!incomingIds.has(prior.id)) {
      events.push({ annotationId: prior.id, action: 'deleted', before: prior, after: null });
    }
  }

  return { annotations, events };
};

export const resolveAnnotationActorName = async (userId: string): Promise<string> => {
  const result = await query(
    `SELECT u.email,
            NULLIF(TRIM(CONCAT(COALESCE(d.first_name, ''), ' ', COALESCE(d.last_name, ''))), '') AS doctor_name,
            NULLIF(TRIM(CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, ''))), '') AS patient_name
     FROM users u
     LEFT JOIN doctors d ON d.user_id = u.id
     LEFT JOIN patients p ON p.user_id = u.id
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return 'Unknown user';
  }

  const row = result.rows[0] as {
    email: string;
    doctor_name: string | null;
    patient_name: string | null;
  };

  return row.doctor_name || row.patient_name || row.email || 'Unknown user';
};

export const parseDicomViewport = (input: unknown): DicomViewportPayload | null => {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const viewport = input as Partial<DicomViewportPayload>;
  const numericArray = (value: unknown, field: string): number[] => {
    if (!Array.isArray(value) || !value.every((item) => Number.isFinite(item))) {
      throw new Error(`${field} must be a numeric array`);
    }
    return value.map((item) => Number(item));
  };

  if (!Number.isFinite(viewport.zoom) || !Number.isFinite(viewport.rotation)) {
    throw new Error('viewport zoom and rotation are required');
  }

  return {
    zoom: Number(viewport.zoom),
    rotation: Number(viewport.rotation),
    brightness: numericArray(viewport.brightness, 'viewport.brightness'),
    contrast: numericArray(viewport.contrast, 'viewport.contrast'),
    windowLevel: numericArray(viewport.windowLevel, 'viewport.windowLevel'),
    windowWidth: numericArray(viewport.windowWidth, 'viewport.windowWidth'),
    windowPreset: typeof viewport.windowPreset === 'string' ? viewport.windowPreset : 'default',
  };
};

export const getPersistedAnnotations = async (
  fileId: string
): Promise<PersistedAnnotationRecord | null> => {
  const result = await query(
    `SELECT file_id,
            annotations_json,
            viewport_json,
            sop_instance_uid,
            updated_at
     FROM file_annotations
     WHERE file_id = $1
     LIMIT 1`,
    [fileId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0] as {
    file_id: string;
    annotations_json: DicomAnnotationPayload[];
    viewport_json: DicomViewportPayload | null;
    sop_instance_uid: string | null;
    updated_at: string | null;
  };

  return {
    fileId: row.file_id,
    annotations: row.annotations_json || [],
    viewport:
      row.viewport_json && Object.keys(row.viewport_json as unknown as Record<string, unknown>).length > 0
        ? row.viewport_json
        : null,
    sopInstanceUid: row.sop_instance_uid,
    updatedAt: row.updated_at,
  };
};

export const savePersistedAnnotations = async ({
  fileId,
  caseId,
  savedBy,
  sopInstanceUid,
  annotations,
  viewport,
}: {
  fileId: string;
  caseId: string;
  savedBy: string;
  sopInstanceUid?: string | null;
  annotations: DicomAnnotationPayload[];
  viewport: DicomViewportPayload | null;
}): Promise<PersistedAnnotationRecord> => {
  const existing = await getPersistedAnnotations(fileId);
  const actorName = await resolveAnnotationActorName(savedBy);
  const nowIso = new Date().toISOString();
  const { annotations: stamped, events } = buildSharedAnnotationState(
    existing?.annotations || [],
    annotations,
    savedBy,
    actorName,
    nowIso
  );

  const result = await query(
    `INSERT INTO file_annotations (file_id, case_id, saved_by, sop_instance_uid, annotations_json, viewport_json)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     ON CONFLICT (file_id)
     DO UPDATE SET
       case_id = EXCLUDED.case_id,
       saved_by = EXCLUDED.saved_by,
       sop_instance_uid = EXCLUDED.sop_instance_uid,
       annotations_json = EXCLUDED.annotations_json,
       viewport_json = EXCLUDED.viewport_json,
       updated_at = CURRENT_TIMESTAMP
     RETURNING file_id, annotations_json, viewport_json, sop_instance_uid, updated_at`,
    [fileId, caseId, savedBy, sopInstanceUid || null, JSON.stringify(stamped), JSON.stringify(viewport)]
  );

  for (const event of events) {
    await query(
      `INSERT INTO file_annotation_events (
         file_id, case_id, annotation_id, actor_user_id, action, before_json, after_json
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        fileId,
        caseId,
        event.annotationId,
        savedBy,
        event.action,
        event.before ? JSON.stringify(event.before) : null,
        event.after ? JSON.stringify(event.after) : null,
      ]
    );
  }

  return {
    fileId: result.rows[0].file_id,
    annotations: result.rows[0].annotations_json || [],
    viewport: result.rows[0].viewport_json || null,
    sopInstanceUid: result.rows[0].sop_instance_uid,
    updatedAt: result.rows[0].updated_at,
  };
};
