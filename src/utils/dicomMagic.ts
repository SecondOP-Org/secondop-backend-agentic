import fs from 'fs/promises';

/** DICOM Part 10 preamble: bytes 128–131 are ASCII "DICM". */
export const isDicomMagicBuffer = (buffer: Buffer | Uint8Array): boolean => {
  if (buffer.length < 132) {
    return false;
  }

  return (
    buffer[128] === 0x44 && // D
    buffer[129] === 0x49 && // I
    buffer[130] === 0x43 && // C
    buffer[131] === 0x4d // M
  );
};

export const isDicomMagicFile = async (filePath: string): Promise<boolean> => {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(132);
    const { bytesRead } = await handle.read(buffer, 0, 132, 0);
    if (bytesRead < 132) {
      return false;
    }
    return isDicomMagicBuffer(buffer);
  } finally {
    await handle.close();
  }
};
