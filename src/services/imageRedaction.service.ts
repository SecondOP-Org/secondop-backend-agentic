/**
 * Pixel PHI redaction via Presidio image-redactor sidecar (SEC-129).
 *
 * Ship-dark behind IMAGE_DEID_ENABLED (default false). When enabled, fail closed
 * if the redactor is unreachable — raw pixels must not leave the trust boundary.
 * Audit logs/metrics carry entity counts/types only — never PHI values.
 */
import fs from 'fs/promises';
import dcmjs from 'dcmjs';
import logger from '../utils/logger';
import {
  incrementFailClosed,
  incrementImagePhiRedactions,
} from '../observability/phoenix.service';

const { DicomMessage } = dcmjs.data;

const parseBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
};

const parseNumber = (value: string | undefined, defaultValue: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

const DEFAULT_PIXEL_REDACT_MODALITIES = ['US', 'SC', 'XC', 'OT'];

export interface ImageRedactionConfig {
  enabled: boolean;
  redactorUrl: string;
  minScore: number;
  timeoutMs: number;
  pixelRedactModalities: Set<string>;
}

export interface ImageRedactionAudit {
  enabled: boolean;
  applied: boolean;
  skippedReason?: 'disabled' | 'modality_skip' | 'no_entities';
  entityCount: number;
  entityTypes: string[];
  contentKind: 'image' | 'dicom';
}

export class ImageRedactionError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ImageRedactionError';
  }
}

export const getImageRedactionConfig = (): ImageRedactionConfig => {
  const modalitiesRaw =
    process.env.DICOM_PIXEL_REDACT_MODALITIES?.trim() || DEFAULT_PIXEL_REDACT_MODALITIES.join(',');
  const pixelRedactModalities = new Set(
    modalitiesRaw
      .split(',')
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean)
  );

  return {
    enabled: parseBoolean(process.env.IMAGE_DEID_ENABLED, false),
    redactorUrl: (process.env.PRESIDIO_IMAGE_REDACTOR_URL || 'http://localhost:5003').replace(
      /\/$/,
      ''
    ),
    minScore: parseNumber(process.env.PRESIDIO_MIN_SCORE, 0.5),
    timeoutMs: parseNumber(process.env.PRESIDIO_IMAGE_REDACTOR_TIMEOUT_MS, 60000),
    pixelRedactModalities,
  };
};

export const isImageDeidEnabled = (): boolean => getImageRedactionConfig().enabled;

const failClosedMessage =
  'Image de-identification unavailable; upload halted to avoid storing or sending raw PHI pixels.';

const postMultipart = async (
  path: string,
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<{ body: Buffer; entityCount: number; entityTypes: string[] }> => {
  const config = getImageRedactionConfig();
  const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), filename);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.redactorUrl}${path}`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
      headers: {
        'X-Presidio-Min-Score': String(config.minScore),
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ImageRedactionError(
        `Image redactor request failed (${response.status})${
          detail ? `: ${detail.slice(0, 200)}` : ''
        }`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const body = Buffer.from(arrayBuffer);
    const entityCount = Number(response.headers.get('x-entity-count') || '0') || 0;
    const entityTypes = (response.headers.get('x-entity-types') || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);

    return { body, entityCount, entityTypes };
  } catch (error) {
    if (error instanceof ImageRedactionError) {
      throw error;
    }
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? `Image redactor timed out after ${config.timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : 'Image redactor request failed';
    throw new ImageRedactionError(message, error);
  } finally {
    clearTimeout(timeout);
  }
};

const readElementValue = (element: { vr?: string; Value?: unknown[] } | undefined): string | null => {
  if (!element || !Array.isArray(element.Value) || element.Value.length === 0) {
    return null;
  }
  const first = element.Value[0];
  if (typeof first === 'string') {
    return first;
  }
  if (typeof first === 'number') {
    return String(first);
  }
  return null;
};

/**
 * Pixel-redact only US/SC/XC/OT (configurable) and photographic/RGB captures.
 * Plain CT/MR skip — tag de-id only, no per-slice OCR cost.
 */
export const shouldRedactDicomPixels = async (filePath: string): Promise<{
  shouldRedact: boolean;
  modality: string | null;
  reason?: 'modality_skip';
}> => {
  const config = getImageRedactionConfig();
  const fileBuffer = await fs.readFile(filePath);
  const arrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength
  );

  let dict: Record<string, { vr: string; Value: unknown[] }>;
  try {
    const dicomDict = DicomMessage.readFile(arrayBuffer) as {
      dict: Record<string, { vr: string; Value: unknown[] }>;
    };
    dict = dicomDict.dict;
  } catch {
    // Unreadable as DICOM — let the redactor attempt (fail closed if it errors).
    return { shouldRedact: true, modality: null };
  }

  const modality = (readElementValue(dict['00080060']) || '').trim().toUpperCase() || null;
  const samplesPerPixel = Number(readElementValue(dict['00280002']) || '1');
  const photometric = (readElementValue(dict['00280004']) || '').toUpperCase();
  const isPhotographic =
    samplesPerPixel >= 3 ||
    photometric.startsWith('RGB') ||
    photometric.startsWith('YBR');

  if (modality && config.pixelRedactModalities.has(modality)) {
    return { shouldRedact: true, modality };
  }
  if (isPhotographic) {
    return { shouldRedact: true, modality };
  }

  return { shouldRedact: false, modality, reason: 'modality_skip' };
};

