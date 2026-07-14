import { AppError } from '../middleware/errorHandler';

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export interface PaginationParams {
  page: number;
  pageSize: number;
  offset: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
}

const parsePositiveInt = (value: unknown, field: string): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (Array.isArray(value)) {
    throw new AppError(`${field} must be a single integer`, 400);
  }

  const raw = typeof value === 'number' ? String(value) : String(value);
  if (!/^\d+$/.test(raw)) {
    throw new AppError(`${field} must be a positive integer`, 400);
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new AppError(`${field} must be a positive integer`, 400);
  }

  return parsed;
};

/**
 * Parse `page` / `pageSize` query params for list endpoints.
 * Defaults: page=1, pageSize=50. Caps pageSize at MAX_PAGE_SIZE.
 */
export const parsePaginationQuery = (query: {
  page?: unknown;
  pageSize?: unknown;
}): PaginationParams => {
  const page = parsePositiveInt(query.page, 'page') ?? DEFAULT_PAGE;
  let pageSize = parsePositiveInt(query.pageSize, 'pageSize') ?? DEFAULT_PAGE_SIZE;

  if (pageSize > MAX_PAGE_SIZE) {
    pageSize = MAX_PAGE_SIZE;
  }

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
};

export const paginationMeta = (
  page: number,
  pageSize: number,
  total: number
): PaginationMeta => ({
  page,
  pageSize,
  total,
});

/**
 * Split rows that include a `COUNT(*) OVER() AS __total_count` column.
 */
export const splitTotalCount = <T extends Record<string, unknown>>(
  rows: T[]
): { rows: Array<Omit<T, '__total_count'>>; total: number } => {
  if (rows.length === 0) {
    return { rows: [], total: 0 };
  }

  const totalRaw = rows[0].__total_count;
  const total = typeof totalRaw === 'string' ? Number.parseInt(totalRaw, 10) : Number(totalRaw);

  return {
    total: Number.isFinite(total) ? total : 0,
    rows: rows.map(({ __total_count: _ignored, ...rest }) => rest),
  };
};
