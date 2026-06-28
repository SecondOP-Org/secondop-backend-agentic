import { BaseCheckpointSaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import pool from '../../database/connection';
import logger from '../../utils/logger';

type CheckpointerFactory = () => Promise<BaseCheckpointSaver> | BaseCheckpointSaver;

let configuredFactory: CheckpointerFactory | null = null;
let postgresSaverPromise: Promise<PostgresSaver> | null = null;

const resolveCheckpointSchema = (): string => {
  const schema = process.env.LANGGRAPH_CHECKPOINT_SCHEMA || 'public';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error('LANGGRAPH_CHECKPOINT_SCHEMA must be a valid Postgres identifier.');
  }
  return schema;
};

const createPostgresSaver = async (): Promise<PostgresSaver> => {
  const schema = resolveCheckpointSchema();
  const saver = new PostgresSaver(pool, undefined, { schema });

  logger.info('Initializing LangGraph Postgres checkpointer', {
    schema,
    runtime: 'langgraph',
    checkpointer: 'PostgresSaver',
  });

  try {
    await saver.setup();
    logger.info('LangGraph Postgres checkpointer ready', {
      schema,
      runtime: 'langgraph',
      checkpointer: 'PostgresSaver',
    });
    return saver;
  } catch (error) {
    logger.error('LangGraph Postgres checkpointer setup failed', {
      schema,
      runtime: 'langgraph',
      checkpointer: 'PostgresSaver',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
};

export const getLangGraphCheckpointer = async (): Promise<BaseCheckpointSaver> => {
  if (configuredFactory) {
    return configuredFactory();
  }

  if (!postgresSaverPromise) {
    postgresSaverPromise = createPostgresSaver().catch((error) => {
      postgresSaverPromise = null;
      throw error;
    });
  }

  return postgresSaverPromise;
};

export const configureLangGraphCheckpointerFactory = (factory: CheckpointerFactory | null): void => {
  configuredFactory = factory;
};