export const redactImagePhi = async (
  buffer: Buffer,
  mimeType: string,
  options?: { fileName?: string }
): Promise<{ buffer: Buffer; audit: ImageRedactionAudit }> => {
  const config = getImageRedactionConfig();
  if (!config.enabled) {
    return {
      buffer,
      audit: {
        enabled: false,
        applied: false,
        skippedReason: 'disabled',
        entityCount: 0,
        entityTypes: [],
        contentKind: 'image',
      },
    };
  }

  try {
    const filename = options?.fileName || 'upload.png';
    const contentType = mimeType || 'application/octet-stream';
    const { body, entityCount, entityTypes } = await postMultipart(
      '/redact-image',
      buffer,
      filename,
      contentType
    );

    const audit: ImageRedactionAudit = {
      enabled: true,
      applied: true,
      skippedReason: entityCount === 0 ? 'no_entities' : undefined,
      entityCount,
      entityTypes,
      contentKind: 'image',
    };

    incrementImagePhiRedactions(1, {
      content_kind: 'image',
      entity_count: entityCount,
      applied: true,
    });

    logger.info('Image PHI redaction applied', {
      entityCount: audit.entityCount,
      entityTypes: audit.entityTypes,
      contentKind: 'image',
      bytesIn: buffer.length,
      bytesOut: body.length,
    });

    return { buffer: body, audit };
  } catch (error) {
    incrementFailClosed({ reason: 'image_redactor_unavailable', content_kind: 'image' });
    logger.error('Image PHI redaction failed closed', {
      error: error instanceof Error ? error.message : String(error),
      contentKind: 'image',
    });
    throw new ImageRedactionError(failClosedMessage, error);
  }
};

export const redactImageFileInPlace = async (
  filePath: string,
  mimeType: string
): Promise<ImageRedactionAudit> => {
  const original = await fs.readFile(filePath);
  const { buffer, audit } = await redactImagePhi(original, mimeType, {
    fileName: filePath.split('/').pop(),
  });
  if (audit.applied) {
    await fs.writeFile(filePath, buffer);
  }
  return audit;
};

/** Redact image bytes when IMAGE_DEID_ENABLED; passthrough when disabled. */
export const ensureImageBufferRedacted = async (
  buffer: Buffer,
  mimeType: string,
  fileName?: string
): Promise<Buffer> => {
  const { buffer: redacted } = await redactImagePhi(buffer, mimeType, { fileName });
  return redacted;
};

export const redactDicomPixelsInPlace = async (filePath: string): Promise<ImageRedactionAudit> => {
  const config = getImageRedactionConfig();
  if (!config.enabled) {
    return {
      enabled: false,
      applied: false,
      skippedReason: 'disabled',
      entityCount: 0,
      entityTypes: [],
      contentKind: 'dicom',
    };
  }

  const eligibility = await shouldRedactDicomPixels(filePath);
  if (!eligibility.shouldRedact) {
    logger.info('Skipping DICOM pixel redaction (modality policy)', {
      modality: eligibility.modality,
    });
    return {
      enabled: true,
      applied: false,
      skippedReason: 'modality_skip',
      entityCount: 0,
      entityTypes: [],
      contentKind: 'dicom',
    };
  }

  try {
    const original = await fs.readFile(filePath);
    const { body, entityCount, entityTypes } = await postMultipart(
      '/redact-dicom',
      original,
      'instance.dcm',
      'application/dicom'
    );
    await fs.writeFile(filePath, body);

    const audit: ImageRedactionAudit = {
      enabled: true,
      applied: true,
      skippedReason: entityCount === 0 ? 'no_entities' : undefined,
      entityCount,
      entityTypes,
      contentKind: 'dicom',
    };

    incrementImagePhiRedactions(1, {
      content_kind: 'dicom',
      entity_count: entityCount,
      modality: eligibility.modality || 'unknown',
      applied: true,
    });

    logger.info('DICOM pixel PHI redaction applied', {
      modality: eligibility.modality,
      entityCount: audit.entityCount,
      entityTypes: audit.entityTypes,
      contentKind: 'dicom',
      bytesIn: original.length,
      bytesOut: body.length,
    });

    return audit;
  } catch (error) {
    incrementFailClosed({ reason: 'image_redactor_unavailable', content_kind: 'dicom' });
    logger.error('DICOM pixel PHI redaction failed closed', {
      error: error instanceof Error ? error.message : String(error),
      modality: eligibility.modality,
      contentKind: 'dicom',
    });
    throw new ImageRedactionError(failClosedMessage, error);
  }
};
