import { AppError } from '../../middleware/errorHandler';
import { getRecordsConnectProvider } from '../../config/recordsConnect';
import type { RecordsProvider } from './recordsProvider';
import { syntheaMockProvider } from './synthea.provider';

/**
 * Resolve the active records provider. Metriport (etc.) registers here later.
 */
export const getActiveRecordsProvider = (
  env: NodeJS.ProcessEnv = process.env
): RecordsProvider => {
  const key = getRecordsConnectProvider(env);
  if (key === 'synthea_mock' || key === 'synthea') {
    return syntheaMockProvider;
  }

  // Future: metriport → metriportProvider
  throw new AppError(`Records connect provider is not configured: ${key}`, 501);
};
