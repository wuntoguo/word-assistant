import OpenAI from 'openai';
import {
  getArticlesForRecommendation,
  getArticlesForAudioGeneration,
  getFeedbackByUser,
  getArticleById,
  getArticleByUrl,
  getTestResultsByUser,
  getUserProfile,
  getUserTopArticlesWithArticle,
  upsertUserTopArticle,
  pruneUserTopArticles,
  getArticleShowCounts,
  type DbArticle,
} from './db.js';
import { getArticleAudioPath } from './articleTts.js';

/** Demotion: 1/(1 + 0.2*count), e.g. 0→1, 1→0.83, 5→0.5 */
function demotionFactor(showCount: number): number {
  return 1 / (1 + 0.2 * Math.max(0, showCount));
}

const DIFFICULTY_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** Freshness score 0–100 based on article age. Newer = higher. ~14 days to decay to 0. */
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

/** Apply freshness: newer articles get full score, old penalized up to 80%. Recency bonus for <2 days. */
export function scoreWithFreshness(baseScore: number, freshnessScore: number, article: DbArticle): number {
  const multiplier = 0.2 + 0.8 * (freshnessScore / 100); // old articles drop to 0.2x
  let score = baseScore * multiplier;
  const dateStr = article.pub_date || article.created_at;
  if (dateStr) {
    try {
      const daysOld = (Date.now() - new Date(dateStr).getTime()) / 864e5;
      if (daysOld < 2) score *= 1.15; // +15% boost for today/yesterday
    } catch {
      //
    }
  }
  return score;
}

function levelBandToScore(band: string): number {
  const i = DIFFICULTY_ORDER.indexOf(band);
  return i >= 0 ? (i + 1) * 17 : 50;
}

function getLevelBand(score: number): string {
  if (score <= 20) return 'A1';
  if (score <= 40) return 'A2';
  if (score <= 55) return 'B1';
  if (score <= 70) return 'B2';
  if (score <= 85) return 'C1';
  return 'C2';
}

export interface UserProfile {
  levelBand: string;
  levelScore: number;
  interestKeywords: string[];
  dislikeKeywords: string[];
  suitableDifficultyArticles: { keywords: string[]; difficulty: string }[];
  tooHardArticles: { keywords: string[]; difficulty: string }[];
  tooEasyArticles: { keywords: string[]; difficulty: string }[];
}

export function buildUserProfile(userId: string): UserProfile {
  const tests = getTestResultsByUser(userId, 8);
  const feedbacks = getFeedbackByUser(userId, 80);
  const staticProfile = getUserProfile(userId);

  let testScore = 50;
  if (tests.length > 0) {
    testScore = tests.reduce((s, t) => s + (t.total > 0 ? (t.score / t.total) * 100 : 50), 0) / tests.length;
  }
  let feedbackScore = 50;
  const withDifficulty = feedbacks.filter((f) => f.hard !== null);
  if (withDifficulty.length > 0) {
    const suitable = withDifficulty.filter((f) => f.hard === 0).length;
    feedbackScore = (suitable / withDifficulty.length) * 100;
  }
  let levelScore = Math.round(testScore * 0.6 + feedbackScore * 0.4);
  let levelBand = getLevelBand(Math.max(0, Math.min(100, levelScore)));

  // Calibrate level from "too hard" / "too easy" feedback
  const tooHardCount = withDifficulty.filter((f) => f.hard === 1).length;
  const tooEasyCount = withDifficulty.filter((f) => f.hard === -1).length;
  if (withDifficulty.length >= 3) {
    const tooHardRatio = tooHardCount / withDifficulty.length;
    const tooEasyRatio = tooEasyCount / withDifficulty.length;
    if (tooHardRatio > 0.5) levelScore = Math.max(0, levelScore - 15);
    else if (tooEasyRatio > 0.5) levelScore = Math.min(100, levelScore + 10);
    levelBand = getLevelBand(levelScore);
  }

  if (staticProfile?.preferred_level_band) {
    levelBand = staticProfile.preferred_level_band;
  }

  const interestKeywords: string[] = [];
  const dislikeKeywords: string[] = [];
  const suitableDifficultyArticles: { keywords: string[]; difficulty: string }[] = [];
  const tooHardArticles: { keywords: string[]; difficulty: string }[] = [];
  const tooEasyArticles: { keywords: string[]; difficulty: string }[] = [];

  for (const f of feedbacks) {
    const article = f.article_id ? getArticleById(f.article_id) : getArticleByUrl(f.article_key);
    if (!article) continue;

    let kw: string[] = [];
    try {
      kw = JSON.parse(article.keywords) as string[] || [];
    } catch {
      //
    }
    const diff = article.difficulty_simplified || article.difficulty_original || 'B1';

    if (f.liked === 1) interestKeywords.push(...kw);
    else if (f.liked === 0) dislikeKeywords.push(...kw);

    if (f.hard === 0) suitableDifficultyArticles.push({ keywords: kw, difficulty: diff });
    else if (f.hard === 1) tooHardArticles.push({ keywords: kw, difficulty: diff });
    else if (f.hard === -1) tooEasyArticles.push({ keywords: kw, difficulty: diff });
  }

  const staticInterests = (() => {
    try {
      return (staticProfile?.interest_keywords ? JSON.parse(staticProfile.interest_keywords) : []) as string[];
    } catch {
      return [];
    }
  })();

  const uniqueInterest = [...new Set([...staticInterests, ...interestKeywords])].slice(0, 40);
  const uniqueDislike = [...new Set(dislikeKeywords)].slice(0, 30);

  return {
    levelBand,
    levelScore,
    interestKeywords: uniqueInterest,
    dislikeKeywords: uniqueDislike,
    suitableDifficultyArticles: suitableDifficultyArticles.slice(-20),
    tooHardArticles: tooHardArticles.slice(-15),
    tooEasyArticles: tooEasyArticles.slice(-15),
  };
}

