import { Router, Request, Response } from 'express';
import { authMiddleware } from './auth.js';
import {
  upsertTestResult,
  getTestResultsByUser,
  upsertArticleFeedback,
  upsertArticleFeedbackWithArticleId,
  getFeedbackByUser,
} from '../repositories/feedbackRepo.js';
import { getSourceUrlByArticleId } from '../repositories/articleRepo.js';
import { incrementMetric } from '../repositories/metricsRepo.js';

export const levelRouter = Router();

const LEVEL_BANDS = [
  { min: 0, max: 20, band: 'A1', label: 'Beginner' },
  { min: 21, max: 40, band: 'A2', label: 'Elementary' },
  { min: 41, max: 55, band: 'B1', label: 'Intermediate' },
  { min: 56, max: 70, band: 'B2', label: 'Upper Intermediate' },
  { min: 71, max: 85, band: 'C1', label: 'Advanced' },
  { min: 86, max: 100, band: 'C2', label: 'Proficient' },
];

function getBand(score: number): { band: string; label: string } {
  const found = LEVEL_BANDS.find((b) => score >= b.min && score <= b.max);
  return found ? { band: found.band, label: found.label } : { band: 'A1', label: 'Beginner' };
}

function computeLevel(userId: string): {
  levelScore: number;
  band: string;
  label: string;
  testCount: number;
  feedbackCount: number;
  testAvg: number;
  suitableRatio: number;
} {
  const tests = getTestResultsByUser(userId, 8);
  const feedbacks = getFeedbackByUser(userId, 30);

  let testScore = 50; // default
  if (tests.length > 0) {
    const totalScore = tests.reduce((s, t) => s + (t.total > 0 ? (t.score / t.total) * 100 : 50), 0);
    testScore = totalScore / tests.length;
  }

  let feedbackScore = 50; // default
  const withDifficulty = feedbacks.filter((f) => f.hard !== null);
  if (withDifficulty.length > 0) {
    const suitable = withDifficulty.filter((f) => f.hard === 0).length;
    feedbackScore = (suitable / withDifficulty.length) * 100;
  }

  const levelScore = Math.round(testScore * 0.6 + feedbackScore * 0.4);
  const clamped = Math.max(0, Math.min(100, levelScore));
  const { band, label } = getBand(clamped);

  return {
    levelScore: clamped,
    band,
    label,
    testCount: tests.length,
    feedbackCount: feedbacks.length,
    testAvg: tests.length ? Math.round(testScore) : 0,
    suitableRatio: withDifficulty.length ? Math.round((feedbackScore / 100) * 100) : 0,
  };
}

levelRouter.post('/test-result', authMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const { score, total } = req.body as { score?: number; total?: number };
  if (typeof score !== 'number' || typeof total !== 'number' || total < 1) {
    res.status(400).json({ error: 'score and total required' });
    return;
  }

  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  const testDate = monday.toISOString().split('T')[0];

  upsertTestResult(userId, testDate, Math.min(score, total), total);
  const result = computeLevel(userId);
  res.json(result);
});

type DifficultyValue = 'appropriate' | 'too_hard' | 'too_easy';

levelRouter.post('/feedback', authMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const { articleKey, articleId, liked, difficulty } = req.body as {
    articleKey?: string;
    articleId?: string;
    liked?: boolean;
    difficulty?: DifficultyValue;
  };
  const key = articleKey || (articleId ? getSourceUrlByArticleId(articleId) : null);
  if (!key) {
    res.status(400).json({ error: 'articleKey or articleId required' });
    return;
  }

  const likedVal = liked === undefined ? null : !!liked;
  // Map: appropriate=0, too_hard=1, too_easy=-1
  let hardVal: number | null = null;
  if (difficulty === 'appropriate') hardVal = 0;
  else if (difficulty === 'too_hard') hardVal = 1;
  else if (difficulty === 'too_easy') hardVal = -1;

  if (articleId) {
    upsertArticleFeedbackWithArticleId(userId, key, articleId, likedVal, hardVal);
  } else {
    upsertArticleFeedback(userId, key, likedVal, hardVal);
  }
  const today = new Date().toISOString().split('T')[0];
  incrementMetric(today, 'article_reads');
  const result = computeLevel(userId);
  res.json(result);
});

levelRouter.get('/', authMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const result = computeLevel(userId);
  res.json(result);
});
