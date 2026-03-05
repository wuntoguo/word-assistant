/**
 * Recommendation precompute: cache per-user top 100 articles.
 * - Article embeddings cached in DB (one-time per article)
 * - User embeddings cached (refreshed when interests change)
 * - Daily incremental: score new articles for each user, merge into top 100
 */

import OpenAI from 'openai';
import {
  buildUserProfile,
  buildUserProfileWithOptions,
  buildRecommendationReason,
  type UserProfile,
} from './recommendation.js';
import {
  getArticleById,
  getArticlesForRecommendation,
  getArticleIdsCreatedSincePage,
} from './repositories/articleRepo.js';
import {
  getArticleEmbedding,
  getUserEmbedding,
  upsertUserEmbedding,
  getUserTopArticles,
  upsertUserTopArticle,
  pruneUserTopArticles,
} from './repositories/recommendCacheRepo.js';
import { getFeedbackByUser } from './repositories/feedbackRepo.js';
import { getActiveUserIds, getActiveUserIdsPage } from './repositories/userRepo.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const DIFFICULTY_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const TOP_N = 100;
const PRECOMPUTE_USER_PAGE_SIZE = Math.max(1, parseInt(process.env.PRECOMPUTE_USER_PAGE_SIZE || '50', 10));
const PRECOMPUTE_ARTICLE_CHUNK_SIZE = Math.max(1, parseInt(process.env.PRECOMPUTE_ARTICLE_CHUNK_SIZE || '100', 10));
const PRECOMPUTE_FEEDBACK_LIMIT = Math.max(50, parseInt(process.env.PRECOMPUTE_FEEDBACK_LIMIT || '200', 10));

async function getEmbedding(openai: OpenAI, text: string): Promise<number[]> {
  if (!text?.trim()) return [];
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8000),
  });
  return res.data[0]?.embedding ?? [];
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function computeDifficultyScore(userLevel: string, articleLevel: string): { score: number; reason: string } {
  const userIdx = DIFFICULTY_ORDER.indexOf(userLevel);
  const articleIdx = DIFFICULTY_ORDER.indexOf(articleLevel);
  if (userIdx < 0 || articleIdx < 0) return { score: 50, reason: 'Difficulty unknown' };
  const gap = articleIdx - userIdx;
  if (gap > 2) return { score: 0, reason: `Too hard` };
  const scores: Record<number, number> = { [-3]: 40, [-2]: 55, [-1]: 75, 0: 100, 1: 80, 2: 55 };
  return { score: scores[gap] ?? 50, reason: `User ${userLevel}, Article ${articleLevel}` };
}

function getPrecomputedArticleEmbedding(articleId: string): number[] | null {
  const emb = getArticleEmbedding(articleId);
  return emb && emb.length > 0 ? emb : null;
}

async function getOrCreateUserEmbedding(openai: OpenAI, userId: string, profile: UserProfile): Promise<number[]> {
  const interests = profile.interestKeywords.join(', ');
  const hash = interests.slice(0, 200);
  const cached = getUserEmbedding(userId);
  if (cached && cached.interestsHash === hash && cached.embedding.length > 0) return cached.embedding;
  const text = interests.trim() ? `User interests: ${interests}` : '';
  const emb = text ? await getEmbedding(openai, text) : [];
  if (emb.length > 0) upsertUserEmbedding(userId, emb, hash);
  return emb;
}

/**
 * Force-refresh user embeddings for all active users.
 * Called by daily cron before recommend-precompute.
 */
export async function runUserEmbeddingRefresh(): Promise<{ usersProcessed: number; refreshed: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { usersProcessed: 0, refreshed: 0 };

  const openai = new OpenAI({ apiKey });
  let offset = 0;
  let usersProcessed = 0;
  let refreshed = 0;

  while (true) {
    const userIds = getActiveUserIdsPage(14, PRECOMPUTE_USER_PAGE_SIZE, offset);
    if (userIds.length === 0) break;
    usersProcessed += userIds.length;

    for (const userId of userIds) {
      const profile = buildUserProfileWithOptions(userId, { includeArticleBuckets: false });
      const interests = profile.interestKeywords.join(', ');
      const hash = interests.slice(0, 200);
      const cached = getUserEmbedding(userId);
      if (cached && cached.interestsHash === hash && cached.embedding.length > 0) {
        continue;
      }
      const text = interests.trim() ? `User interests: ${interests}` : '';
      const emb = text ? await getEmbedding(openai, text) : [];
      if (emb.length > 0) {
        upsertUserEmbedding(userId, emb, hash);
        refreshed++;
      }
    }
    offset += userIds.length;
  }

  return { usersProcessed, refreshed };
}

