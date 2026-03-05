import { Request, Response, NextFunction } from 'express';
import { incrementMetric } from '../repositories/metricsRepo.js';

const SKIP_PATHS = ['/api/health', '/api/admin'];
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const path = req.originalUrl || req.path;
  if (SKIP_PATHS.some((p) => path.startsWith(p))) return next();

  const date = new Date().toISOString().split('T')[0];

  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    try {
      if (path.includes('/define') || path.includes('/define-learner') || path.includes('/define-intermediate')) {
        incrementMetric(date, 'define_requests');
      } else if (path.includes('article-content') || path.includes('article-by-id')) {
        incrementMetric(date, 'article_content_requests');
      } else if (path.includes('/recommend')) {
        incrementMetric(date, 'recommend_requests');
      } else if (path.includes('/sync') && req.method === 'POST') {
        incrementMetric(date, 'sync_requests');
      } else if (path.includes('weekly-test')) {
        incrementMetric(date, 'weekly_test_requests');
      }
    } catch {
      // Ignore metrics errors
    }
  });

  next();
}
