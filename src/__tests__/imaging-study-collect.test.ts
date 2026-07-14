import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { collectDicomInstancePaths } from '../services/imagingStudyIngest.service';

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
    expect(result.usedDicomdir).toBe(false);
  });
});