async function scoreArticle(
  articleId: string,
  profile: UserProfile,
  userEmb: number[]
): Promise<{ totalScore: number; interestScore: number; difficultyScore: number; interestReason: string; difficultyReason: string; recommendationReason: string } | null> {
  const article = getArticleById(articleId);
  if (!article) return null;

  const articleDiff = article.difficulty_simplified || article.difficulty_original || 'B1';
  const { score: difficultyScore, reason: difficultyReason } = computeDifficultyScore(profile.levelBand, articleDiff);

  const articleEmb = getPrecomputedArticleEmbedding(articleId);
  const interestScore = articleEmb && userEmb.length
    ? Math.round(Math.max(0, Math.min(100, (cosineSimilarity(userEmb, articleEmb) + 1) * 50)))
    : 50;

  const keywords = (() => {
    try {
      return (JSON.parse(article.keywords) as string[]) || [];
    } catch {
      return [];
    }
  })();
  const dislikeOverlap = keywords.filter((k) =>
    profile.dislikeKeywords.some((d) =>
      d.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(d.toLowerCase())
    )
  );
  let finalInterest = interestScore;
  if (dislikeOverlap.length > 0) finalInterest = Math.max(0, interestScore - 30);

  const totalScore = finalInterest * 0.4 + difficultyScore * 0.6;
  return {
    totalScore,
    interestScore: finalInterest,
    difficultyScore,
    interestReason: '',
    difficultyReason,
    recommendationReason: buildRecommendationReason(finalInterest, difficultyScore, totalScore, '', difficultyReason),
  };
}

/** Incremental: score new articles for each user, merge into top 100 */
export async function runIncrementalPrecompute(daysBack = 3): Promise<{ usersProcessed: number; articlesScored: number; newArticleIds: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { usersProcessed: 0, articlesScored: 0, newArticleIds: 0 };

  const openai = new OpenAI({ apiKey });
  let usersProcessed = 0;
  let articlesScored = 0;
  let newArticleIds = 0;
  const activeCount = getActiveUserIds(14).length;
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceStr = since.toISOString().split('T')[0];
  let offset = 0;

  while (true) {
    const userIds = getActiveUserIdsPage(14, PRECOMPUTE_USER_PAGE_SIZE, offset);
    if (userIds.length === 0) break;
    usersProcessed += userIds.length;

    for (const userId of userIds) {
      const profile = buildUserProfileWithOptions(userId, { includeArticleBuckets: false });
      const userEmb = await getOrCreateUserEmbedding(openai, userId, profile);
      const feedbacks = getFeedbackByUser(userId, PRECOMPUTE_FEEDBACK_LIMIT);
      const seenKeys = new Set(feedbacks.map((f) => f.article_key));
      let articleOffset = 0;
      while (true) {
        const articleIds = getArticleIdsCreatedSincePage(sinceStr, PRECOMPUTE_ARTICLE_CHUNK_SIZE, articleOffset);
        if (articleIds.length === 0) break;
        if (usersProcessed === 1) newArticleIds += articleIds.length;
        for (const articleId of articleIds) {
          const article = getArticleById(articleId);
          if (!article || seenKeys.has(article.source_url)) continue;
          if (article.is_vocab_story) continue; // Personalized per user, never score for others

          const articleDiff = article.difficulty_simplified || article.difficulty_original || 'B1';
          const userIdx = DIFFICULTY_ORDER.indexOf(profile.levelBand);
          const articleIdx = DIFFICULTY_ORDER.indexOf(articleDiff);
          if (userIdx >= 0 && articleIdx >= 0 && articleIdx - userIdx > 2) continue;

          const s = await scoreArticle(articleId, profile, userEmb);
          if (s && s.totalScore > 0) {
            upsertUserTopArticle(userId, articleId, s);
            articlesScored++;
          }
        }
        articleOffset += articleIds.length;
      }
      pruneUserTopArticles(userId, TOP_N);
    }
    offset += userIds.length;
    const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    console.log(`[Precompute] processed users=${usersProcessed}/${activeCount}, rss=${rssMb}MB`);
  }

  return { usersProcessed, articlesScored, newArticleIds };
}

/** Full precompute: for users with no cache, score all candidates and populate */
export async function runFullPrecomputeForUser(userId: string): Promise<number> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return 0;

  const profile = buildUserProfile(userId);
  const candidates = getArticlesForRecommendation(100, 14);
  const feedbacks = getFeedbackByUser(userId, 500);
  const seenKeys = new Set(feedbacks.map((f) => f.article_key));

  const openai = new OpenAI({ apiKey });
  const userEmb = await getOrCreateUserEmbedding(openai, userId, profile);
  const userIdx = DIFFICULTY_ORDER.indexOf(profile.levelBand);
  let scored = 0;

  for (const article of candidates) {
    if (seenKeys.has(article.source_url)) continue;
    const articleIdx = DIFFICULTY_ORDER.indexOf(article.difficulty_simplified || article.difficulty_original || 'B1');
    if (userIdx >= 0 && articleIdx >= 0 && articleIdx - userIdx > 2) continue;

    const s = await scoreArticle(article.id, profile, userEmb);
    if (s && s.totalScore > 0) {
      upsertUserTopArticle(userId, article.id, s);
      scored++;
    }
  }
  pruneUserTopArticles(userId, TOP_N);
  return scored;
}
