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
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sec76-dicom-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('keeps magic-positive files and skips junk', async () => {
    await writeFakeDicom(path.join(tempDir, 'SERIES', 'I001'));
    await writeFakeDicom(path.join(tempDir, 'SERIES', 'I002'));
    await fs.writeFile(path.join(tempDir, 'readme.txt'), 'not dicom');

    const result = await collectDicomInstancePaths(tempDir);

    expect(result.instancePaths).toHaveLength(2);
    expect(result.skippedNonDicom).toBeGreaterThanOrEqual(1);
    expect(result.unreadableCount).toBe(0);
    expect(result.usedDicomdir).toBe(false);
  });

  it('counts likely-DICOM files without magic as unreadable (corrupt), not mere skips', async () => {
    await fs.writeFile(path.join(tempDir, 'broken.dcm'), 'not a real dicom');
    await fs.writeFile(path.join(tempDir, 'preview.jpg'), 'jpeg bytes');

    const result = await collectDicomInstancePaths(tempDir);

    expect(result.instancePaths).toHaveLength(0);
    expect(result.unreadableCount).toBe(1);
    expect(result.skippedNonDicom).toBe(1);
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
