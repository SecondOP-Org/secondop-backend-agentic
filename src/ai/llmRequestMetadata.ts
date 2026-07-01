import crypto from 'crypto';
import { getLlmGatewayConfig } from './llmGateway';

export interface LlmRequestMetadataInput {
  workflow: string;
  modelAlias: string;
  requestId?: string | null;
  caseId?: string | null;
  runId?: string | null;
}

const hashIdentifier = (value?: string | null): string | undefined => {
  if (!value) {
    return undefined;
  }

  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
};

export const buildLlmRequestMetadata = (input: LlmRequestMetadataInput): Record<string, string> => {
  const gateway = getLlmGatewayConfig();
  const metadata: Record<string, string> = {
    workflow: input.workflow,
    environment: process.env.APP_ENV || process.env.NODE_ENV || 'development',
    gateway_mode: gateway.mode,
    model_alias: input.modelAlias,
  };

  if (input.requestId) {
    metadata.request_id = input.requestId;
  }

  const caseHash = hashIdentifier(input.caseId);
  if (caseHash) {
    metadata.case_hash = caseHash;
  }

  const runHash = hashIdentifier(input.runId);
  if (runHash) {
    metadata.run_hash = runHash;
  }

  return metadata;
};
