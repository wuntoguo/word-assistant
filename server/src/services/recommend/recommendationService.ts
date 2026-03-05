import OpenAI from 'openai';
import { recommendRepo } from '../../repositories/recommendRepo.js';
import type { DbArticle } from '../../repositories/recommendRepo.js';
import { getArticleAudioPath } from '../../articleTts.js';
import { getEmbedding, computeSemanticInterestScore, buildInterestReason } from './aiAdapter.js';
import { buildUserProfile } from './profileService.js';
import { buildRecommendationReason, computeDifficultyScore } from './scoring.js';
import { DIFFICULTY_ORDER, type ScoredArticle, type UserProfile } from './types.js';
import { recallCachedArticles, recallFreshCandidates, recallSeenArticleKeys } from './recallService.js';
import { applyDislikePenalty, buildFallbackScored, rankAndDedupe } from './rankService.js';

function isRecommendableArticle(article: DbArticle): boolean {
  if (article.is_vocab_story) return true;
  const len = article.content_len ?? article.content?.length ?? 0;
  return len >= 500;
}

async function scoreArticleWithAI(
  openai: OpenAI,
  article: DbArticle,
  profile: UserProfile,
  userEmbedding: number[]
): Promise<Omit<ScoredArticle, 'article'>> {
  const keywords = (() => {
    try {
      return JSON.parse(article.keywords) as string[];
    } catch {
      return [];
    }
  })();

  const articleDifficulty = article.difficulty_simplified || article.difficulty_original || 'B1';
  const { score: difficultyScore, reason: difficultyReason } = computeDifficultyScore(profile.levelBand, articleDifficulty);
  const textForScoring = (article.simplified_content || article.content || article.title || '').slice(0, 800);

  const interestScore = await computeSemanticInterestScore(
    openai,
    userEmbedding,
    article.title,
    keywords,
    textForScoring
  );

  const interestReason = await buildInterestReason(
    openai,
    profile.interestKeywords,
    profile.dislikeKeywords,
    keywords,
    article.title,
    textForScoring
  );

  const totalScore = interestScore * 0.4 + difficultyScore * 0.6;
  return {
    interestScore,
    difficultyScore,
    totalScore,
    interestReason,
    difficultyReason,
    recommendationReason: buildRecommendationReason(
      interestScore,
      difficultyScore,
      totalScore,
      interestReason,
      difficultyReason
    ),
  };
}

