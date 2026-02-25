import { Router, Request, Response } from 'express';
import { runTaskWithDeps, runTask, runDailyPipeline } from '../offline/index.js';
import db, { getCrawlReports, getArticleCountByDay, getArticleCount, getArticleCountBySourceForDate } from '../db.js';

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

// GET /api/cron/stats - 爬取和生成文章数（需 CRON_SECRET）
cronRouter.get('/stats', (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const articlesByDay = getArticleCountByDay(14);
  const todayRow = articlesByDay.find((r) => r.date === today);
  const reports = getCrawlReports(14);
  const totalArticles = getArticleCount();
  const vocabCount = db.prepare('SELECT COUNT(*) as c FROM articles WHERE is_vocab_story = 1').get() as { c: number };
  const crawlCount = db.prepare('SELECT COUNT(*) as c FROM articles WHERE COALESCE(is_vocab_story,0)=0').get() as { c: number };
  const articlesBySourceToday = getArticleCountBySourceForDate(today);
  const CATEGORY_SOURCES: Record<string, string[]> = {
    finance: ['Yahoo Finance', 'CNN Business', 'NPR Business', 'CNBC', 'Reuters'],
    tech: ['CNN Tech', 'TechCrunch', 'Ars Technica', 'NPR Technology'],
    lifestyle: ['CNN Health', 'CNN Travel', 'NPR Health'],
    entertainment: ['CNN Entertainment', 'NPR Arts', 'Variety'],
    sports: ['ESPN', 'CNN US', 'NPR Sports'],
  };
  const byCategoryToday: Record<string, number> = {};
  for (const [cat, sources] of Object.entries(CATEGORY_SOURCES)) {
    byCategoryToday[cat] = articlesBySourceToday
      .filter((r) => sources.includes(r.source_name))
      .reduce((s, r) => s + r.count, 0);
  }
  const reportsMapped = reports.slice(0, 7).map((r) => {
    let byCategory: Record<string, { ingested: number; skipped: number }> = {};
    try {
      byCategory = r.by_category ? (JSON.parse(r.by_category) as Record<string, { ingested: number; skipped: number }>) : {};
    } catch {
      //
    }
    return {
      date: r.report_date,
      ingested: r.ingested,
      skipped: r.skipped,
      errors: r.errors,
      durationMs: r.duration_ms,
      isToday: r.report_date === today,
      byCategory,
    };
  });
  res.json({
    today,
    serverTime: now.toISOString(),
    timezone: tz,
    articles: {
      total: totalArticles,
      crawled: crawlCount?.c ?? 0,
      vocabStories: vocabCount?.c ?? 0,
      createdToday: todayRow?.count ?? 0,
    },
    articlesByDay: articlesByDay.slice(0, 7),
    articlesBySourceToday,
    articlesByCategoryToday: byCategoryToday,
    crawlReports: reportsMapped,
    crawlToday: reportsMapped.filter((r) => r.isToday),
  });
});
