import path from 'path';
import winston from 'winston';
import { getAnalysisLogContext } from './logContext';

const logLevel = process.env.LOG_LEVEL || 'info';

/** Injects `runId` / `trace_id` from the active analysis log context (SEC-116). Ids only, no PHI. */
export const injectAnalysisLogContext = winston.format((info) => {
  const context = getAnalysisLogContext();
  if (context?.runId) {
    info.runId = context.runId;
  }
  if (context?.traceId) {
    info.trace_id = context.traceId;
  }
  return info;
});

const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.printf(({ level, message, timestamp, ...metadata }) => {
      let msg = `${timestamp} [${level}]: ${message}`;
      if (Object.keys(metadata).length > 0) {
        msg += ` ${JSON.stringify(metadata)}`;
      }
      return msg;
    })
  ),
});

const transports: winston.transport[] = [consoleTransport];

if (process.env.NODE_ENV !== 'test') {
  transports.push(
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      level: 'error',
    })
  );

  transports.push(
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'combined.log'),
    })
  );
}

const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    injectAnalysisLogContext(),
    winston.format.json()
  ),
  defaultMeta: { service: 'secondop-api' },
  transports,
});

export default logger;
