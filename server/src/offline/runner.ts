/**
 * Offline task runner.
 * Executes batch jobs by id.
 */

import { runDailyCrawl, formatDailyReport } from '../dailyCrawler.js';
import { runIncrementalPrecompute, runUserEmbeddingRefresh } from '../recommendPrecompute.js';
import { runDailyVocabStoryGeneration } from '../dailyVocabStory.js';
import { runArticleAudioBatch } from '../articleAudioBatch.js';
import { runDailyEventAggregation } from '../dailyEventAggregation.js';
import { runDailyUserProfileUpdate } from '../dailyUserProfileUpdate.js';
import { getArticleIdsCreatedSince } from '../repositories/articleRepo.js';
import {
  startDailyPipelineRun,
  resetDailyPipelineRun,
  getDailyPipelineRun,
  parseDailySteps,
  markDailyStep,
  finishDailyPipelineRun,
} from '../repositories/dailyPipelineRunRepo.js';
import { getExecutionOrder } from './registry.js';
import fs from 'fs';

export type TaskResult =
  | { ok: true; taskId: string; data: unknown }
  | { ok: false; taskId: string; error: string };

export async function runTask(
  taskId: string,
  options?: { userId?: string; daysBack?: number; date?: string }
): Promise<TaskResult> {
  switch (taskId) {
    case 'daily-crawl': {
      const result = await runDailyCrawl();
      return {
        ok: true,
        taskId,
        data: {
          ingested: result.ingested,
          skipped: result.skipped,
          errors: result.errors,
          byCategory: result.byCategory,
          durationMs: result.durationMs,
          dailyReport: formatDailyReport(result),
        },
      };
    }

    case 'user-embedding-refresh': {
      const r = await runUserEmbeddingRefresh();
      return {
        ok: true,
        taskId,
        data: { usersProcessed: r.usersProcessed, refreshed: r.refreshed },
      };
    }

    case 'recommend-precompute': {
      const daysBack = options?.daysBack ?? 3;
      const r = await runIncrementalPrecompute(daysBack);
      return {
        ok: true,
        taskId,
        data: {
          usersProcessed: r.usersProcessed,
          articlesScored: r.articlesScored,
          newArticleIds: r.newArticleIds,
        },
      };
    }

    case 'vocab-story': {
      const r = await runDailyVocabStoryGeneration({ userId: options?.userId });
      return {
        ok: true,
        taskId,
        data: {
          generated: r.generated,
          skipped: r.skipped,
          errors: r.errors,
        },
      };
    }

    case 'article-audio': {
      const r = await runArticleAudioBatch();
      return {
        ok: true,
        taskId,
        data: {
          generated: r.generated,
          skipped: r.skipped,
          errors: r.errors.slice(0, 10),
        },
      };
    }

    case 'events-daily-agg': {
      const date = (options as { date?: string } | undefined)?.date;
      const r = await runDailyEventAggregation({ date });
      return {
        ok: true,
        taskId,
        data: r,
      };
    }

    case 'user-profile-daily': {
      const date = (options as { date?: string } | undefined)?.date;
      const r = await runDailyUserProfileUpdate({ snapshotDate: date });
      return {
        ok: true,
        taskId,
        data: r,
      };
    }

    default:
      return { ok: false, taskId, error: `Unknown task: ${taskId}` };
  }
}

/**
 * Run task with all dependencies first (topological order).
 * Use for single-task triggers (CLI, HTTP) to ensure deps are satisfied.
 */
export async function runTaskWithDeps(
  taskId: string,
  options?: { userId?: string; daysBack?: number; skipDeps?: boolean; date?: string }
): Promise<TaskResult> {
  if (options?.skipDeps) {
    return runTask(taskId, options);
  }
  const order = getExecutionOrder(taskId);
  if (order.length <= 1) {
    return runTask(taskId, options);
  }
  const depIds = order.slice(0, -1);
  const targetId = order[order.length - 1];
  for (const id of depIds) {
    const r = await runTask(id);
    if (!r.ok) {
      return { ok: false, taskId, error: `Dependency ${id} failed: ${r.error}` };
    }
  }
  return runTask(targetId, options);
}

/**
 * Run daily pipeline: crawl → user-embedding-refresh → vocab-story → precompute.
 * article-audio runs separately at 2am.
 */
