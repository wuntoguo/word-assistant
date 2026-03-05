import { Router, Request, Response } from 'express';
import { authMiddleware } from './auth.js';
import { getRecommendedArticles, buildUserProfile } from '../recommendation.js';
import { recordShownArticles, getArticleShowCounts } from '../repositories/recommendCacheRepo.js';
import { blendVocabStories, buildRankedPayload, diversifyFinanceTravel } from '../services/recommend/blendService.js';

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
  const showDebug = (req.query.debug as string) === 'true';

  try {
    const { articles, profile, hasMore } = await getRecommendedArticles(userId, limit, showDebug, offset);
    const showCounts = getArticleShowCounts(userId);

    const rankedPayload = buildRankedPayload(articles, showCounts, showDebug);
    const blendedPayload = blendVocabStories(userId, offset, rankedPayload, showDebug, showCounts);
    const diversifiedPayload = diversifyFinanceTravel(blendedPayload, offset);

    recordShownArticles(
      userId,
      diversifiedPayload.map((p) => p.link)
    );

    const cleanPayload = diversifiedPayload.map(({ _adjustedTotal, ...p }) => p);

    res.json({
      articles: cleanPayload,
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
