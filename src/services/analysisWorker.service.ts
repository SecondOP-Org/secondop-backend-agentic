import PgBoss from 'pg-boss';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { AgentError } from '../agents/core/agent.types';
import { AgenticError } from '../agentic/core/types';
import { runCaseAnalysis } from '../agents/case-analysis/runCaseAnalysis';
import {
  isAgenticPrimaryMode,
  resolveExecutionMode,
  shouldRunShadowAgentic,
} from '../agentic/core/policy';
import type { AnalysisExecutionMode } from '../agentic/core/executionMode';
import { runAgenticCaseAnalysis } from '../agentic/orchestration/runAgenticCaseAnalysis';
import { startPhoenixSpan, estimateTokenCostUsd } from '../observability/phoenix.service';
import { getAnalysisRunVersionMetadata } from './analysisVersioning';
import {
  AnalysisRunCompletionMetadata,
  createAnalysisRun,
  getLatestActiveAnalysisRun,
  markAnalysisRunFailed,
  markAnalysisRunProcessing,
  markAnalysisRunQueued,
  markAnalysisRunSucceeded,
} from './analysisRun.service';
import type { AnalysisRunEngine } from './analysisRun.service';
import {
  buildShadowComparisonMetrics,
  insertCaseAnalysisArtifact,
} from './caseAnalysisRunArtifact.service';
import { clearDeidVault } from './deidVault.service';

const maxCharsPerFile = parseInt(process.env.ANALYSIS_MAX_CHARS_PER_FILE || '12000', 10);
const maxTotalChars = parseInt(process.env.ANALYSIS_MAX_TOTAL_CHARS || '30000', 10);
const queueName = process.env.ANALYSIS_QUEUE_NAME || 'case-analysis-baseline';

interface AnalysisQueueJob {
  caseId: string;
  runId: string;
}

interface QueueCaseResult {
  analysisRunId: string;
  analysisStatus: 'queued' | 'processing';
}

const getPrimaryRunEngine = (mode: AnalysisExecutionMode): AnalysisRunEngine =>
  isAgenticPrimaryMode(mode) ? 'agentic' : 'baseline';

const buildAgenticCompletionMetadata = (
  model: string,
  metrics?: {
    totalTokenUsage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
  }
): AnalysisRunCompletionMetadata => ({
  model,
  modelVersion: model,
  promptTokens: metrics?.totalTokenUsage?.promptTokens ?? null,
  completionTokens: metrics?.totalTokenUsage?.completionTokens ?? null,
  totalTokens: metrics?.totalTokenUsage?.totalTokens ?? null,
});

class AnalysisWorker {
  private boss: PgBoss | null = null;
  private startPromise: Promise<void> | null = null;

  private buildConnectionString(): string {
    if (process.env.DATABASE_URL) {
      return process.env.DATABASE_URL;
    }

    const host = process.env.DB_HOST || 'localhost';
    const port = process.env.DB_PORT || '5432';
    const database = process.env.DB_NAME || 'secondop_db';
    const user = encodeURIComponent(process.env.DB_USER || 'postgres');
    const password = process.env.DB_PASSWORD ? encodeURIComponent(process.env.DB_PASSWORD) : '';
    const auth = password ? `${user}:${password}` : user;
    const sslSuffix = process.env.DB_SSL === 'true' ? '?sslmode=require' : '';

    return `postgres://${auth}@${host}:${port}/${database}${sslSuffix}`;
  }

  private buildBoss(): PgBoss {
    return new PgBoss({
      schema: process.env.ANALYSIS_QUEUE_SCHEMA || 'pgboss',
      connectionString: this.buildConnectionString(),
    });
  }

  private async ensureStarted(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    this.startPromise = (async () => {
      this.boss = this.buildBoss();
      this.boss.on('error', (error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`pg-boss error: ${message}`);
      });

      await this.boss.start();
      await this.boss.createQueue(queueName);

      await this.boss.work(queueName, async (jobs) => {
        for (const job of jobs) {
          const payload = job.data as AnalysisQueueJob | undefined;
          if (!payload?.caseId || !payload?.runId) {
            logger.error('Invalid analysis queue payload received; skipping job');
            continue;
          }

          await this.processCase(payload);
        }
      });

      logger.info(`Analysis queue worker started on queue '${queueName}'`);
    })();

