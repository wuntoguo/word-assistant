import type { DbArticle } from '../../repositories/recommendRepo.js';
import type { ScoredArticle } from './types.js';
import { computeFreshnessScore, demotionFactor, scoreWithFreshness } from './scoring.js';

export function adjustedRankScore(s: ScoredArticle, showCounts: Map<string, number>): number {
  const fresh = computeFreshnessScore(s.article);
  const base = scoreWithFreshness(s.totalScore, fresh, s.article);
  return base * demotionFactor(showCounts.get(s.article.source_url) ?? 0);
}

export function rankAndDedupe(scored: ScoredArticle[], showCounts: Map<string, number>): ScoredArticle[] {
  const sourceKey = (a: ScoredArticle) => a.article.parent_id || a.article.id;
  const bySource = new Map<string, ScoredArticle>();

  for (const s of scored) {
    const key = sourceKey(s);
    const existing = bySource.get(key);
    if (!existing || adjustedRankScore(s, showCounts) > adjustedRankScore(existing, showCounts)) {
      bySource.set(key, s);
    }
  }

  return [...bySource.values()].sort((a, b) => adjustedRankScore(b, showCounts) - adjustedRankScore(a, showCounts));
}

export function buildFallbackScored(candidates: DbArticle[]): ScoredArticle[] {
  return candidates.map((a) => ({
    article: a,
    interestScore: 50,
    difficultyScore: 50,
    totalScore: 50,
    interestReason: '',
    difficultyReason: '',
    recommendationReason: 'Interest: 50. Difficulty: 50. Total: 50 (0.4×interest + 0.6×difficulty)',
  }));
}

export function applyDislikePenalty(
  score: Omit<ScoredArticle, 'article'>,
  articleKeywords: string[],
  dislikes: string[]
): Omit<ScoredArticle, 'article'> {
  const dislikeOverlap = articleKeywords.filter((k) =>
    dislikes.some((d) => d.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(d.toLowerCase()))
  );
  if (dislikeOverlap.length === 0) return score;

  const newInterest = Math.max(0, score.interestScore - 30);
  return {
    ...score,
    interestScore: newInterest,
    totalScore: newInterest * 0.4 + score.difficultyScore * 0.6,
  };
}
