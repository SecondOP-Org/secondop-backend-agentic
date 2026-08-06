import { parseCorsOrigins } from '../config/cors';

describe('parseCorsOrigins', () => {
  it('falls back to the local frontend when no origin is configured', () => {
    expect(parseCorsOrigins()).toBe('http://localhost:8080');
    expect(parseCorsOrigins('   ')).toBe('http://localhost:8080');
  });

  it('returns a single origin as a string', () => {
    expect(parseCorsOrigins('https://secondop.ai')).toBe('https://secondop.ai');
  });

  it('returns multiple comma-separated origins as an array', () => {
    expect(parseCorsOrigins('https://secondop.ai, https://secondop-staging.vercel.app')).toEqual([
      'https://secondop.ai',
      'https://secondop-staging.vercel.app',
    ]);
  });
});
