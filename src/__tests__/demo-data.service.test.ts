import { ensureDemoData } from '../services/demoData.service';
import { query } from '../database/connection';

jest.mock('../database/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('ensureDemoData', () => {
  const originalEnsureFlag = process.env.ENSURE_DEMO_DATA;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ENSURE_DEMO_DATA;
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  afterAll(() => {
    if (originalEnsureFlag === undefined) {
      delete process.env.ENSURE_DEMO_DATA;
    } else {
      process.env.ENSURE_DEMO_DATA = originalEnsureFlag;
    }
  });

  it('skips bootstrap when ENSURE_DEMO_DATA=false', async () => {
    process.env.ENSURE_DEMO_DATA = 'false';

    await ensureDemoData();

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('upserts demo users, doctors, patient profile, and case assignments', async () => {
    await ensureDemoData();

    expect(mockQuery).toHaveBeenCalledTimes(4);
    expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO users');
    expect(mockQuery.mock.calls[1][0]).toContain('INSERT INTO doctors');
    expect(mockQuery.mock.calls[2][0]).toContain('INSERT INTO patients');
    expect(mockQuery.mock.calls[3][0]).toContain('INSERT INTO case_assignments');
  });
});
