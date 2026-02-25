import { Router, Request, Response } from 'express';
import { authMiddleware } from './auth.js';
import { getRecommendedArticles, buildUserProfile, buildRecommendationReason, computeFreshnessScore } from '../recommendation.js';
import {
  recordShownArticles,
  getVocabStoriesForRecommend,
  getFeedbackByUser,
  getShownArticleKeysInLast3Days,
  getArticleShowCounts,
} from '../db.js';

function demotionFactor(showCount: number): number {
  return 1 / (1 + 0.2 * Math.max(0, showCount));
}
function scoreWithFreshness(baseScore: number, freshnessScore: number): number {
  return baseScore * (0.75 + 0.25 * (freshnessScore / 100));
}

export const recommendRouter = Router();

recommendRouter.get('/debug/profile', authMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId;
  try {
    const profile = buildUserProfile(userId);
    res.json({
      userId,
      levelBand: profile.levelBand,
      levelScore: profile.levelScore,
      interestKeywords: profile.interestKeywords,
      suitableDifficultyArticles: profile.suitableDifficultyArticles,
    });
  } catch (err) {
    console.error('Debug profile error:', err);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

recommendRouter.get('/', authMiddleware, async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const limit = Math.min(20, Math.max(1, parseInt((req.query.limit as string) || '10', 10)));
  const offset = Math.max(0, parseInt((req.query.offset as string) || '0', 10));
  const showDebug = (req.query.debug as string) !== 'false';

  try {
    const { articles, profile, hasMore } = await getRecommendedArticles(userId, limit, showDebug, offset);
    const showCounts = showDebug ? getArticleShowCounts(userId) : new Map<string, number>();

    let payload = articles.map((s) => {
      const freshness = computeFreshnessScore(s.article);
      const cnt = showCounts.get(s.article.source_url) ?? 0;
      const withFreshness = scoreWithFreshness(s.totalScore, freshness);
      const adjustedTotal = withFreshness * demotionFactor(cnt);
      return {
        id: s.article.id,
        title: s.article.title,
        link: s.article.source_url,
        pubDate: s.article.pub_date,
        description: s.article.simplified_content?.slice(0, 300) || s.article.content?.slice(0, 300) || '',
        simplified: s.article.simplified_content || s.article.content || '',
        source: s.article.source_name,
        keywords: (() => {
          try {
            return JSON.parse(s.article.keywords) as string[];
          } catch {
            return [];
          }
        })(),
        difficulty: s.article.difficulty_simplified || s.article.difficulty_original,
        scores: showDebug
          ? {
              interestScore: s.interestScore,
              difficultyScore: s.difficultyScore,
              totalScore: s.totalScore,
              interestReason: s.interestReason,
              difficultyReason: s.difficultyReason,
              freshnessScore: freshness,
              showCount: cnt,
              adjustedTotal: Math.round(adjustedTotal * 10) / 10,
            }
          : undefined,
        recommendationReason: buildRecommendationReason(s.interestScore, s.difficultyScore, s.totalScore, s.interestReason, s.difficultyReason),
        isVocabStory: false,
      };
    });

    if (offset === 0) {
      const excludeKeys = new Set([
        ...getFeedbackByUser(userId, 100).map((f) => f.article_key),
        ...getShownArticleKeysInLast3Days(userId),
        ...payload.map((p) => p.link),
      ]);
      const vocabStories = getVocabStoriesForRecommend(userId, excludeKeys, 2);
      const vocabPayload = vocabStories.map((a) => ({
        id: a.id,
        title: a.title,
        link: a.source_url,
        pubDate: a.pub_date,
        description: (a.simplified_content || a.content || '').slice(0, 300),
        simplified: a.simplified_content || a.content || '',
        source: a.source_name || 'FeedLingo Vocab Story',
        keywords: (() => {
          try {
            return JSON.parse(a.keywords) as string[];
          } catch {
            return [];
          }
        })(),
        difficulty: a.difficulty_simplified || a.difficulty_original,
        scores: showDebug ? { interestScore: 90, difficultyScore: 100, totalScore: 96, interestReason: 'Personalized from your vocabulary', difficultyReason: 'Matches your level', freshnessScore: 100, showCount: 0, adjustedTotal: 96 } : undefined,
        recommendationReason: buildRecommendationReason(90, 100, 96, 'Personalized from your vocabulary', 'Matches your level'),
        isVocabStory: true,
      }));
      const insertPositions = [2, 6];
      for (let i = 0; i < vocabPayload.length && i < insertPositions.length; i++) {
        const pos = Math.min(insertPositions[i], payload.length);
        payload = [...payload.slice(0, pos), vocabPayload[i], ...payload.slice(pos)];
      }
    }

    recordShownArticles(
      userId,
      payload.map((p) => p.link)
    );

    res.json({
      articles: payload,
      hasMore: hasMore ?? false,
      profile: showDebug
        ? {
            levelBand: profile.levelBand,
            levelScore: profile.levelScore,
            interestKeywords: profile.interestKeywords,
            suitableCount: profile.suitableDifficultyArticles.length,
          }
        : undefined,
    });
  } catch (err) {
    console.error('Recommend error:', err);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});