export interface ScoredArticle {
  article: DbArticle;
  interestScore: number;
  difficultyScore: number;
  totalScore: number;
  interestReason: string;
  difficultyReason: string;
  recommendationReason: string;
}

const EMBEDDING_MODEL = 'text-embedding-3-small';

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
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/** Build recommendation reason in English with score breakdown */
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

function computeDifficultyScore(userLevel: string, articleLevel: string): { score: number; reason: string } {
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

async function computeSemanticInterestScore(
  openai: OpenAI,
  userEmbedding: number[],
  articleTitle: string,
  articleKeywords: string[],
  articleExcerpt: string
): Promise<number> {
  const articleText = [articleTitle, articleKeywords.join(', '), articleExcerpt.slice(0, 500)]
    .filter(Boolean)
    .join(' ');
  if (userEmbedding.length === 0 || !articleText.trim()) return 50;

  const articleEmb = await getEmbedding(openai, `Article: ${articleText}`);
  const sim = cosineSimilarity(userEmbedding, articleEmb);
  return Math.round(Math.max(0, Math.min(100, (sim + 1) * 50)));
}

async function scoreArticleWithGPT(
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

  const { score: difficultyScore, reason: difficultyReason } = computeDifficultyScore(
    profile.levelBand,
    articleDifficulty
  );

  const textForScoring = (article.simplified_content || article.content || article.title || '').slice(0, 800);

  const interestScore = await computeSemanticInterestScore(
    openai,
    userEmbedding,
    article.title,
    keywords,
    textForScoring
  );

  const sys = `You provide a brief interest match reason for an English learner. Output valid JSON only.
Format: { "interestReason": "one sentence in English - why this article matches user interests" }
User interest topics: ${profile.interestKeywords.join(', ') || 'none yet'}
Topics to avoid (user disliked): ${profile.dislikeKeywords.join(', ') || 'none'}
Article topics: ${keywords.join(', ')}`;

  const userContent = `Article: ${article.title}\nExcerpt: ${textForScoring.slice(0, 300)}\n\nGenerate interestReason.`;

  let interestReason = '';
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userContent },
      ],
      max_tokens: 100,
    });
    const raw = completion.choices[0]?.message?.content?.trim() || '{}';
    const parsed = JSON.parse(raw.replace(/```\w*\n?|\n?```/g, '')) as { interestReason?: string };
    interestReason = parsed.interestReason || '';
  } catch {
    interestReason = '';
  }

  const totalScore = interestScore * 0.4 + difficultyScore * 0.6;
  const recommendationReason = buildRecommendationReason(
    interestScore,
    difficultyScore,
    totalScore,
    interestReason,
    difficultyReason
  );
  return {
    interestScore,
    difficultyScore,
    totalScore,
    interestReason,
    difficultyReason,
    recommendationReason,
  };
}