export async function getRecommendedArticles(
  userId: string,
  limit = 10,
  _showDebug = true,
  offset = 0
): Promise<{ articles: ScoredArticle[]; profile: UserProfile; hasMore?: boolean }> {
  const profile = buildUserProfile(userId);
  const seenArticleKeys = recallSeenArticleKeys(userId, 100);
  const showCounts = recommendRepo.getArticleShowCounts(userId);

  const cachedCandidates = recallCachedArticles(userId, seenArticleKeys, 200);
  if (cachedCandidates.length > 0) {
    const rankedCached = rankAndDedupe(cachedCandidates, showCounts);
    return {
      articles: rankedCached.slice(offset, offset + limit),
      profile,
      hasMore: offset + limit < rankedCached.length,
    };
  }

  const candidates = recallFreshCandidates(seenArticleKeys, 150, 21);
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey || candidates.length === 0) {
    const rankedFallback = rankAndDedupe(buildFallbackScored(candidates), showCounts);
    return {
      articles: rankedFallback.slice(offset, offset + limit),
      profile,
      hasMore: offset + limit < rankedFallback.length,
    };
  }

  const openai = new OpenAI({ apiKey });
  const userLevelIdx = DIFFICULTY_ORDER.indexOf(profile.levelBand);
  const userText = profile.interestKeywords.length > 0 ? profile.interestKeywords.join(', ') : '';
  const userEmbedding = userText.trim() ? await getEmbedding(openai, `User interests: ${userText}`) : [];

  const scored: ScoredArticle[] = [];
  for (const article of candidates) {
    if (!isRecommendableArticle(article)) continue;
    const articleDiff = article.difficulty_simplified || article.difficulty_original || 'B1';
    const articleIdx = DIFFICULTY_ORDER.indexOf(articleDiff);
    if (articleIdx >= 0 && userLevelIdx >= 0 && articleIdx - userLevelIdx > 2) continue;

    let s = await scoreArticleWithAI(openai, article, profile, userEmbedding);
    const articleKeywords = (() => {
      try {
        return (JSON.parse(article.keywords) as string[]) || [];
      } catch {
        return [];
      }
    })();
    s = applyDislikePenalty(s, articleKeywords, profile.dislikeKeywords);

    scored.push({ ...s, article });
  }

  const ranked = rankAndDedupe(scored, showCounts);
  for (const s of ranked.slice(0, 100)) {
    try {
      recommendRepo.upsertUserTopArticle(userId, s.article.id, {
        totalScore: s.totalScore,
        interestScore: s.interestScore,
        difficultyScore: s.difficultyScore,
        interestReason: s.interestReason,
        difficultyReason: s.difficultyReason,
        recommendationReason: s.recommendationReason,
      });
    } catch (err) {
      // Cache refresh must not break online recommendation response.
      console.warn('[Recommend] cache upsert failed:', userId, s.article.id, err);
    }
  }
  try {
    recommendRepo.pruneUserTopArticles(userId, 100);
  } catch (err) {
    console.warn('[Recommend] cache prune failed:', userId, err);
  }

  return {
    articles: ranked.slice(offset, offset + limit),
    profile,
    hasMore: offset + limit < ranked.length,
  };
}

export function getRecommendedAudioArticles(userId: string | null): ScoredArticle[] {
  const articles = recommendRepo.getArticlesForAudioGeneration().filter((a) => getArticleAudioPath(a.id));
  if (articles.length === 0) return [];

  const profile = userId
    ? buildUserProfile(userId)
    : {
        levelBand: 'B1',
        levelScore: 50,
        interestKeywords: [],
        dislikeKeywords: [],
        suitableDifficultyArticles: [],
        tooHardArticles: [],
        tooEasyArticles: [],
      };

  const seenKeys = userId ? new Set(recommendRepo.getFeedbackByUser(userId, 100).map((f) => f.article_key)) : new Set<string>();
  const showCounts = userId ? recommendRepo.getArticleShowCounts(userId) : new Map<string, number>();

  const cacheByArtId = new Map<string, ScoredArticle>();
  if (userId) {
    const cached = recommendRepo.getUserTopArticlesWithArticle(userId, 500);
    for (const c of cached) {
      cacheByArtId.set(c.article.id, {
        article: c.article,
        interestScore: c.interest_score,
        difficultyScore: c.difficulty_score,
        totalScore: c.total_score,
        interestReason: c.interest_reason,
        difficultyReason: c.difficulty_reason,
        recommendationReason: c.recommendation_reason,
      });
    }
  }

  const scored: ScoredArticle[] = [];
  for (const article of articles) {
    if (seenKeys.has(article.source_url)) continue;

    const cached = cacheByArtId.get(article.id);
    if (cached) {
      scored.push(cached);
      continue;
    }

    const articleDiff = article.difficulty_simplified || article.difficulty_original || 'B1';
    const { score: difficultyScore, reason: difficultyReason } = computeDifficultyScore(profile.levelBand, articleDiff);
    const interestScore = 50;
    const totalScore = interestScore * 0.4 + difficultyScore * 0.6;

    scored.push({
      article,
      interestScore,
      difficultyScore,
      totalScore,
      interestReason: '',
      difficultyReason,
      recommendationReason: buildRecommendationReason(interestScore, difficultyScore, totalScore, '', difficultyReason),
    });
  }

  return rankAndDedupe(scored, showCounts);
}
