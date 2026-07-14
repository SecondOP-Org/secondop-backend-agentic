import fs from 'fs/promises';
import path from 'path';
import dicomParser from 'dicom-parser';

/**
 * Parse a DICOMDIR index and return absolute paths of referenced IMAGE files.
 * Falls back to [] if the file is missing or unreadable.
 */
export const listFilesFromDicomdir = async (dicomdirPath: string): Promise<string[]> => {
  const rootDir = path.dirname(dicomdirPath);
  const buffer = await fs.readFile(dicomdirPath);
  const dataSet = dicomParser.parseDicom(new Uint8Array(buffer));
  const sequence = dataSet.elements.x00041220;
  if (!sequence?.items?.length) {
    return [];
  }

  const referenced: string[] = [];

  for (const item of sequence.items) {
    const itemDataSet = item.dataSet;
    if (!itemDataSet) {
      continue;
    }

    const recordType = (itemDataSet.string('x00041430') || '').toUpperCase();
    if (recordType !== 'IMAGE') {
      continue;
    }

    const relativePath = readReferencedFileId(itemDataSet);
    if (!relativePath) {
      continue;
    }

    referenced.push(path.resolve(rootDir, relativePath));
  }

  return referenced;
};

const readReferencedFileId = (dataSet: {
  elements: Record<string, { vm?: number; length?: number; dataOffset?: number } | undefined>;
  byteArray: { buffer: ArrayBufferLike; byteOffset: number };
  string: (tag: string) => string | undefined;
}): string | null => {
  const element = dataSet.elements.x00041500;
  if (!element) {
    return null;
  }

  // Multi-valued File ID components (CS) are typically path segments.
  try {
    const components: string[] = [];
    if (
      typeof element.vm === 'number' &&
      element.vm > 1 &&
      typeof element.length === 'number' &&
      typeof element.dataOffset === 'number'
    ) {
      const bytes = new Uint8Array(
        dataSet.byteArray.buffer,
        dataSet.byteArray.byteOffset + element.dataOffset,
        element.length
      );
      const raw = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
      for (const part of raw.split(/[\0\\]/).map((value) => value.trim()).filter(Boolean)) {
        components.push(part);
      }
    } else {
      const single = dataSet.string('x00041500');
      if (single) {
        for (const part of single.split(/[\\/]/).map((value) => value.trim()).filter(Boolean)) {
          components.push(part);
        }
      }
    }

    if (components.length === 0) {
      return null;
    }

    return path.join(...components);
  } catch {
    return null;
  }
};
