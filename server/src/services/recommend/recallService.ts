import { recommendRepo, type DbArticle } from '../../repositories/recommendRepo.js';
import type { ScoredArticle } from './types.js';

export function recallSeenArticleKeys(userId: string, limit = 100): Set<string> {
  return new Set(recommendRepo.getFeedbackByUser(userId, limit).map((f) => f.article_key));
}

export function recallCachedArticles(userId: string, seenArticleKeys: Set<string>, limit = 200): ScoredArticle[] {
  const cached = recommendRepo.getUserTopArticlesWithArticle(userId, limit);
  return cached
    .filter((c) => !seenArticleKeys.has(c.article.source_url))
    .map((c) => ({
      article: c.article,
      interestScore: c.interest_score,
      difficultyScore: c.difficulty_score,
      totalScore: c.total_score,
      interestReason: c.interest_reason,
      difficultyReason: c.difficulty_reason,
      recommendationReason: c.recommendation_reason,
    }));
}

export function recallFreshCandidates(
  seenArticleKeys: Set<string>,
  limit = 150,
  sinceDays = 21
): DbArticle[] {
  return recommendRepo
    .getArticlesForRecommendation(limit, sinceDays)
    .filter((a) => !seenArticleKeys.has(a.source_url));
}
