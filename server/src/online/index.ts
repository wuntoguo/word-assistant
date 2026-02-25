/**
 * Online (request-handling) routes.
 * All HTTP endpoints that serve user requests.
 */

import express, { Express } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { authRouter } from '../routes/auth.js';
import { syncRouter } from '../routes/sync.js';
import { sentencesRouter } from '../routes/sentences.js';
import { dictionaryRouter, learnerRouter, intermediateRouter } from '../routes/dictionary.js';
import { discoveryRouter } from '../routes/discovery.js';
import { audioRouter } from '../routes/audio.js';
import { levelRouter } from '../routes/level.js';
import { recommendRouter } from '../routes/recommend.js';
import { vocabStoryRouter } from '../routes/vocabStory.js';
import { profileRouter } from '../routes/profile.js';
import { cronRouter } from '../routes/cron.js';
import { adminRouter } from '../routes/admin.js';
import { metricsMiddleware } from '../middleware/metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function setupOnlineRoutes(app: Express): void {
  app.use(metricsMiddleware);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Public debug for recommend flow (no auth - aggregate stats only)
  app.get('/api/debug/recommend', async (_req, res) => {
    try {
      const { getArticleCountByDay, getArticlesForRecommendation, getCrawlReports } = await import('../db.js');
      const today = new Date().toISOString().split('T')[0];
      const articlesByDay = getArticleCountByDay(7);
      const recentReports = getCrawlReports(5);
      const pool7d = getArticlesForRecommendation(100, 7);
      const todayRow = articlesByDay.find((r: { date: string }) => r.date === today);
      res.json({
        serverDate: today,
        articlesCreatedToday: todayRow?.count ?? 0,
        articlesByDay,
        poolForRecommend_7d: pool7d.length,
        poolSample: pool7d.slice(0, 3).map((a) => ({
          title: a.title?.slice(0, 60),
          pub_date: a.pub_date ?? undefined,
          created_at: a.created_at ?? undefined,
          source: a.source_name ?? undefined,
        })),
        recentCrawlReports: recentReports.map((r) => ({
          report_date: r.report_date,
          ingested: r.ingested,
          skipped: r.skipped,
          errorCount: r.errors,
        })),
      });
    } catch (err) {
      console.error('Debug recommend error:', err);
      res.status(500).json({ error: 'Debug failed' });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api', syncRouter);
  app.use('/api/sentences', sentencesRouter);
  app.use('/api/define', dictionaryRouter);
  app.use('/api/define-learner', learnerRouter);
  app.use('/api/define-intermediate', intermediateRouter);
  app.use('/api/discovery', discoveryRouter);
  app.use('/api/audio', audioRouter);
  app.use('/api/level', levelRouter);
  app.use('/api/recommend', recommendRouter);
  app.use('/api/vocab-story', vocabStoryRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/cron', cronRouter);
  app.use('/api/admin', adminRouter);

  app.get('/admin', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'adminPanel.html'));
  });

  const clientDistDir = path.join(__dirname, '..', '..', '..', 'client-dist');
  app.use(express.static(clientDistDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDistDir, 'index.html'));
  });
}
