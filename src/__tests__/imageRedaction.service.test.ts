import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import dcmjs from 'dcmjs';
import {
  getImageRedactionConfig,
  isImageDeidEnabled,
  redactDicomPixelsInPlace,
  redactImagePhi,
  shouldRedactDicomPixels,
} from '../services/imageRedaction.service';

const { DicomDict } = dcmjs.data;

const originalFetch = global.fetch;

const writeFixtureDicom = async (
  filePath: string,
  overrides: {
    modality?: string;
    samplesPerPixel?: number;
    photometric?: string;
  } = {}
): Promise<void> => {
  const sopUid = '1.2.840.113619.2.55.3.604688123.789';
  const meta = {
    '00020001': { vr: 'OB', Value: [new Uint8Array([0, 1]).buffer] },
    '00020002': { vr: 'UI', Value: ['1.2.840.10008.5.1.4.1.1.2'] },
    '00020003': { vr: 'UI', Value: [sopUid] },
    '00020010': { vr: 'UI', Value: ['1.2.840.10008.1.2.1'] },
    '00020012': { vr: 'UI', Value: ['1.2.826.0.1.3680043.9.999'] },
  };

  const dict = new DicomDict(meta);
  dict.dict = {
    '00080016': { vr: 'UI', Value: ['1.2.840.10008.5.1.4.1.1.2'] },
    '00080018': { vr: 'UI', Value: [sopUid] },
    '00080060': { vr: 'CS', Value: [overrides.modality || 'CT'] },
    '00280002': { vr: 'US', Value: [overrides.samplesPerPixel ?? 1] },
    '00280004': { vr: 'CS', Value: [overrides.photometric || 'MONOCHROME2'] },
    '00100010': { vr: 'PN', Value: [{ Alphabetic: 'DOE^JOHN' }] },
    '0020000D': { vr: 'UI', Value: ['1.2.840.113619.2.55.3.604688123.123'] },
    '0020000E': { vr: 'UI', Value: ['1.2.840.113619.2.55.3.604688123.456'] },
  };

  await fs.writeFile(filePath, Buffer.from(dict.write()));
};