export async function getRecommendedArticles(
  userId: string,
  limit = 10,
  showDebug = true,
  offset = 0
): Promise<{ articles: ScoredArticle[]; profile: UserProfile; hasMore?: boolean }> {
  const profile = buildUserProfile(userId);
  const feedbacks = getFeedbackByUser(userId, 100);
  const seenArticleKeys = new Set(feedbacks.map((f) => f.article_key));
  const showCounts = getArticleShowCounts(userId);
  // Debug: no filtering by shown; use demotion by show_count instead

  const cached = getUserTopArticlesWithArticle(userId, 200);
  const fromCache = cached
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

  if (fromCache.length > 0) {
    const sourceKey = (a: ScoredArticle) => a.article.parent_id || a.article.id;
    const adjustedScore = (s: ScoredArticle) => {
      const fresh = computeFreshnessScore(s.article);
      const base = scoreWithFreshness(s.totalScore, fresh, s.article);
      return base * demotionFactor(showCounts.get(s.article.source_url) ?? 0);
    };
    const bySource = new Map<string, ScoredArticle>();
    for (const s of fromCache) {
      const key = sourceKey(s);
      const existing = bySource.get(key);
      if (!existing || adjustedScore(s) > adjustedScore(existing)) {
        bySource.set(key, s);
      }
    }
    const deduped = [...bySource.values()].sort((a, b) => {
      const freshA = computeFreshnessScore(a.article);
      const freshB = computeFreshnessScore(b.article);
      const baseA = scoreWithFreshness(a.totalScore, freshA, a.article);
      const baseB = scoreWithFreshness(b.totalScore, freshB, b.article);
      const cntA = showCounts.get(a.article.source_url) ?? 0;
      const cntB = showCounts.get(b.article.source_url) ?? 0;
      const scoreA = baseA * demotionFactor(cntA);
      const scoreB = baseB * demotionFactor(cntB);
      return scoreB - scoreA;
    });
    const sliced = deduped.slice(offset, offset + limit);
    return {
      articles: sliced,
      profile,
      hasMore: offset + limit < deduped.length,
    };
  }


  const candidates = getArticlesForRecommendation(150, 21);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || candidates.length === 0) {
    const unfiltered = candidates
      .filter((a) => !seenArticleKeys.has(a.source_url))
      .sort((a, b) => {
        const freshA = computeFreshnessScore(a);
        const freshB = computeFreshnessScore(b);
        const baseA = scoreWithFreshness(50, freshA, a);
        const baseB = scoreWithFreshness(50, freshB, b);
        const cntA = showCounts.get(a.source_url) ?? 0;
        const cntB = showCounts.get(b.source_url) ?? 0;
        return baseB * demotionFactor(cntB) - baseA * demotionFactor(cntA);
      });
    const sliced = unfiltered.slice(offset, offset + limit);
    return {
      articles: sliced.map((a) => ({
        article: a,
        interestScore: 50,
        difficultyScore: 50,
        totalScore: 50,
        interestReason: '',
        difficultyReason: '',
        recommendationReason: buildRecommendationReason(50, 50, 50, '', ''),
      })),
      profile,
      hasMore: offset + limit < unfiltered.length,
    };
  }

  const openai = new OpenAI({ apiKey });
  const DIFFICULTY_GAP = 2;
  const userLevelIdx = DIFFICULTY_ORDER.indexOf(profile.levelBand);

  const userText = profile.interestKeywords.length > 0 ? profile.interestKeywords.join(', ') : '';
  const userEmbedding = userText.trim()
    ? await getEmbedding(openai, `User interests: ${userText}`)
    : [];

  const scored: ScoredArticle[] = [];
  for (const article of candidates) {
    const articleKey = article.source_url;
    if (seenArticleKeys.has(articleKey)) continue; // only feedback, no shown filter

    const articleDiff = article.difficulty_simplified || article.difficulty_original || 'B1';
    const articleIdx = DIFFICULTY_ORDER.indexOf(articleDiff);
    if (articleIdx >= 0 && userLevelIdx >= 0 && articleIdx - userLevelIdx > DIFFICULTY_GAP) {
      continue;
    }

    let s = await scoreArticleWithGPT(openai, article, profile, userEmbedding);

    const articleKeywords = (() => {
      try {
        return (JSON.parse(article.keywords) as string[]) || [];
      } catch {
        return [];
      }
    })();
    const dislikeOverlap = articleKeywords.filter((k) =>
      profile.dislikeKeywords.some((d) => d.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(d.toLowerCase()))
    );
    if (dislikeOverlap.length > 0) {
      const newInterest = Math.max(0, s.interestScore - 30);
      s = { ...s, interestScore: newInterest, totalScore: newInterest * 0.4 + s.difficultyScore * 0.6 };
    }

    scored.push({ ...s, article });
  }

  scored.sort((a, b) => {
    const freshA = computeFreshnessScore(a.article);
    const freshB = computeFreshnessScore(b.article);
    const baseA = scoreWithFreshness(a.totalScore, freshA, a.article);
    const baseB = scoreWithFreshness(b.totalScore, freshB, b.article);
    const cntA = showCounts.get(a.article.source_url) ?? 0;
    const cntB = showCounts.get(b.article.source_url) ?? 0;
    return baseB * demotionFactor(cntB) - baseA * demotionFactor(cntA);
  });

  const sourceKey = (a: ScoredArticle) => a.article.parent_id || a.article.id;
  const adjustedScore = (s: ScoredArticle) => {
    const fresh = computeFreshnessScore(s.article);
    const base = scoreWithFreshness(s.totalScore, fresh, s.article);
    return base * demotionFactor(showCounts.get(s.article.source_url) ?? 0);
  };
  const bySource = new Map<string, ScoredArticle>();
  for (const s of scored) {
    const key = sourceKey(s);
    const existing = bySource.get(key);
    if (!existing || adjustedScore(s) > adjustedScore(existing)) {
      bySource.set(key, s);
    }
  }

  const deduped = [...bySource.values()].sort((a, b) => {
    const freshA = computeFreshnessScore(a.article);
    const freshB = computeFreshnessScore(b.article);
    const baseA = scoreWithFreshness(a.totalScore, freshA, a.article);
    const baseB = scoreWithFreshness(b.totalScore, freshB, b.article);
    const cntA = showCounts.get(a.article.source_url) ?? 0;
    const cntB = showCounts.get(b.article.source_url) ?? 0;
    return baseB * demotionFactor(cntB) - baseA * demotionFactor(cntA);
  });
  const top = deduped.slice(offset, offset + limit);

  for (const s of deduped.slice(0, 100)) {
    upsertUserTopArticle(userId, s.article.id, {
      totalScore: s.totalScore,
      interestScore: s.interestScore,
      difficultyScore: s.difficultyScore,
      interestReason: s.interestReason,
      difficultyReason: s.difficultyReason,
      recommendationReason: s.recommendationReason,
    });
  }
  pruneUserTopArticles(userId, 100);

  return {
    articles: top,
    profile,
    hasMore: offset + limit < deduped.length,
  };
}

