import { Router, Request, Response } from 'express';
import {
  getCrawlReports,
  getMetricsRange,
  getMetricsForDate,
  getArticleCount,
  getArticleCountBySource,
  getArticleCountByDay,
  getArticlesForRecommendation,
} from '../db.js';
import { formatDailyReport } from '../dailyCrawler.js';

export const adminRouter = Router();

const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

function isAuthorized(req: Request): boolean {
  if (!ADMIN_SECRET) return false;
  const auth = req.headers['authorization'] || req.headers['x-admin-secret'] || req.query?.secret;
  const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '') : String(auth || '');
  return token === ADMIN_SECRET;
}

function requireAdmin(req: Request, res: Response, next: () => void) {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// GET /api/admin/metrics?date=2025-02-17 or ?start=...&end=...
adminRouter.get('/metrics', requireAdmin, (req: Request, res: Response) => {
  const date = req.query.date as string | undefined;
  const start = req.query.start as string | undefined;
  const end = req.query.end as string | undefined;

  if (date) {
    const metrics = getMetricsForDate(date);
    res.json({ date, metrics: metrics || {} });
  } else if (start && end) {
    const rows = getMetricsRange(start, end);
    res.json({ range: { start, end }, metrics: rows });
  } else {
    const today = new Date().toISOString().split('T')[0];
    const metrics = getMetricsForDate(today);
    res.json({ date: today, metrics: metrics || {} });
  }
});

// GET /api/admin/dashboard - summary for monitoring
adminRouter.get('/dashboard', requireAdmin, async (req: Request, res: Response) => {
  const { default: db } = await import('../db.js');
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 864e5).toISOString().split('T')[0];

  const metricsToday = getMetricsForDate(today) || {};
  const metricsYesterday = getMetricsForDate(yesterday) || {};

  const articleCount = getArticleCount();

  const usersRow = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  const wordsRow = db.prepare('SELECT COUNT(*) as c FROM words').get() as { c: number };
  const feedbackRow = db.prepare('SELECT COUNT(*) as c FROM article_feedback').get() as { c: number };
  const distinctUsersFeedback = db.prepare(
    'SELECT COUNT(DISTINCT user_id) as c FROM article_feedback WHERE date(created_at) = ?'
  ).get(today) as { c: number } | undefined;

  const recentReports = getCrawlReports(7);
  const articlesBySource = getArticleCountBySource();
  const articlesByDay = getArticleCountByDay(14);

  res.json({
    overview: {
      totalUsers: usersRow?.c ?? 0,
      totalWords: wordsRow?.c ?? 0,
      totalArticles: articleCount,
      totalArticleReads: feedbackRow?.c ?? 0,
    },
    today: {
      ...metricsToday,
      uniqueReaders: distinctUsersFeedback?.c ?? 0,
    },
    yesterday: metricsYesterday,
    recentCrawlReports: recentReports,
    articlesBySource,
    articlesByDay,
  });
});

// GET /api/admin/reports - crawl reports
adminRouter.get('/reports', requireAdmin, (req: Request, res: Response) => {
  const limit = Math.min(50, parseInt((req.query.limit as string) || '30', 10));
  const reports = getCrawlReports(limit);
  res.json({ reports });
});

// GET /api/admin/recommend-debug - why no new articles in recommendations
adminRouter.get('/recommend-debug', requireAdmin, (req: Request, res: Response) => {
  const today = new Date().toISOString().split('T')[0];
  const articlesByDay = getArticleCountByDay(7);
  const recentReports = getCrawlReports(5);
  const pool7d = getArticlesForRecommendation(100, 7);
  const pool14d = getArticlesForRecommendation(100, 14);
  const todayRow = articlesByDay.find((r) => r.date === today);

  res.json({
    serverDate: today,
    articlesCreatedToday: todayRow?.count ?? 0,
    articlesByDay,
    poolForRecommend_7d: pool7d.length,
    poolForRecommend_14d: pool14d.length,
    poolSample: pool7d.slice(0, 5).map((a) => ({
      id: a.id,
      title: a.title?.slice(0, 50),
      pub_date: a.pub_date,
      created_at: a.created_at,
      source: a.source_name,
    })),
    recentCrawlReports: recentReports.map((r) => ({
      report_date: r.report_date,
      ingested: r.ingested,
      skipped: r.skipped,
      errorCount: typeof r.errors === 'number' ? r.errors : 0,
    })),
  });
});

// GET /api/admin/reports/:date - daily report as markdown
adminRouter.get('/reports/:date', requireAdmin, (req: Request, res: Response) => {
  const { date } = req.params;
  const reports = getCrawlReports(100);
  const report = reports.find((r) => r.report_date === date);
  if (!report) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  const result = {
    ingested: report.ingested,
    skipped: report.skipped,
    errors: report.errors,
    byCategory: (() => {
      try {
        return JSON.parse(report.by_category || '{}') as Record<string, { ingested: number; skipped: number }>;
      } catch {
        return {};
      }
    })(),
    durationMs: report.duration_ms,
  };
  const markdown = formatDailyReport(result);
  res.type('text/markdown').send(markdown);
});
