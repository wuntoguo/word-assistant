import { recommendRepo } from '../../repositories/recommendRepo.js';
import { getUserProfileDaily } from '../../repositories/userProfileDailyRepo.js';
import { DIFFICULTY_ORDER, type UserProfile } from './types.js';

function getLevelBand(score: number): string {
  if (score <= 20) return 'A1';
  if (score <= 40) return 'A2';
  if (score <= 55) return 'B1';
  if (score <= 70) return 'B2';
  if (score <= 85) return 'C1';
  return 'C2';
}

export function buildUserProfile(userId: string): UserProfile {
  return buildUserProfileWithOptions(userId, { includeArticleBuckets: true });
}

export function buildUserProfileWithOptions(
  userId: string,
  options?: { includeArticleBuckets?: boolean }
): UserProfile {
  const includeArticleBuckets = options?.includeArticleBuckets !== false;
  const tests = recommendRepo.getTestResultsByUser(userId, 8);
  const feedbacks = recommendRepo.getFeedbackByUser(userId, 80);
  const staticProfile = recommendRepo.getUserProfile(userId);

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

  const tooHardCount = withDifficulty.filter((f) => f.hard === 1).length;
  const tooEasyCount = withDifficulty.filter((f) => f.hard === -1).length;
  if (withDifficulty.length >= 3) {
    const tooHardRatio = tooHardCount / withDifficulty.length;
    const tooEasyRatio = tooEasyCount / withDifficulty.length;
    if (tooHardRatio > 0.5) levelScore = Math.max(0, levelScore - 15);
    else if (tooEasyRatio > 0.5) levelScore = Math.min(100, levelScore + 10);
    levelBand = getLevelBand(levelScore);
  }

  if (staticProfile?.preferred_level_band && DIFFICULTY_ORDER.includes(staticProfile.preferred_level_band)) {
    levelBand = staticProfile.preferred_level_band;
  }

  const interestKeywords: string[] = [];
  const dislikeKeywords: string[] = [];
  const suitableDifficultyArticles: { keywords: string[]; difficulty: string }[] = includeArticleBuckets ? [] : [];
  const tooHardArticles: { keywords: string[]; difficulty: string }[] = includeArticleBuckets ? [] : [];
  const tooEasyArticles: { keywords: string[]; difficulty: string }[] = includeArticleBuckets ? [] : [];

  for (const f of feedbacks) {
    const article = f.article_id ? recommendRepo.getArticleById(f.article_id) : recommendRepo.getArticleByUrl(f.article_key);
    if (!article) continue;

    let kw: string[] = [];
    try {
      kw = (JSON.parse(article.keywords) as string[]) || [];
    } catch {
      kw = [];
    }

    const diff = article.difficulty_simplified || article.difficulty_original || 'B1';

    if (f.liked === 1) interestKeywords.push(...kw);
    else if (f.liked === 0) dislikeKeywords.push(...kw);

    if (includeArticleBuckets) {
      if (f.hard === 0) suitableDifficultyArticles.push({ keywords: kw, difficulty: diff });
      else if (f.hard === 1) tooHardArticles.push({ keywords: kw, difficulty: diff });
      else if (f.hard === -1) tooEasyArticles.push({ keywords: kw, difficulty: diff });
    }
  }

  const staticInterests = (() => {
    try {
      return (staticProfile?.interest_keywords ? JSON.parse(staticProfile.interest_keywords) : []) as string[];
    } catch {
      return [];
    }
  })();

  const dailyProfile = getUserProfileDaily(userId);
  const dailyInterests = (() => {
    try {
      return dailyProfile?.interest_keywords_json ? (JSON.parse(dailyProfile.interest_keywords_json) as string[]) : [];
    } catch {
      return [];
    }
  })();
  const dailyDislikes = (() => {
    try {
      return dailyProfile?.dislike_keywords_json ? (JSON.parse(dailyProfile.dislike_keywords_json) as string[]) : [];
    } catch {
      return [];
    }
  })();

  const uniqueInterest = [...new Set([...staticInterests, ...dailyInterests, ...interestKeywords])].slice(0, 40);
  const uniqueDislike = [...new Set([...dailyDislikes, ...dislikeKeywords])].slice(0, 30);

  return {
    levelBand,
    levelScore,
    interestKeywords: uniqueInterest,
    dislikeKeywords: uniqueDislike,
    suitableDifficultyArticles: includeArticleBuckets ? suitableDifficultyArticles.slice(-20) : [],
    tooHardArticles: includeArticleBuckets ? tooHardArticles.slice(-15) : [],
    tooEasyArticles: includeArticleBuckets ? tooEasyArticles.slice(-15) : [],
  };
}
