import path from 'path';

/**
 * Mirrors studyFileFilter rules in middleware/upload.ts without spinning multer.
 * Folder field `files` must be permissive; `archive` must stay zip-only.
 */
const studyFileFilterDecision = (
  fieldname: string,
  originalname: string,
  mimetype: string
): 'accept' | 'reject' => {
  if (fieldname === 'files') {
    return 'accept';
  }

  const extension = path.extname(originalname).toLowerCase();
  const mime = mimetype.toLowerCase();
  const isZip =
    mime === 'application/zip' ||
    mime === 'application/x-zip-compressed' ||
    mime === 'multipart/x-zip' ||
    extension === '.zip';

  return isZip ? 'accept' : 'reject';
};

describe('study upload file filter policy', () => {
  it('accepts mixed hospital-folder parts on the files field', () => {
    expect(studyFileFilterDecision('files', 'CT/IM0001.IMA', 'application/octet-stream')).toBe(
      'accept'
    );
    expect(studyFileFilterDecision('files', 'CT/preview.jpg', 'image/jpeg')).toBe('accept');
    expect(studyFileFilterDecision('files', 'README.txt', 'text/plain')).toBe('accept');
    expect(studyFileFilterDecision('files', 'DICOMDIR', 'application/octet-stream')).toBe('accept');
  });

  it('only accepts zip on the archive field', () => {
    expect(studyFileFilterDecision('archive', 'study.zip', 'application/zip')).toBe('accept');
    expect(studyFileFilterDecision('archive', 'IM0001.dcm', 'application/dicom')).toBe('reject');
    expect(studyFileFilterDecision('archive', 'notes.txt', 'text/plain')).toBe('reject');
  });
});
