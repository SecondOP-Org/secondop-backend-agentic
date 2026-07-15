import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  collectDicomInstancePaths,
  CORRUPT_DICOM_MESSAGE,
  NO_DICOM_FOUND_MESSAGE,
} from '../services/imagingStudyIngest.service';
import { AppError } from '../middleware/errorHandler';

const writeFakeDicom = async (filePath: string) => {
  const buffer = Buffer.alloc(256, 0);
  buffer.write('DICM', 128, 'ascii');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
};

describe('collectDicomInstancePaths', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sec94-dicom-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('keeps magic-positive files and skips junk with reasons', async () => {
    await writeFakeDicom(path.join(tempDir, 'SERIES', 'I001'));
    await writeFakeDicom(path.join(tempDir, 'SERIES', 'I002'));
    await fs.writeFile(path.join(tempDir, 'readme.txt'), 'not dicom');

    const result = await collectDicomInstancePaths(tempDir);

    expect(result.instancePaths).toHaveLength(2);
    expect(result.skipped.length).toBeGreaterThanOrEqual(1);
    expect(result.skippedNonDicom).toBe(result.skipped.length);
    expect(result.skipped.some((item) => /readme/i.test(item.fileName))).toBe(true);
    expect(result.skipped.find((item) => /readme/i.test(item.fileName))?.reason).toBe(
      'index-file'
    );
    expect(result.unreadableCount).toBe(0);
    expect(result.usedDicomdir).toBe(false);
  });

  it('counts likely-DICOM files without magic as unreadable (corrupt), not mere skips', async () => {
    await fs.writeFile(path.join(tempDir, 'broken.dcm'), 'not a real dicom');
    await fs.writeFile(path.join(tempDir, 'preview.jpg'), 'jpeg bytes');

    const result = await collectDicomInstancePaths(tempDir);

    expect(result.instancePaths).toHaveLength(0);
    expect(result.unreadableCount).toBe(1);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileName: 'broken.dcm', reason: 'unreadable' }),
        expect.objectContaining({ fileName: 'preview.jpg', reason: 'not-dicom' }),
      ])
    );
    expect(result.skippedNonDicom).toBe(2);
  });

  it('reports index/sidecar files even when DICOMDIR drives candidates', async () => {
    await writeFakeDicom(path.join(tempDir, 'IMAGES', 'I001'));
    // Minimal DICOMDIR that lists only I001 — plus sidecars that must still be reported.
    const dicomdir = Buffer.alloc(256, 0);
    dicomdir.write('DICM', 128, 'ascii');
    await fs.writeFile(path.join(tempDir, 'DICOMDIR'), dicomdir);
    await fs.writeFile(path.join(tempDir, 'README.TXT'), 'readme');
    await fs.writeFile(path.join(tempDir, 'desktop.ini'), '[.ShellClassInfo]');

    const result = await collectDicomInstancePaths(tempDir);

    const reasonsByName = Object.fromEntries(
      result.skipped.map((item) => [path.basename(item.fileName).toUpperCase(), item.reason])
    );
    expect(reasonsByName.DICOMDIR).toBe('index-file');
    expect(reasonsByName['README.TXT']).toBe('index-file');
    expect(reasonsByName['DESKTOP.INI']).toBe('index-file');
    expect(result.skippedNonDicom).toBe(result.skipped.length);
    expect(result.skippedNonDicom).toBeGreaterThanOrEqual(3);
  });
});

describe('imaging study empty-folder messages', () => {
  it('exports distinct patient-facing messages', () => {
    expect(NO_DICOM_FOUND_MESSAGE).toMatch(/couldn't find any scan images/i);
    expect(CORRUPT_DICOM_MESSAGE).toMatch(/damaged or unreadable/i);
    expect(new AppError(NO_DICOM_FOUND_MESSAGE, 400).statusCode).toBe(400);
    expect(new AppError(CORRUPT_DICOM_MESSAGE, 400).statusCode).toBe(400);
  });
});
