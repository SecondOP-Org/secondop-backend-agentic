import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  paginationMeta,
  parsePaginationQuery,
  splitTotalCount,
} from '../utils/pagination';
import { AppError } from '../middleware/errorHandler';

describe('pagination utils (SEC-11)', () => {
  it('defaults page and pageSize', () => {
    expect(parsePaginationQuery({})).toEqual({
      page: DEFAULT_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
      offset: 0,
    });
  });

  it('parses explicit page and pageSize', () => {
    expect(parsePaginationQuery({ page: '2', pageSize: '25' })).toEqual({
      page: 2,
      pageSize: 25,
      offset: 25,
    });
  });

  it('caps pageSize at MAX_PAGE_SIZE', () => {
    expect(parsePaginationQuery({ pageSize: String(MAX_PAGE_SIZE + 50) }).pageSize).toBe(
      MAX_PAGE_SIZE
    );
  });

  it('rejects invalid page values', () => {
    expect(() => parsePaginationQuery({ page: '0' })).toThrow(AppError);
    expect(() => parsePaginationQuery({ page: 'abc' })).toThrow(AppError);
    expect(() => parsePaginationQuery({ pageSize: '-1' })).toThrow(AppError);
  });

  it('builds pagination metadata', () => {
    expect(paginationMeta(2, 50, 120)).toEqual({ page: 2, pageSize: 50, total: 120 });
  });

  it('splits __total_count from rows', () => {
    const { rows, total } = splitTotalCount([
      { id: 'a', __total_count: '3' },
      { id: 'b', __total_count: '3' },
    ]);
    expect(total).toBe(3);
    expect(rows).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(splitTotalCount([])).toEqual({ rows: [], total: 0 });
  });
});