    await this.startPromise;
  }

  private async enqueue(job: AnalysisQueueJob): Promise<void> {
    await this.ensureStarted();
    await this.boss!.send(queueName, job);
  }

  public async recoverInterruptedJobs(): Promise<void> {
    await this.ensureStarted();
    const mode = resolveExecutionMode();
    const primaryEngine = getPrimaryRunEngine(mode);

    const result = await query(
      `SELECT id, analysis_status
       FROM cases
       WHERE analysis_status IN ('queued', 'processing')`
    );

    const rows = result.rows as Array<{ id: string; analysis_status: string }>;

    for (const row of rows) {
      let run = await getLatestActiveAnalysisRun(row.id, primaryEngine);

      if (row.analysis_status === 'processing') {
        await query(
          `UPDATE cases
           SET analysis_status = 'queued',
               analysis_error = 'Recovered after server restart while processing.',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [row.id]
        );

        if (run && run.status === 'processing') {
          await markAnalysisRunQueued(run.id, 'Recovered after server restart while processing.');
          run = {
            ...run,
            status: 'queued',
          };
        }
      }

      if (!run) {
        run = await createAnalysisRun(row.id, 'queued', primaryEngine, mode);
      }

      await this.enqueue({
        caseId: row.id,
        runId: run.id,
      });
    }

    const queuedRuns = await query(
      `SELECT id, case_id
       FROM case_analysis_runs
       WHERE engine = $1 AND status = 'queued'
       ORDER BY created_at ASC
       LIMIT 500`,
      [primaryEngine]
    );

    for (const run of queuedRuns.rows as Array<{ id: string; case_id: string }>) {
      await this.enqueue({
        caseId: run.case_id,
        runId: run.id,
      });
    }

    if (rows.length > 0 || queuedRuns.rows.length > 0) {
      logger.info(
        `Recovered ${rows.length} case(s) and re-enqueued ${queuedRuns.rows.length} queued ${primaryEngine} run(s)`
      );
    }
  }

  public async queueCase(caseId: string): Promise<QueueCaseResult> {
    await this.ensureStarted();

    const mode = resolveExecutionMode();
    const primaryEngine = getPrimaryRunEngine(mode);
    const activeRun = await getLatestActiveAnalysisRun(caseId, primaryEngine);
    if (activeRun) {
      if (activeRun.status === 'queued') {
        await this.enqueue({
          caseId,
          runId: activeRun.id,
        });
      }

      return {
        analysisRunId: activeRun.id,
        analysisStatus: activeRun.status === 'processing' ? 'processing' : 'queued',
      };
    }

    await query(
      `UPDATE cases
       SET analysis_status = 'queued',
           analysis_error = NULL,
           analysis_summary = NULL,
           analysis_questions = NULL,
           analysis_artifact = NULL,
           analysis_model = NULL,
           analysis_started_at = NULL,
           analysis_completed_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [caseId]
    );

    const run = await createAnalysisRun(caseId, 'queued', primaryEngine, mode);

    await this.enqueue({
      caseId,
      runId: run.id,
    });

    return {
      analysisRunId: run.id,
      analysisStatus: 'queued',
    };
  }

  private async processAgenticPrimaryCase(job: AnalysisQueueJob, mode: AnalysisExecutionMode): Promise<void> {
    const { caseId, runId } = job;
    const versions = getAnalysisRunVersionMetadata();
    const runStartedAt = Date.now();
    const agenticRunSpan = startPhoenixSpan(
      'analysis.agentic.run',
      {
        caseId,
        runId,
        mode,
        engine: 'agentic',
        execution_mode: mode,
        pipeline_version: versions.pipelineVersion,
        prompt_version: versions.promptVersion,
      },
      'CHAIN'
    );

    try {
      await agenticRunSpan.run(async () => {
        const claimedRun = await markAnalysisRunProcessing(runId);
        if (!claimedRun) {
          logger.info(`Skipping analysis run ${runId} for case ${caseId}; already claimed by another worker.`);
          return;
        }

        await query(
          `UPDATE cases
           SET analysis_status = 'processing',
               analysis_error = NULL,
               analysis_started_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [caseId]
        );

        const agenticResult = await runAgenticCaseAnalysis({
          caseId,
          runId,
          mode,
          maxCharsPerFile,
          maxTotalChars,
        });

        const promptTokens = agenticResult.metrics?.totalTokenUsage?.promptTokens ?? 0;
        const completionTokens = agenticResult.metrics?.totalTokenUsage?.completionTokens ?? 0;
        const totalTokens = agenticResult.metrics?.totalTokenUsage?.totalTokens ?? promptTokens + completionTokens;
        const estimatedCostUsd = estimateTokenCostUsd(promptTokens, completionTokens);

        await markAnalysisRunSucceeded(runId, {
          ...buildAgenticCompletionMetadata(agenticResult.artifact.model, agenticResult.metrics),
          estimatedCostUsd,
        });

        await query(
          `UPDATE cases
           SET analysis_status = 'succeeded',
               analysis_summary = $2,
               analysis_questions = $3,
               analysis_artifact = $4,
               analysis_model = $5,
               analysis_error = NULL,
               analysis_completed_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [
            caseId,
            agenticResult.artifact.summary,
            JSON.stringify(agenticResult.artifact.questions),
            JSON.stringify(agenticResult.artifact.artifact),
            agenticResult.artifact.model,
          ]
        );

        await clearDeidVault(runId);

        agenticRunSpan.addAttributes({
          latency_ms: Date.now() - runStartedAt,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          estimated_cost_usd: estimatedCostUsd,
        });

        logger.info(`Agentic analysis completed for case ${caseId} (run ${runId}, mode ${mode})`);
      });

      agenticRunSpan.end('OK');
    } catch (error) {
      const errorMessage =
        error instanceof AgenticError
          ? `[${error.code}] ${error.message}`
          : error instanceof Error
            ? error.message
            : 'Unknown agentic analysis error';

      await query(
        `UPDATE cases
         SET analysis_status = 'failed',
             analysis_summary = NULL,
             analysis_questions = NULL,
             analysis_artifact = NULL,
             analysis_model = NULL,
             analysis_error = $2,
             analysis_completed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [caseId, errorMessage]
      );

      try {
        await markAnalysisRunFailed(runId, errorMessage);
      } catch (runError) {
        const runErrorMessage = runError instanceof Error ? runError.message : String(runError);
        logger.error(`Failed updating analysis run ${runId} status: ${runErrorMessage}`);
      }

      agenticRunSpan.addAttributes({ latency_ms: Date.now() - runStartedAt });
      agenticRunSpan.end('ERROR', errorMessage);
      logger.error(`Agentic mode failed for case ${caseId}: ${errorMessage}`);
      throw error;
    }
  }

  private async processCase(job: AnalysisQueueJob): Promise<void> {
    const { caseId, runId } = job;
    const mode = resolveExecutionMode();
    const primaryEngine = getPrimaryRunEngine(mode);

    if (primaryEngine === 'agentic') {
      await this.processAgenticPrimaryCase(job, mode);
      return;
    }

    const versions = getAnalysisRunVersionMetadata();
    const baselineStartedAt = Date.now();
    const baselineRunSpan = startPhoenixSpan(
      'analysis.baseline.run',
      {
        caseId,
        runId,
        mode,
        engine: 'baseline',
        execution_mode: mode,
        pipeline_version: versions.pipelineVersion,
        prompt_version: versions.promptVersion,
      },
      'CHAIN'
    );

    try {
      await baselineRunSpan.run(async () => {
        const claimedBaselineRun = await markAnalysisRunProcessing(runId);
        if (!claimedBaselineRun) {
          logger.info(`Skipping analysis run ${runId} for case ${caseId}; already claimed by another worker.`);
          return;
        }

        await query(
          `UPDATE cases
           SET analysis_status = 'processing',
               analysis_error = NULL,
               analysis_started_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [caseId]
        );

        const pipelineState = await runCaseAnalysis({
          caseId,
          runId,
          maxCharsPerFile,
          maxTotalChars,
          executionMode: mode,
        });

        const baselinePrompt = pipelineState.analysis?.usage?.promptTokens ?? 0;
        const baselineCompletion = pipelineState.analysis?.usage?.completionTokens ?? 0;
        const baselineTotal = pipelineState.analysis?.usage?.totalTokens ?? baselinePrompt + baselineCompletion;
        baselineRunSpan.addAttributes({
          latency_ms: Date.now() - baselineStartedAt,
          prompt_tokens: baselinePrompt,
          completion_tokens: baselineCompletion,
          total_tokens: baselineTotal,
          estimated_cost_usd: estimateTokenCostUsd(baselinePrompt, baselineCompletion),
        });

        logger.info(`Baseline analysis completed for case ${caseId} (run ${runId})`);

        if (!shouldRunShadowAgentic(mode)) {
          return;
        }

        const agenticRun = await createAnalysisRun(caseId, 'queued', 'agentic', mode);
        const agenticStartedAt = Date.now();
        const agenticRunSpan = startPhoenixSpan(
          'analysis.agentic.run',
          {
            caseId,
            runId: agenticRun.id,
            mode,
            engine: 'agentic',
            execution_mode: mode,
            pipeline_version: versions.pipelineVersion,
            prompt_version: versions.promptVersion,
          },
          'CHAIN'
        );
        const claimedAgenticRun = await markAnalysisRunProcessing(agenticRun.id);
        if (!claimedAgenticRun) {
          throw new Error(`Agentic run ${agenticRun.id} could not be claimed for processing.`);
        }

        try {
          await agenticRunSpan.run(async () => {
            const agenticResult = await runAgenticCaseAnalysis({
              caseId,
              runId: agenticRun.id,
              mode,
              maxCharsPerFile,
              maxTotalChars,
            });

            const promptTokens = agenticResult.metrics?.totalTokenUsage?.promptTokens ?? 0;
            const completionTokens = agenticResult.metrics?.totalTokenUsage?.completionTokens ?? 0;
            const totalTokens =
              agenticResult.metrics?.totalTokenUsage?.totalTokens ?? promptTokens + completionTokens;
            const estimatedCostUsd = estimateTokenCostUsd(promptTokens, completionTokens);

            await markAnalysisRunSucceeded(agenticRun.id, {
              ...buildAgenticCompletionMetadata(agenticResult.artifact.model, agenticResult.metrics),
              estimatedCostUsd,
            });
            await clearDeidVault(agenticRun.id);

            agenticRunSpan.addAttributes({
              latency_ms: Date.now() - agenticStartedAt,
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: totalTokens,
              estimated_cost_usd: estimatedCostUsd,
            });

            if (pipelineState.analysis) {
              const comparison = buildShadowComparisonMetrics({
                baselineRunId: runId,
                agenticRunId: agenticRun.id,
                baselineAnalysis: pipelineState.analysis,
                agenticSummary: agenticResult.artifact.summary,
                agenticQuestions: agenticResult.artifact.questions,
                agenticModel: agenticResult.artifact.model,
                criticPassed: agenticResult.criticScore?.passed ?? null,
                criticScore: agenticResult.criticScore?.score ?? null,
              });

              await insertCaseAnalysisArtifact({
                runId,
                caseId,
                artifactType: 'final',
                stageName: 'shadow-comparison',
                engine: 'baseline',
                payload: comparison as unknown as Record<string, unknown>,
              });
            }

            logger.info(
              `Agentic shadow analysis completed for case ${caseId} (run ${agenticRun.id}, mode ${mode})`
            );
          });
          agenticRunSpan.end('OK');
        } catch (agenticError) {
          const agenticMessage =
            agenticError instanceof Error ? agenticError.message : 'Unknown agentic analysis error';

          await markAnalysisRunFailed(agenticRun.id, agenticMessage);
          agenticRunSpan.addAttributes({ latency_ms: Date.now() - agenticStartedAt });
          agenticRunSpan.end('ERROR', agenticMessage);
          logger.error(`Agentic shadow mode failed for case ${caseId}: ${agenticMessage}`);
        }

        if (pipelineState.analysis) {
          logger.info(`Baseline output retained for case ${caseId} after shadow agentic run`, {
            baselineModel: pipelineState.analysis.model,
          });
        }
      });

      baselineRunSpan.end('OK');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown analysis error';
      const message = error instanceof AgentError ? `[${error.code}] ${errorMessage}` : errorMessage;

      baselineRunSpan.addAttributes({ latency_ms: Date.now() - baselineStartedAt });
      baselineRunSpan.end('ERROR', message);

      await query(
        `UPDATE cases
         SET analysis_status = 'failed',
             analysis_error = $2,
             analysis_completed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [caseId, message]
      );

      try {
        await markAnalysisRunFailed(runId, message);
      } catch (runError) {
        const runErrorMessage = runError instanceof Error ? runError.message : String(runError);
        logger.error(`Failed updating analysis run ${runId} status: ${runErrorMessage}`);
      }

      logger.error(`Analysis failed for case ${caseId} (run ${runId}): ${message}`);
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    if (!this.boss) {
      return;
    }

    await this.boss.stop();
    logger.info('Analysis queue worker stopped');
    this.boss = null;
    this.startPromise = null;
  }
}

export const analysisWorker = new AnalysisWorker();
