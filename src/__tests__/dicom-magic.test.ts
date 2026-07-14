import { isDicomMagicBuffer } from '../utils/dicomMagic';

describe('isDicomMagicBuffer', () => {
  it('returns true when bytes 128-131 are DICM', () => {
    const buffer = Buffer.alloc(132, 0);
    buffer.write('DICM', 128, 'ascii');
    expect(isDicomMagicBuffer(buffer)).toBe(true);
  });

  it('returns false for short buffers and non-DICOM content', () => {
    expect(isDicomMagicBuffer(Buffer.alloc(10))).toBe(false);
    const buffer = Buffer.alloc(132, 0);
    buffer.write('TEST', 128, 'ascii');
    expect(isDicomMagicBuffer(buffer)).toBe(false);
  });
});
