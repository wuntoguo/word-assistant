import { Router, Request, Response } from 'express';
import { runTaskWithDeps, runTask, runDailyPipeline } from '../offline/index.js';

export const cronRouter = Router();

const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: Request): boolean {
  if (!CRON_SECRET) return false;
  const auth = req.headers['authorization'] || req.headers['x-cron-secret'] || req.query?.secret;
  const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '') : String(auth || '');
  return token === CRON_SECRET;
}

type TaskOptions = { userId?: string; daysBack?: number; skipDeps?: boolean };

function handleTask(req: Request, res: Response, taskId: string, options?: TaskOptions) {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const run = options?.skipDeps ? runTask : runTaskWithDeps;
  run(taskId, options)
    .then((r) => {
      if (r.ok) {
        res.json({ ok: true, ...(r.data as Record<string, unknown>) });
      } else {
        res.status(500).json({ ok: false, error: r.error });
      }
    })
    .catch((err) => {
      console.error(`[Cron] ${taskId} failed:`, err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Task failed' });
    });
}

// POST /api/cron/daily-crawl
cronRouter.post('/daily-crawl', (req, res) => handleTask(req, res, 'daily-crawl'));

// POST /api/cron/user-embedding-refresh
cronRouter.post('/user-embedding-refresh', (req, res) => handleTask(req, res, 'user-embedding-refresh'));

// POST /api/cron/warm-recommendations (skipDeps: uses existing articles, no crawl)
cronRouter.post('/warm-recommendations', (req, res) =>
  handleTask(req, res, 'recommend-precompute', { daysBack: 14, skipDeps: true }));

// POST /api/cron/article-audio
cronRouter.post('/article-audio', (req, res) => handleTask(req, res, 'article-audio'));

// POST /api/cron/daily - full pipeline: crawl → embedding-refresh → precompute
// ?async=1 立即返回 202，后台执行（适合 GitHub Actions / 短超时场景）
cronRouter.post('/daily', async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const async = (req.query.async as string) === '1' || (req.query.async as string) === 'true';

  if (async) {
    res.status(202).json({ ok: true, message: 'Daily pipeline started in background' });
    runDailyPipeline()
      .then(({ crawl, embeddingRefresh, vocabStory, precompute }) => {
        console.log('[Cron] Daily (async) done:', {
          crawl: crawl.ok ? 'ok' : crawl.error,
          embedding: embeddingRefresh?.ok ? 'ok' : embeddingRefresh?.error,
          vocabStory: vocabStory?.ok ? 'ok' : vocabStory?.error,
          precompute: precompute?.ok ? 'ok' : precompute?.error,
        });
      })
      .catch((err) => console.error('[Cron] Daily (async) failed:', err));
    return;
  }

  try {
    const { crawl, embeddingRefresh, vocabStory, precompute } = await runDailyPipeline();
    res.json({
      ok: true,
      crawl: crawl.ok ? crawl.data : { error: crawl.error },
      embeddingRefresh: embeddingRefresh?.ok ? embeddingRefresh.data : embeddingRefresh?.error,
      vocabStory: vocabStory?.ok ? vocabStory.data : vocabStory?.error,
      precompute: precompute?.ok ? precompute.data : precompute?.error,
    });
  } catch (err) {
    console.error('[Cron] daily failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Daily pipeline failed' });
  }
});

// POST /api/cron/generate-vocab-stories
cronRouter.post('/generate-vocab-stories', (req, res) => {
  const userId = req.query.userId as string | undefined;
  handleTask(req, res, 'vocab-story', { userId });
});
