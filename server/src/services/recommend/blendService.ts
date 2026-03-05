import { getVocabStoriesForToday, getVocabStoriesForUser, getRecentTopicArticles, type DbArticle } from '../../repositories/articleRepo.js';
import type { ScoredArticle } from './types.js';
import { buildRecommendationReason, computeFreshnessScore, demotionFactor, scoreWithFreshness } from './scoring.js';

export interface RecommendPayloadItem {
  id: string;
  _adjustedTotal: number;
  title: string;
  link: string;
  pubDate: string | null;
  postedAt?: string | null;
  crawledAt?: string | null;
  description: string;
  simplified: string;
  source?: string | null;
  keywords: string[];
  difficulty: string | null;
  scores?: {
    interestScore: number;
    difficultyScore: number;
    totalScore: number;
    interestReason: string;
    difficultyReason: string;
    freshnessScore?: number;
    showCount?: number;
    adjustedTotal?: number;
  };
  recommendationReason: string;
  isVocabStory: boolean;
}

function parseKeywords(raw: string): string[] {
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export function buildRankedPayload(
  articles: ScoredArticle[],
  showCounts: Map<string, number>,
  showDebug: boolean
): RecommendPayloadItem[] {
  return articles.map((s) => {
    const freshness = computeFreshnessScore(s.article);
    const cnt = showCounts.get(s.article.source_url) ?? 0;
    const withFreshness = scoreWithFreshness(s.totalScore, freshness, s.article);
    const adjustedTotal = withFreshness * demotionFactor(cnt);

    return {
      id: s.article.id,
      _adjustedTotal: adjustedTotal,
      title: s.article.title,
      link: s.article.source_url,
      pubDate: s.article.pub_date,
      postedAt: s.article.pub_date,
      crawledAt: s.article.created_at,
      description: s.article.simplified_content?.slice(0, 300) || s.article.content?.slice(0, 300) || '',
      simplified: s.article.simplified_content || s.article.content || '',
      source: s.article.source_name,
      keywords: parseKeywords(s.article.keywords),
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
      recommendationReason: buildRecommendationReason(
        s.interestScore,
        s.difficultyScore,
        s.totalScore,
        s.interestReason,
        s.difficultyReason
      ),
      isVocabStory: false,
    };
  });
}

export function blendVocabStories(
  userId: string,
  offset: number,
  payload: RecommendPayloadItem[],
  showDebug: boolean,
  showCounts: Map<string, number>
): RecommendPayloadItem[] {
  if (offset !== 0) return payload;

  const toVocabPayload = (a: DbArticle): RecommendPayloadItem => ({
    id: a.id,
    title: a.title,
    link: a.source_url,
    pubDate: a.pub_date,
    postedAt: a.pub_date,
    crawledAt: a.created_at,
    description: (a.simplified_content || a.content || '').slice(0, 300),
    simplified: a.simplified_content || a.content || '',
    source: a.source_name || 'FeedLingo Vocab Story',
    keywords: parseKeywords(a.keywords),
    difficulty: a.difficulty_simplified || a.difficulty_original,
    _adjustedTotal: 120, // Always pin vocab story at the front of page 1
    scores: showDebug
      ? {
          interestScore: 90,
          difficultyScore: 100,
          totalScore: 96,
          interestReason: 'Personalized from your vocabulary',
          difficultyReason: 'Matches your level',
          freshnessScore: 100,
          showCount: showCounts.get(a.source_url) ?? 0,
          adjustedTotal: 120,
        }
      : undefined,
    recommendationReason: buildRecommendationReason(90, 100, 96, 'Personalized from your vocabulary', 'Matches your level'),
    isVocabStory: true,
  });

  const storyPool = getVocabStoriesForToday(userId, 3);
  const fallbackPool = storyPool.length > 0 ? storyPool : getVocabStoriesForUser(userId, 3);
  if (fallbackPool.length === 0) return payload;

  // Round-robin by exposure count: pick the least shown story for this request.
  fallbackPool.sort((a, b) => {
    const showA = showCounts.get(a.source_url) ?? 0;
    const showB = showCounts.get(b.source_url) ?? 0;
    if (showA !== showB) return showA - showB;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const pinned = toVocabPayload(fallbackPool[0]);
  const dedupedPayload = payload.filter((p) => p.link !== pinned.link);
  return [pinned, ...dedupedPayload];
}

const FINANCE_SOURCES = new Set(['Yahoo Finance', 'CNN Business', 'NPR Business']);
const TRAVEL_SOURCES = new Set(['CNN Travel']);
const FINANCE_KEYWORDS = ['finance', 'business', 'market', 'stock', 'invest', 'economy', 'earnings', 'fed', 'ipo'];
const TRAVEL_KEYWORDS = ['travel', 'trip', 'tourism', 'flight', 'hotel', 'destination', 'vacation', 'airline'];

function containsAny(text: string, words: string[]): boolean {
  const t = text.toLowerCase();
  return words.some((w) => t.includes(w));
}

function isFinanceItem(p: RecommendPayloadItem): boolean {
  const source = (p.source || '').toString();
  if (FINANCE_SOURCES.has(source)) return true;
  const blob = `${p.title} ${p.keywords.join(' ')} ${p.description}`;
  return containsAny(blob, FINANCE_KEYWORDS);
}

function isTravelItem(p: RecommendPayloadItem): boolean {
  const source = (p.source || '').toString();
  if (TRAVEL_SOURCES.has(source)) return true;
  const blob = `${p.title} ${p.keywords.join(' ')} ${p.description}`;
  return containsAny(blob, TRAVEL_KEYWORDS);
}

export function diversifyFinanceTravel(payload: RecommendPayloadItem[], offset: number): RecommendPayloadItem[] {
  if (offset !== 0 || payload.length < 4) return payload;

  const hasVocabStory = payload[0]?.isVocabStory === true;
  const start = hasVocabStory ? 1 : 0;
  const head = payload.slice(0, start);
  const body = payload.slice(start);
  const firstWindow = body.slice(0, Math.min(10, body.length));
  const tail = body.slice(firstWindow.length);

  const finance = firstWindow.find(isFinanceItem);
  const travel = firstWindow.find((p) => p !== finance && isTravelItem(p));

  const existingLinks = new Set(payload.map((p) => p.link));
  const toTopicPayload = (a: DbArticle, tag: 'finance' | 'travel'): RecommendPayloadItem => ({
    id: a.id,
    title: a.title,
    link: a.source_url,
    pubDate: a.pub_date,
    postedAt: a.pub_date,
    crawledAt: a.created_at,
    description: (a.simplified_content || a.content || '').slice(0, 300),
    simplified: a.simplified_content || a.content || '',
    source: a.source_name || 'Unknown',
    keywords: parseKeywords(a.keywords),
    difficulty: a.difficulty_simplified || a.difficulty_original,
    _adjustedTotal: 85,
    scores: undefined,
    recommendationReason: tag === 'finance'
      ? 'Balanced mix: added one finance article'
      : 'Balanced mix: added one travel article',
    isVocabStory: false,
  });

  const backfillFinance = !finance
    ? getRecentTopicArticles('finance', 3, 3).find((a) => !existingLinks.has(a.source_url))
    : undefined;
  const backfillTravel = !travel
    ? getRecentTopicArticles('travel', 3, 3).find((a) => !existingLinks.has(a.source_url))
    : undefined;

  const selected = [
    finance || (backfillFinance ? toTopicPayload(backfillFinance, 'finance') : undefined),
    travel || (backfillTravel ? toTopicPayload(backfillTravel, 'travel') : undefined),
  ].filter(Boolean) as RecommendPayloadItem[];
  if (selected.length === 0) return payload;

  const selectedLinks = new Set(selected.map((s) => s.link));
  const reorderedWindow = [...selected, ...firstWindow.filter((p) => !selectedLinks.has(p.link))];
  return [...head, ...reorderedWindow, ...tail];
}
