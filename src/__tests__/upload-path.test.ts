import path from 'path';
import { resolveStoredFilePath, resolveUploadDir } from '../utils/uploadPath';

describe('uploadPath', () => {
  const originalEnv = process.env;
  const originalCwd = process.cwd;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.UPLOAD_DIR;
    process.cwd = () => '/app';
  });

  afterAll(() => {
    process.env = originalEnv;
    process.cwd = originalCwd;
  });

  it('defaults to ./uploads relative to cwd', () => {
    expect(resolveUploadDir()).toBe(path.resolve('/app', './uploads'));
    expect(resolveStoredFilePath('/uploads/report.pdf')).toBe(
      path.join(path.resolve('/app', './uploads'), 'report.pdf')
    );
  });

  it('resolves absolute UPLOAD_DIR by basename for reads', () => {
    process.env.UPLOAD_DIR = '/data/uploads';
    expect(resolveUploadDir()).toBe('/data/uploads');
    expect(resolveStoredFilePath('/uploads/abc-123.pdf')).toBe('/data/uploads/abc-123.pdf');
  });
});
