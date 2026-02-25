/**
 * Offline task runner.
 * Executes batch jobs by id.
 */

import { runDailyCrawl, formatDailyReport } from '../dailyCrawler.js';
import { runIncrementalPrecompute, runUserEmbeddingRefresh } from '../recommendPrecompute.js';
import { runDailyVocabStoryGeneration } from '../dailyVocabStory.js';
import { runArticleAudioBatch } from '../articleAudioBatch.js';
import { getArticleIdsCreatedSince } from '../db.js';
import { getExecutionOrder } from './registry.js';

export type TaskResult =
  | { ok: true; taskId: string; data: unknown }
  | { ok: false; taskId: string; error: string };

export async function runTask(
  taskId: string,
  options?: { userId?: string; daysBack?: number }
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
      const daysBack = options?.daysBack ?? 14;
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const sinceStr = since.toISOString().split('T')[0];
      const newArticleIds = getArticleIdsCreatedSince(sinceStr);
      const r = await runIncrementalPrecompute(newArticleIds);
      return {
        ok: true,
        taskId,
        data: {
          usersProcessed: r.usersProcessed,
          articlesScored: r.articlesScored,
          newArticleIds: newArticleIds.length,
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
  options?: { userId?: string; daysBack?: number; skipDeps?: boolean }
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
export async function runDailyPipeline(): Promise<{
  crawl: TaskResult;
  embeddingRefresh?: TaskResult;
  vocabStory?: TaskResult;
  precompute?: TaskResult;
}> {
  const crawl = await runTask('daily-crawl');
  if (!crawl.ok) {
    return { crawl };
  }

  const embeddingRefresh = await runTask('user-embedding-refresh');
  const vocabStory = await runTask('vocab-story');

  const today = new Date().toISOString().split('T')[0];
  const newArticleIds = getArticleIdsCreatedSince(today);
  let precompute: TaskResult | undefined;
  if (newArticleIds.length > 0) {
    precompute = await runTask('recommend-precompute', { daysBack: 0 });
  }

  return { crawl, embeddingRefresh, vocabStory, precompute };
}