describe('imageRedaction.service (SEC-129)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.IMAGE_DEID_ENABLED;
    delete process.env.PRESIDIO_IMAGE_REDACTOR_URL;
    delete process.env.DICOM_PIXEL_REDACT_MODALITIES;
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('is disabled by default (ship dark)', () => {
    expect(isImageDeidEnabled()).toBe(false);
    expect(getImageRedactionConfig().enabled).toBe(false);
  });

  it('passes through image bytes unchanged when IMAGE_DEID_ENABLED is false', async () => {
    process.env.IMAGE_DEID_ENABLED = 'false';
    const input = Buffer.from('fake-png-bytes');
    const result = await redactImagePhi(input, 'image/png');

    expect(result.buffer.equals(input)).toBe(true);
    expect(result.audit.enabled).toBe(false);
    expect(result.audit.applied).toBe(false);
    expect(result.audit.skippedReason).toBe('disabled');
  });

  it('redacts image via sidecar and records entity counts only', async () => {
    process.env.IMAGE_DEID_ENABLED = 'true';
    process.env.PRESIDIO_IMAGE_REDACTOR_URL = 'http://redactor.test';

    const redacted = Buffer.from('redacted-png');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => {
          if (name === 'x-entity-count') return '2';
          if (name === 'x-entity-types') return 'PERSON,DATE_TIME';
          return null;
        },
      },
      arrayBuffer: async () =>
        redacted.buffer.slice(redacted.byteOffset, redacted.byteOffset + redacted.byteLength),
    }) as unknown as typeof fetch;

    const result = await redactImagePhi(Buffer.from('raw-png'), 'image/png', {
      fileName: 'report.png',
    });

    expect(result.buffer.equals(redacted)).toBe(true);
    expect(result.audit.applied).toBe(true);
    expect(result.audit.entityCount).toBe(2);
    expect(result.audit.entityTypes).toEqual(['PERSON', 'DATE_TIME']);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://redactor.test/redact-image',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('fails closed when redactor is unreachable and IMAGE_DEID_ENABLED', async () => {
    process.env.IMAGE_DEID_ENABLED = 'true';
    process.env.PRESIDIO_IMAGE_REDACTOR_URL = 'http://redactor.test';
    global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed')) as unknown as typeof fetch;

    await expect(redactImagePhi(Buffer.from('raw'), 'image/jpeg')).rejects.toThrow(
      /Image de-identification unavailable/
    );
  });

  it('skips plain CT modality (no per-slice OCR)', async () => {
    process.env.IMAGE_DEID_ENABLED = 'true';
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-129-ct-'));
    const filePath = path.join(dir, 'ct.dcm');
    await writeFixtureDicom(filePath, { modality: 'CT' });

    const eligibility = await shouldRedactDicomPixels(filePath);
    expect(eligibility.shouldRedact).toBe(false);
    expect(eligibility.modality).toBe('CT');

    const audit = await redactDicomPixelsInPlace(filePath);
    expect(audit.applied).toBe(false);
    expect(audit.skippedReason).toBe('modality_skip');
  });

  it('skips plain MR modality', async () => {
    process.env.IMAGE_DEID_ENABLED = 'true';
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-129-mr-'));
    const filePath = path.join(dir, 'mr.dcm');
    await writeFixtureDicom(filePath, { modality: 'MR' });

    const eligibility = await shouldRedactDicomPixels(filePath);
    expect(eligibility.shouldRedact).toBe(false);
    expect(eligibility.modality).toBe('MR');
  });

  it('selects US for pixel redaction and calls sidecar', async () => {
    process.env.IMAGE_DEID_ENABLED = 'true';
    process.env.PRESIDIO_IMAGE_REDACTOR_URL = 'http://redactor.test';

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-129-us-'));
    const filePath = path.join(dir, 'us.dcm');
    await writeFixtureDicom(filePath, { modality: 'US' });
    const before = await fs.readFile(filePath);

    const redacted = Buffer.from('redacted-dicom-bytes');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => {
          if (name === 'x-entity-count') return '1';
          if (name === 'x-entity-types') return 'PERSON';
          return null;
        },
      },
      arrayBuffer: async () =>
        redacted.buffer.slice(redacted.byteOffset, redacted.byteOffset + redacted.byteLength),
    }) as unknown as typeof fetch;

    const audit = await redactDicomPixelsInPlace(filePath);
    const after = await fs.readFile(filePath);

    expect(audit.applied).toBe(true);
    expect(audit.entityCount).toBe(1);
    expect(after.equals(redacted)).toBe(true);
    expect(after.equals(before)).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://redactor.test/redact-dicom',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('selects photographic RGB even when modality is not in the default list', async () => {
    process.env.IMAGE_DEID_ENABLED = 'true';
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-129-rgb-'));
    const filePath = path.join(dir, 'photo.dcm');
    await writeFixtureDicom(filePath, {
      modality: 'XA',
      samplesPerPixel: 3,
      photometric: 'RGB',
    });

    const eligibility = await shouldRedactDicomPixels(filePath);
    expect(eligibility.shouldRedact).toBe(true);
  });

  it('fails closed for US when redactor returns non-OK', async () => {
    process.env.IMAGE_DEID_ENABLED = 'true';
    process.env.PRESIDIO_IMAGE_REDACTOR_URL = 'http://redactor.test';
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-129-fail-'));
    const filePath = path.join(dir, 'sc.dcm');
    await writeFixtureDicom(filePath, { modality: 'SC' });

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'sidecar down',
      headers: { get: () => null },
    }) as unknown as typeof fetch;

    await expect(redactDicomPixelsInPlace(filePath)).rejects.toThrow(
      /Image de-identification unavailable/
    );
  });
});
