import crypto from 'crypto';
import fs from 'fs/promises';

export const computeFileSha256 = async (filePath: string): Promise<string> => {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
};

export const computeBufferSha256 = (buffer: Buffer): string =>
  crypto.createHash('sha256').update(buffer).digest('hex');
