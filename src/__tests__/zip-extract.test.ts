import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { AppError } from '../middleware/errorHandler';
import { extractZipArchive } from '../utils/zipExtract';

describe('extractZipArchive', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sec90-zip-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns AppError 400 for corrupt / non-zip bytes', async () => {
    const zipPath = path.join(tempDir, 'broken.zip');
    const destDir = path.join(tempDir, 'out');
    await fs.writeFile(zipPath, 'this is not a zip archive');

    await expect(extractZipArchive(zipPath, destDir)).rejects.toMatchObject({
      message:
        'That .zip could not be opened. It may be incomplete or not a real .zip archive.',
      statusCode: 400,
    });
    await expect(extractZipArchive(zipPath, destDir)).rejects.toBeInstanceOf(AppError);
  });
});
