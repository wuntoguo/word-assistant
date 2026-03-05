import type { DbArticle } from '../../repositories/recommendRepo.js';
import { DIFFICULTY_ORDER } from './types.js';

export function demotionFactor(showCount: number): number {
  return 1 / (1 + 0.2 * Math.max(0, showCount));
}

export function computeFreshnessScore(article: DbArticle): number {
  const dateStr = article.pub_date || article.created_at;
  if (!dateStr) return 50;
  let date: Date;
  try {
    date = new Date(dateStr);
    if (isNaN(date.getTime())) return 50;
  } catch {
    return 50;
  }
  const daysOld = (Date.now() - date.getTime()) / 864e5;
  return Math.max(0, Math.min(100, Math.round(100 - daysOld * 7)));
}

export function scoreWithFreshness(baseScore: number, freshnessScore: number, article: DbArticle): number {
  const multiplier = 0.2 + 0.8 * (freshnessScore / 100);
  let score = baseScore * multiplier;
  const dateStr = article.pub_date || article.created_at;
  if (dateStr) {
    try {
      const daysOld = (Date.now() - new Date(dateStr).getTime()) / 864e5;
      if (daysOld < 2) score *= 1.15;
    } catch {
      // ignore date parsing errors
    }
  }
  return score;
}

export function buildRecommendationReason(
  interestScore: number,
  difficultyScore: number,
  totalScore: number,
  interestReason: string,
  difficultyReason: string
): string {
  const interestPart = interestReason
    ? `Interest: ${interestScore} — ${interestReason}. `
    : `Interest: ${interestScore}. `;
  const difficultyPart = difficultyReason
    ? `Difficulty: ${difficultyScore} — ${difficultyReason}. `
    : `Difficulty: ${difficultyScore}. `;
  return `${interestPart}${difficultyPart}Total: ${Math.round(totalScore)} (0.4×interest + 0.6×difficulty)`;
}

export function computeDifficultyScore(userLevel: string, articleLevel: string): { score: number; reason: string } {
  const userIdx = DIFFICULTY_ORDER.indexOf(userLevel);
  const articleIdx = DIFFICULTY_ORDER.indexOf(articleLevel);
  if (userIdx < 0 || articleIdx < 0) {
    return { score: 50, reason: 'Unknown difficulty' };
  }

  const gap = articleIdx - userIdx;
  if (gap > 2) return { score: 0, reason: `Article ${articleLevel} is 2+ levels above your ${userLevel}` };

  const reasons: Record<number, string> = {
    [-3]: 'Well below your level, good for quick review',
    [-2]: 'Below your level, good for consolidation',
    [-1]: 'Slightly below, smooth reading',
    0: 'Matches your level',
    1: 'Slightly above, good challenge',
    2: 'Above your level, moderately challenging',
  };
  const scores: Record<number, number> = {
    [-3]: 40,
    [-2]: 55,
    [-1]: 75,
    0: 100,
    1: 80,
    2: 55,
  };

  return {
    score: scores[gap] ?? 50,
    reason: reasons[gap] ?? `You: ${userLevel}, Article: ${articleLevel}`,
  };
}
