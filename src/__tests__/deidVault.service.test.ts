import { query } from '../database/connection';
import {
  clearDeidVault,
  loadDeidVaultMapping,
  resolveTokenMapping,
  sealMappingForStorage,
  upsertDeidVault,
} from '../services/deidVault.service';

jest.mock('../database/connection', () => ({
  query: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;

describe('deidVault.service', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.DEID_ENABLED = 'true';
    process.env.DEID_REVERSIBLE_KEY = 'vault-unit-test-key';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('round-trips sealed mappings through upsert + load', async () => {
    const mapping = { '<PERSON_1>': 'Jane Doe', '<MRN_1>': 'AB12-3456' };
    let storedSealed: string | null = null;

    mockedQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO case_analysis_deid_vault')) {
        storedSealed = params?.[1] as string;
        return { rows: [], rowCount: 1 } as any;
      }

      if (sql.includes('SELECT sealed_mapping')) {
        return { rows: storedSealed ? [{ sealed_mapping: storedSealed }] : [], rowCount: 1 } as any;
      }

      if (sql.includes('UPDATE case_analysis_deid_vault')) {
        storedSealed = null;
        return { rows: [], rowCount: 1 } as any;
      }

      return { rows: [], rowCount: 0 } as any;
    });

    await upsertDeidVault('run-1', mapping);
    const loaded = await loadDeidVaultMapping('run-1');
    expect(loaded).toEqual(mapping);

    const sealed = sealMappingForStorage(mapping);
    expect(typeof sealed).toBe('string');
    expect(sealed).not.toContain('Jane Doe');

    await clearDeidVault('run-1');
    const afterClear = await loadDeidVaultMapping('run-1');
    expect(afterClear).toEqual({});
  });

  it('resolveTokenMapping prefers in-memory map over vault', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ sealed_mapping: 'should-not-load' }] } as any);
    const resolved = await resolveTokenMapping('run-1', { '<PERSON_1>': 'Alice' });
    expect(resolved).toEqual({ '<PERSON_1>': 'Alice' });
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('resolveTokenMapping loads vault when memory is empty', async () => {
    const mapping = { '<PERSON_1>': 'Bob' };
    const sealed = sealMappingForStorage(mapping);
    mockedQuery.mockResolvedValue({ rows: [{ sealed_mapping: sealed }] } as any);

    const resolved = await resolveTokenMapping('run-1', {});
    expect(resolved).toEqual(mapping);
  });

  it('skips vault queries when DEID_ENABLED is false', async () => {
    process.env.DEID_ENABLED = 'false';
    const resolved = await resolveTokenMapping('run-1', {});
    expect(resolved).toEqual({});
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});
