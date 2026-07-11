import path from 'path';

export const resolveUploadDir = (): string => {
  const configured = process.env.UPLOAD_DIR || './uploads';
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
};

/** Resolve a stored file_url (/uploads/<name>) to the on-disk path under UPLOAD_DIR. */
export const resolveStoredFilePath = (fileUrl: string): string => {
  return path.join(resolveUploadDir(), path.basename(fileUrl));
};