export async function runDailyPipeline(options?: { date?: string; resume?: boolean; reset?: boolean }): Promise<{
  crawl: TaskResult;
  eventsAgg?: TaskResult;
  profileDaily?: TaskResult;
  embeddingRefresh?: TaskResult;
  vocabStory?: TaskResult;
  precompute?: TaskResult;
}> {
  const rssMb = () => Math.round(process.memoryUsage().rss / 1024 / 1024);
  const readMemoryLimitMb = (): number | null => {
    const flyVmMemory = Number(process.env.FLY_VM_MEMORY_MB || '');
    if (Number.isFinite(flyVmMemory) && flyVmMemory > 0) {
      return Math.round(flyVmMemory);
    }
    const candidates = [
      '/sys/fs/cgroup/memory.max',
      '/sys/fs/cgroup/memory/memory.limit_in_bytes',
    ];
    for (const path of candidates) {
      try {
        if (!fs.existsSync(path)) continue;
        const raw = fs.readFileSync(path, 'utf8').trim();
        if (!raw || raw === 'max') continue;
        const bytes = Number(raw);
        if (!Number.isFinite(bytes) || bytes <= 0) continue;
        const mb = Math.round(bytes / 1024 / 1024);
        // Some runtimes expose host-level limits here (e.g. multi-TB), which
        // are not the VM cgroup limit we need for safety decisions.
        if (mb > 65536) continue;
        return mb;
      } catch {
        //
      }
    }
    return null;
  };
  const memoryLimitMb = readMemoryLimitMb();
  const autoLowMemory = memoryLimitMb !== null && memoryLimitMb <= 384;
  const forceSkipHeavy = process.env.DAILY_SKIP_HEAVY === '1';
  const skipHeavy = forceSkipHeavy || autoLowMemory;

  const opts = options || {};
  const runDate = opts.date || new Date().toISOString().split('T')[0];
  const resume = opts.resume === true;
  const reset = opts.reset === true;
  if (reset) {
    resetDailyPipelineRun(runDate);
  }
  startDailyPipelineRun(runDate, resume);
  const existing = getDailyPipelineRun(runDate);
  const doneSteps = parseDailySteps(existing?.steps_json);

  const runStep = async (stepId: string, fn: () => Promise<TaskResult>): Promise<TaskResult> => {
    const alreadyOk = doneSteps[stepId]?.status === 'success';
    if (resume && alreadyOk) {
      console.log(`[Offline] Resume: skip finished step ${stepId}`);
      return { ok: true, taskId: stepId, data: { resumed: true, skipped: true } };
    }
    try {
      const result = await fn();
      if (result.ok) {
        markDailyStep(runDate, stepId, 'success');
      } else {
        markDailyStep(runDate, stepId, 'failed', result.error);
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Task failed';
      markDailyStep(runDate, stepId, 'failed', msg);
      return { ok: false, taskId: stepId, error: msg };
    }
  };

  console.log(`[Offline] Daily pipeline start: date=${runDate}, resume=${resume}, rss=${rssMb()}MB, memLimit=${memoryLimitMb ?? 'unknown'}MB, skipHeavy=${skipHeavy}`);

  const crawl = await runStep('daily-crawl', () => runTask('daily-crawl'));
  if (!crawl.ok) {
    return { crawl };
  }

  const eventsAgg = await runStep('events-daily-agg', () => runTask('events-daily-agg', { date: runDate }));
  const profileDaily = await runStep('user-profile-daily', () => runTask('user-profile-daily', { date: runDate }));
  const vocabStory = await runStep('vocab-story', () => runTask('vocab-story'));
  console.log(`[Offline] After crawl/events/profile/vocab: rss=${rssMb()}MB, runDate=${runDate}`);

  let embeddingRefresh: TaskResult | undefined;
  let precompute: TaskResult | undefined;

  if (skipHeavy) {
    const reason = forceSkipHeavy
      ? 'DAILY_SKIP_HEAVY=1'
      : `low-memory instance (${memoryLimitMb}MB <= 384MB)`;
    markDailyStep(runDate, 'user-embedding-refresh', 'skipped', reason);
    markDailyStep(runDate, 'recommend-precompute', 'skipped', reason);
    finishDailyPipelineRun(runDate);
    console.log(`[Offline] Skipping heavy recommend tasks: ${reason}`);
    return { crawl, eventsAgg, profileDaily, vocabStory };
  }

  embeddingRefresh = await runStep('user-embedding-refresh', () => runTask('user-embedding-refresh'));
  if (!embeddingRefresh.ok) {
    return { crawl, eventsAgg, profileDaily, vocabStory, embeddingRefresh };
  }
  console.log(`[Offline] After embedding refresh: rss=${rssMb()}MB`);

  const precomputeDaysBack = Math.max(1, parseInt(process.env.DAILY_PRECOMPUTE_DAYS || '3', 10));
  const since = new Date();
  since.setDate(since.getDate() - precomputeDaysBack);
  const sinceStr = since.toISOString().split('T')[0];
  const newArticleIds = getArticleIdsCreatedSince(sinceStr);
  if (newArticleIds.length > 0) {
    precompute = await runStep('recommend-precompute', () => runTask('recommend-precompute', { daysBack: precomputeDaysBack }));
    if (!precompute.ok) {
      return { crawl, eventsAgg, profileDaily, embeddingRefresh, vocabStory, precompute };
    }
    console.log(`[Offline] After precompute: rss=${rssMb()}MB`);
  } else {
    markDailyStep(runDate, 'recommend-precompute', 'skipped', `no new articles in last ${precomputeDaysBack} days`);
  }

  finishDailyPipelineRun(runDate);
  return { crawl, eventsAgg, profileDaily, embeddingRefresh, vocabStory, precompute };
}
