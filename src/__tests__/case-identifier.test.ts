import { query } from '../database/connection';
import { isUuid, resolveCaseId } from '../utils/caseIdentifier';
import { AppError } from '../middleware/errorHandler';

jest.mock('../database/connection', () => ({
  query: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;

describe('caseIdentifier', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts canonical UUIDs without querying when they match a case id', async () => {
    const caseId = '00000000-0000-0000-0000-000000000601';
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: caseId }] } as any);

    await expect(resolveCaseId(caseId)).resolves.toBe(caseId);
    expect(isUuid(caseId)).toBe(true);
  });

  it('resolves legacy case numbers when only the SO-suffix UUID is provided', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: '6944665b-1970-4f0e-990b-4d6611fc49c2' }],
    } as any);

    await expect(resolveCaseId('43f96bb4-a058-4da6-b319-0a6bf6bc3b34')).resolves.toBe(
      '6944665b-1970-4f0e-990b-4d6611fc49c2'
    );

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('case_number = $3'),
      [
        '43f96bb4-a058-4da6-b319-0a6bf6bc3b34',
        '43f96bb4-a058-4da6-b319-0a6bf6bc3b34',
        'SO-43f96bb4-a058-4da6-b319-0a6bf6bc3b34',
      ]
    );
  });

  it('resolves case numbers to UUIDs', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: '00000000-0000-0000-0000-000000000601' }],
    } as any);

    await expect(resolveCaseId('SO-DEMO-CARDIO-001')).resolves.toBe(
      '00000000-0000-0000-0000-000000000601'
    );

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('case_number'),
      ['SO-DEMO-CARDIO-001', null, 'SO-DEMO-CARDIO-001']
    );
  });

  it('returns 404 when identifier is neither UUID nor known case number', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

    await expect(resolveCaseId('SO-MISSING')).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<AppError>);
  });

  it('returns 400 for empty identifiers', async () => {
    await expect(resolveCaseId('   ')).rejects.toMatchObject({
      statusCode: 400,
    } satisfies Partial<AppError>);
  });
});
