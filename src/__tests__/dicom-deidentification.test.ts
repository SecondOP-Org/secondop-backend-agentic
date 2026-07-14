import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import dcmjs from 'dcmjs';
import {
  assertDicomDeidReady,
  createDicomDeidContext,
  deidentifyDicomFileInPlace,
  generateDicomUid,
  isDicomDeidEnabled,
  sealDicomDeidMapping,
  unsealDicomDeidMapping,
} from '../services/dicomDeidentification.service';

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjs.data;

jest.mock('../database/connection', () => ({
  query: jest.fn(),
}));

const writeFixtureDicom = async (
  filePath: string,
  overrides: {
    patientName?: string;
    patientId?: string;
    studyUid?: string;
    seriesUid?: string;
    sopUid?: string;
    institutionName?: string;
  } = {}
): Promise<void> => {
  const studyUid = overrides.studyUid || '1.2.840.113619.2.55.3.604688123.123';
  const seriesUid = overrides.seriesUid || '1.2.840.113619.2.55.3.604688123.456';
  const sopUid = overrides.sopUid || '1.2.840.113619.2.55.3.604688123.789';

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
    '00080050': { vr: 'SH', Value: ['ACC-999'] },
    '00080060': { vr: 'CS', Value: ['CT'] },
    '00080080': { vr: 'LO', Value: [overrides.institutionName || 'General Hospital'] },
    '00100010': { vr: 'PN', Value: [{ Alphabetic: overrides.patientName || 'DOE^JOHN' }] },
    '00100020': { vr: 'LO', Value: [overrides.patientId || 'MRN-12345'] },
    '00100030': { vr: 'DA', Value: ['19800101'] },
    '0020000D': { vr: 'UI', Value: [studyUid] },
    '0020000E': { vr: 'UI', Value: [seriesUid] },
  };

  await fs.writeFile(filePath, Buffer.from(dict.write()));
};

const readNaturalized = async (filePath: string): Promise<Record<string, unknown>> => {
  const buffer = await fs.readFile(filePath);
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const dicomDict = DicomMessage.readFile(ab);
  return DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
};

describe('DICOM header de-identification', () => {
  const previousEnabled = process.env.DICOM_DEID_ENABLED;
  const previousKey = process.env.DEID_REVERSIBLE_KEY;

  beforeEach(() => {
    process.env.DICOM_DEID_ENABLED = 'true';
    process.env.DEID_REVERSIBLE_KEY = 'unit-test-dicom-deid-key';
  });

  afterAll(() => {
    if (previousEnabled === undefined) {
      delete process.env.DICOM_DEID_ENABLED;
    } else {
      process.env.DICOM_DEID_ENABLED = previousEnabled;
    }
    if (previousKey === undefined) {
      delete process.env.DEID_REVERSIBLE_KEY;
    } else {
      process.env.DEID_REVERSIBLE_KEY = previousKey;
    }
  });

  it('reports enabled only when DICOM_DEID_ENABLED=true', () => {
    process.env.DICOM_DEID_ENABLED = 'false';
    expect(isDicomDeidEnabled()).toBe(false);
    process.env.DICOM_DEID_ENABLED = 'true';
    expect(isDicomDeidEnabled()).toBe(true);
  });

  it('fails closed when enabled without DEID_REVERSIBLE_KEY', () => {
    delete process.env.DEID_REVERSIBLE_KEY;
    expect(() => assertDicomDeidReady()).toThrow(/DEID_REVERSIBLE_KEY/);
  });

  it('strips PHI tags and remaps UIDs in the stored file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dicom-deid-'));
    const filePath = path.join(dir, 'instance.dcm');
    await writeFixtureDicom(filePath);

    const context = createDicomDeidContext('case-1');
    const result = await deidentifyDicomFileInPlace(filePath, context);
    const naturalized = await readNaturalized(filePath);

    const patientName = naturalized.PatientName as Array<{ Alphabetic?: string }> | string;
    const nameValue = Array.isArray(patientName)
      ? patientName[0]?.Alphabetic
      : patientName;

    expect(nameValue).toBe('ANONYMIZED');
    expect(naturalized.PatientID).toBe('');
    expect(naturalized.InstitutionName).toBe('');
    expect(naturalized.AccessionNumber).toBe('');
    expect(naturalized.StudyInstanceUID).not.toBe('1.2.840.113619.2.55.3.604688123.123');
    expect(naturalized.StudyInstanceUID).toBe(result.remappedStudyUid);
    expect(result.mapping.tags.PatientName).toBe('DOE^JOHN');
    expect(result.mapping.tags.PatientID).toBe('MRN-12345');
    expect(result.audit.some((entry) => entry.name === 'PatientName')).toBe(true);
    expect(result.audit.every((entry) => !JSON.stringify(entry).includes('DOE^JOHN'))).toBe(true);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('keeps Study/Series UID remaps consistent across instances in one context', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dicom-deid-'));
    const firstPath = path.join(dir, 'a.dcm');
    const secondPath = path.join(dir, 'b.dcm');
    const studyUid = '1.2.840.113619.2.55.3.604688123.STUDY';
    const seriesUid = '1.2.840.113619.2.55.3.604688123.SERIES';

    await writeFixtureDicom(firstPath, {
      studyUid,
      seriesUid,
      sopUid: '1.2.840.113619.2.55.3.604688123.SOP1',
    });
    await writeFixtureDicom(secondPath, {
      studyUid,
      seriesUid,
      sopUid: '1.2.840.113619.2.55.3.604688123.SOP2',
    });

    const context = createDicomDeidContext('case-1');
    const first = await deidentifyDicomFileInPlace(firstPath, context);
    const second = await deidentifyDicomFileInPlace(secondPath, context);

    const firstNat = await readNaturalized(firstPath);
    const secondNat = await readNaturalized(secondPath);

    expect(firstNat.StudyInstanceUID).toBe(secondNat.StudyInstanceUID);
    expect(firstNat.SeriesInstanceUID).toBe(secondNat.SeriesInstanceUID);
    expect(firstNat.SOPInstanceUID).not.toBe(secondNat.SOPInstanceUID);
    expect(first.remappedStudyUid).toBe(second.remappedStudyUid);
    expect(first.mapping.uids[studyUid]).toBe(second.mapping.uids[studyUid]);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('seals and unseals reversible mappings without exposing plaintext in the sealed blob', () => {
    const mapping = {
      uids: { '1.2.3': generateDicomUid() },
      tags: { PatientName: 'DOE^JOHN' },
    };

    const sealed = sealDicomDeidMapping(mapping);
    expect(sealed.includes('DOE^JOHN')).toBe(false);
    expect(unsealDicomDeidMapping(sealed)).toEqual(mapping);
  });
});