/** Audio tab: recommended articles that have TTS audio. Same scoring as Discovery but only from audio pool. */
export function getRecommendedAudioArticles(userId: string | null): ScoredArticle[] {
  const articles = getArticlesForAudioGeneration().filter((a) => getArticleAudioPath(a.id));
  if (articles.length === 0) return [];

  const profile = userId ? buildUserProfile(userId) : { levelBand: 'B1', levelScore: 50, interestKeywords: [], dislikeKeywords: [], suitableDifficultyArticles: [], tooHardArticles: [], tooEasyArticles: [] };
  const seenKeys = userId ? new Set(getFeedbackByUser(userId, 100).map((f) => f.article_key)) : new Set<string>();
  const showCounts = userId ? getArticleShowCounts(userId) : new Map<string, number>();

  const cacheByArtId = new Map<string, ScoredArticle>();
  if (userId) {
    const cached = getUserTopArticlesWithArticle(userId, 500);
    for (const c of cached) {
      if (getArticleAudioPath(c.article.id)) {
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
  }

  const scored: ScoredArticle[] = [];
  for (const article of articles) {
    if (seenKeys.has(article.source_url)) continue;

    let s: ScoredArticle;
    const cached = cacheByArtId.get(article.id);
    if (cached) {
      s = cached;
    } else {
      const articleDiff = article.difficulty_simplified || article.difficulty_original || 'B1';
      const { score: difficultyScore, reason: difficultyReason } = computeDifficultyScore(profile.levelBand, articleDiff);
      const interestScore = 50;
      const totalScore = interestScore * 0.4 + difficultyScore * 0.6;
      s = {
        article,
        interestScore,
        difficultyScore,
        totalScore,
        interestReason: '',
        difficultyReason,
        recommendationReason: buildRecommendationReason(interestScore, difficultyScore, totalScore, '', difficultyReason),
      };
    }
    scored.push(s);
  }

  scored.sort((a, b) => {
    const freshA = computeFreshnessScore(a.article);
    const freshB = computeFreshnessScore(b.article);
    const baseA = scoreWithFreshness(a.totalScore, freshA, a.article);
    const baseB = scoreWithFreshness(b.totalScore, freshB, b.article);
    const cntA = showCounts.get(a.article.source_url) ?? 0;
    const cntB = showCounts.get(b.article.source_url) ?? 0;
    return baseB * demotionFactor(cntB) - baseA * demotionFactor(cntA);
  });

  return scored;
}
