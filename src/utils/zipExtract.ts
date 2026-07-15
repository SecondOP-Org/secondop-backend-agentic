import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import yauzl from 'yauzl';
import { AppError } from '../middleware/errorHandler';

const ZIP_OPEN_ERROR_MESSAGE =
  'That .zip could not be opened. It may be incomplete or not a real .zip archive.';

const isZipSlip = (rootDir: string, targetPath: string): boolean => {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(targetPath);
  return (
    resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  );
};

const extractZipArchiveUnsafe = async (zipPath: string, destDir: string): Promise<number> => {
  await fsp.mkdir(destDir, { recursive: true });

  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(openError || new Error('Unable to open zip archive'));
        return;
      }

      let extractedFiles = 0;

      zipFile.readEntry();

      zipFile.on('entry', (entry) => {
        const entryPath = entry.fileName.replace(/\\/g, '/');
        if (/\/$/.test(entryPath)) {
          zipFile.readEntry();
          return;
        }

        // Skip macOS metadata and absolute paths
        if (
          entryPath.startsWith('__MACOSX/') ||
          entryPath.includes('/__MACOSX/') ||
          path.isAbsolute(entryPath) ||
          entryPath.includes('..')
        ) {
          zipFile.readEntry();
          return;
        }

        const destination = path.join(destDir, entryPath);
        if (isZipSlip(destDir, destination)) {
          zipFile.close();
          reject(new Error(`Unsafe zip entry path: ${entry.fileName}`));
          return;
        }

        zipFile.openReadStream(entry, (streamError, readStream) => {
          if (streamError || !readStream) {
            zipFile.close();
            reject(streamError || new Error(`Unable to read zip entry: ${entry.fileName}`));
            return;
          }

          fsp
            .mkdir(path.dirname(destination), { recursive: true })
            .then(() => {
              const writeStream = fs.createWriteStream(destination);
              readStream.pipe(writeStream);
              writeStream.on('close', () => {
                extractedFiles += 1;
                zipFile.readEntry();
              });
              writeStream.on('error', (writeError) => {
                zipFile.close();
                reject(writeError);
              });
            })
            .catch((mkdirError) => {
              zipFile.close();
              reject(mkdirError);
            });
        });
      });

      zipFile.on('end', () => resolve(extractedFiles));
      zipFile.on('error', (zipError) => reject(zipError));
    });
  });
};

/**
 * Extract a zip archive into destDir (streaming). Skips directories and rejects zip-slip paths.
 * Invalid/corrupt archives always surface as AppError 400 — never an unhandled 500.
 */
export const extractZipArchive = async (zipPath: string, destDir: string): Promise<number> => {
  try {
    return await extractZipArchiveUnsafe(zipPath, destDir);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(ZIP_OPEN_ERROR_MESSAGE, 400);
  }
};
