import { Writable } from 'stream';
import winston from 'winston';
import {
  getAnalysisLogContext,
  setAnalysisLogTraceId,
  withAnalysisLogContext,
} from '../utils/logContext';

describe('analysis log context (SEC-116)', () => {
  it('binds runId for nested async work', async () => {
    await withAnalysisLogContext({ runId: 'run-abc' }, async () => {
      expect(getAnalysisLogContext()?.runId).toBe('run-abc');
      await Promise.resolve();
      expect(getAnalysisLogContext()?.runId).toBe('run-abc');
    });
    expect(getAnalysisLogContext()?.runId).toBeUndefined();
  });

  it('keeps sticky trace_id after setAnalysisLogTraceId', async () => {
    await withAnalysisLogContext({ runId: 'run-1' }, async () => {
      setAnalysisLogTraceId('trace-hex-1');
      expect(getAnalysisLogContext()?.traceId).toBe('trace-hex-1');
    });
  });

  it('injects runId and trace_id into winston metadata', async () => {
    const { default: logger } = await import('../utils/logger');
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const transport = new winston.transports.Stream({ stream });
    logger.add(transport);

    try {
      await withAnalysisLogContext({ runId: 'run-xyz' }, async () => {
        setAnalysisLogTraceId('aabbccddeeff00112233445566778899');
        logger.info('analysis path probe');
      });
    } finally {
      logger.remove(transport);
    }

    const hit = lines.map((line) => JSON.parse(line) as Record<string, unknown>).find(
      (row) => row.message === 'analysis path probe'
    );
    expect(hit).toBeDefined();
    expect(hit?.runId).toBe('run-xyz');
    expect(hit?.trace_id).toBe('aabbccddeeff00112233445566778899');
  });

  it('omits trace_id when Phoenix/context has none', async () => {
    const { default: logger } = await import('../utils/logger');
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const transport = new winston.transports.Stream({ stream });
    logger.add(transport);

    try {
      await withAnalysisLogContext({ runId: 'run-no-trace' }, async () => {
        logger.info('no trace probe');
      });
    } finally {
      logger.remove(transport);
    }

    const hit = lines.map((line) => JSON.parse(line) as Record<string, unknown>).find(
      (row) => row.message === 'no trace probe'
    );
    expect(hit?.runId).toBe('run-no-trace');
    expect(hit?.trace_id).toBeUndefined();
  });
});
