/**
 * Offline task scheduler.
 * Registers cron jobs from registry.
 */

import cron from 'node-cron';
import { OFFLINE_TASKS } from './registry.js';
import { runTask, runDailyPipeline } from './runner.js';
import { getArticlesForAudioGeneration } from '../db.js';
import { getArticleAudioPath } from '../articleTts.js';

/** One-time seed: if articles exist but no audio, run article-audio in background (helps fresh deploys). */
function scheduleStartupAudioSeed(): void {
  setTimeout(async () => {
    try {
      const articles = getArticlesForAudioGeneration();
      const withAudio = articles.filter((a) => getArticleAudioPath(a.id));
      if (articles.length > 0 && withAudio.length === 0) {
        console.log(`[Offline] Startup: ${articles.length} articles, 0 audio. Running article-audio seed...`);
        const r = await runTask('article-audio');
        if (r.ok) {
          const d = r.data as { generated: number; skipped: number; errors: string[] };
          console.log(`[Offline] Article audio seed: generated=${d.generated} skipped=${d.skipped}`);
        } else {
          console.error('[Offline] Article audio seed failed:', r.error);
        }
      }
    } catch (err) {
      console.error('[Offline] Article audio seed failed:', err);
    }
  }, 5_000); // 5s delay to let app fully init
}

export function setupScheduler(): void {
  scheduleStartupAudioSeed();
  const crawlTask = OFFLINE_TASKS['daily-crawl'];
  const vocabTask = OFFLINE_TASKS['vocab-story'];

  if (!crawlTask || !vocabTask) return;

  const crawlSchedule = (crawlTask.envSchedule && process.env[crawlTask.envSchedule]) || crawlTask.schedule;
  const vocabSchedule = (vocabTask.envSchedule && process.env[vocabTask.envSchedule]) || vocabTask.schedule;

  if (cron.validate(crawlSchedule)) {
    cron.schedule(crawlSchedule, async () => {
      console.log('[Offline] Running daily crawl pipeline...');
      try {
        const { crawl, embeddingRefresh, precompute } = await runDailyPipeline();
        if (crawl.ok) {
          const d = crawl.data as { ingested: number; skipped: number; errors: string[]; durationMs: number };
          console.log(`[Offline] Crawl done: ingested=${d.ingested} skipped=${d.skipped} errors=${d.errors?.length ?? 0} in ${d.durationMs}ms`);
        } else {
          console.error('[Offline] Crawl failed:', crawl.error);
        }
        if (embeddingRefresh?.ok) {
          const e = embeddingRefresh.data as { usersProcessed: number; refreshed: number };
          console.log(`[Offline] User embeddings refreshed: ${e.refreshed}/${e.usersProcessed} users`);
        } else if (embeddingRefresh && !embeddingRefresh.ok) {
          console.error('[Offline] User embedding refresh failed:', embeddingRefresh.error);
        }
        if (precompute?.ok) {
          const p = precompute.data as { usersProcessed: number; articlesScored: number };
          console.log(`[Offline] Precompute done: ${p.usersProcessed} users, ${p.articlesScored} articles scored`);
        }
      } catch (err) {
        console.error('[Offline] Daily pipeline failed:', err);
      }
    });
    console.log(`[Offline] Scheduled daily crawl at ${crawlSchedule}`);
  }

  // article-audio: runs at 2am (free Google TTS via node-gtts)
  const audioTask = OFFLINE_TASKS['article-audio'];
  if (audioTask) {
    const audioSchedule = (audioTask.envSchedule && process.env[audioTask.envSchedule]) || audioTask.schedule;
    if (cron.validate(audioSchedule)) {
      cron.schedule(audioSchedule, async () => {
        console.log('[Offline] Running article audio generation...');
        try {
          const r = await runTask('article-audio');
          if (r.ok) {
            const a = r.data as { generated: number; skipped: number; errors: string[] };
            console.log(`[Offline] Article audio: generated=${a.generated} skipped=${a.skipped} errors=${a.errors?.length ?? 0}`);
          } else {
            console.error('[Offline] Article audio failed:', r.error);
          }
        } catch (err) {
          console.error('[Offline] Article audio failed:', err);
        }
      });
      console.log(`[Offline] Scheduled article audio at ${audioSchedule}`);
    }
  }

  if (cron.validate(vocabSchedule)) {
    cron.schedule(vocabSchedule, async () => {
      console.log('[Offline] Running vocab story generation...');
      try {
        const r = await runTask('vocab-story');
        if (r.ok) {
          const d = r.data as { generated: number; skipped: number; errors: string[] };
          console.log(`[Offline] Vocab stories: generated=${d.generated} skipped=${d.skipped} errors=${d.errors?.length ?? 0}`);
        } else {
          console.error('[Offline] Vocab story failed:', r.error);
        }
      } catch (err) {
        console.error('[Offline] Vocab story generation failed:', err);
      }
    });
    console.log(`[Offline] Scheduled vocab story at ${vocabSchedule}`);
  }
}
