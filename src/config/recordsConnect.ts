/**
 * Patient records-connect feature flags (SEC-216 / FE §5).
 * Ship dark on backend: RECORDS_CONNECT_ENABLED defaults false.
 */

export const isRecordsConnectEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  (env.RECORDS_CONNECT_ENABLED || 'false').trim().toLowerCase() === 'true';

/** Active provider adapter key. synthea_mock for demo; metriport later. */
export const getRecordsConnectProvider = (env: NodeJS.ProcessEnv = process.env): string =>
  (env.RECORDS_CONNECT_PROVIDER || 'synthea_mock').trim().toLowerCase() || 'synthea_mock';

/** Mock fetch delay before lazy-complete on status poll (ms). */
export const getRecordsMockDelayMs = (env: NodeJS.ProcessEnv = process.env): number => {
  const parsed = Number.parseInt(env.RECORDS_CONNECT_MOCK_DELAY_MS || '1500', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1500;
};
