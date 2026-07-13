import { query } from '../database/connection';
import logger from '../utils/logger';
import {
  DeidentificationMapping,
  unsealMapping,
} from './deidentification.service';
import { encryptPayload } from './presidio.client';
import { getPresidioConfig } from './presidioConfig.service';

const ALGORITHM = 'aes-256-gcm';

export const assertDeidentificationReady = (): void => {
  const config = getPresidioConfig();
  if (!config.enabled) {
    return;
  }

  if (!config.reversibleKeyConfigured) {
    throw new Error(
      'DEID_ENABLED=true requires DEID_REVERSIBLE_KEY so token maps can be sealed for crash-safe re-identification.'
    );
  }
};

export const sealMappingForStorage = (mapping: DeidentificationMapping): string => {
  assertDeidentificationReady();
  const secret = process.env.DEID_REVERSIBLE_KEY?.trim();
  if (!secret) {
    throw new Error('DEID_REVERSIBLE_KEY is not configured.');
  }

  return encryptPayload(JSON.stringify(mapping), secret);
};

export const upsertDeidVault = async (
  runId: string,
  mapping: DeidentificationMapping
): Promise<void> => {
  if (!runId || Object.keys(mapping).length === 0) {
    return;
  }

  assertDeidentificationReady();
  const sealed = sealMappingForStorage(mapping);
  const entityCount = Object.keys(mapping).length;

  await query(
    `INSERT INTO case_analysis_deid_vault (run_id, sealed_mapping, algorithm, entity_count, created_at, updated_at, cleared_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
     ON CONFLICT (run_id) DO UPDATE
       SET sealed_mapping = EXCLUDED.sealed_mapping,
           algorithm = EXCLUDED.algorithm,
           entity_count = EXCLUDED.entity_count,
           updated_at = CURRENT_TIMESTAMP,
           cleared_at = NULL`,
    [runId, sealed, ALGORITHM, entityCount]
  );

  logger.info('Persisted sealed de-identification vault for analysis run', {
    runId,
    entityCount,
    algorithm: ALGORITHM,
  });
};

export const loadDeidVaultMapping = async (runId: string): Promise<DeidentificationMapping> => {
  if (!runId) {
    return {};
  }

  const result = await query(
    `SELECT sealed_mapping
     FROM case_analysis_deid_vault
     WHERE run_id = $1
       AND sealed_mapping IS NOT NULL
       AND cleared_at IS NULL
     LIMIT 1`,
    [runId]
  );

  const sealed = result.rows[0]?.sealed_mapping;
  if (typeof sealed !== 'string' || !sealed) {
    return {};
  }

  return unsealMapping(sealed);
};

export const clearDeidVault = async (runId: string): Promise<void> => {
  if (!runId) {
    return;
  }

  await query(
    `UPDATE case_analysis_deid_vault
     SET sealed_mapping = NULL,
         cleared_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE run_id = $1
       AND cleared_at IS NULL`,
    [runId]
  );

  logger.info('Cleared sealed de-identification vault after successful re-identify', {
    runId,
  });
};

/**
 * Resolve the token map for clinician re-identify:
 * prefer in-memory map; fall back to durable sealed vault by runId.
 */
export const resolveTokenMapping = async (
  runId: string | undefined,
  inMemory: DeidentificationMapping
): Promise<DeidentificationMapping> => {
  if (Object.keys(inMemory).length > 0) {
    return inMemory;
  }

  if (!runId) {
    return {};
  }

  const fromVault = await loadDeidVaultMapping(runId);
  if (Object.keys(fromVault).length > 0) {
    logger.info('Loaded de-identification mapping from durable vault', {
      runId,
      entityCount: Object.keys(fromVault).length,
    });
  }

  return fromVault;
};
