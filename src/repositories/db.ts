import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { query as poolQuery } from '../database/connection';

/**
 * Run parameterized SQL via the shared pool, or via a transaction client when provided.
 */
export const dbQuery = async <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
  client?: PoolClient
): Promise<QueryResult<T>> => {
  if (client) {
    return client.query<T>(text, params);
  }
  return poolQuery(text, params);
};
