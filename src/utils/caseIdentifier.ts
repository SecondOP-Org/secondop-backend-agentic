import { query } from '../database/connection';
import { AppError } from '../middleware/errorHandler';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID_REGEX.test(value.trim());

export const resolveCaseId = async (identifier: string): Promise<string> => {
  const trimmed = identifier.trim();

  if (!trimmed) {
    throw new AppError('Case ID is required', 400);
  }

  const legacySoCaseNumber = trimmed.startsWith('SO-') ? trimmed : isUuid(trimmed) ? `SO-${trimmed}` : null;

  const result = await query(
    `SELECT id
     FROM cases
     WHERE case_number = $1
        OR UPPER(case_number) = UPPER($1)
        OR ($2::uuid IS NOT NULL AND id = $2::uuid)
        OR ($3::text IS NOT NULL AND (case_number = $3 OR UPPER(case_number) = UPPER($3)))
     LIMIT 1`,
    [trimmed, isUuid(trimmed) ? trimmed : null, legacySoCaseNumber]
  );

  if (result.rows.length === 0) {
    throw new AppError(
      'Case not found. Use the case UUID or case number (for example, SO-ABC12345).',
      404
    );
  }

  return String(result.rows[0].id);
};
