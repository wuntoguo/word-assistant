/**
 * Daily Article Crawler
 *
 * Runs at midnight (configurable). Crawls major US news RSS feeds by category:
 * - Finance, Tech, Lifestyle, Entertainment, Sports
 *
 * Features:
 * - Rate limiting (2-5s delay between requests)
 * - User-Agent rotation
 * - Retry with exponential backoff
 * - GPT preprocessing (keywords, difficulty, simplification)
 *
 * Language: TypeScript/Node.js - integrates with existing DB, GPT, and deploy.
 * For I/O-bound scraping, Node.js async is sufficient. Python+Scrapy would
 * be an alternative for very high-volume crawling.
 */

import Parser from 'rss-parser';
import OpenAI from 'openai';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { v4 as uuidv4 } from 'uuid';
import { getArticleByUrl, upsertArticle, insertCrawlReport } from './db.js';

const parser = new Parser({ timeout: 15000 });

// --- Feed configuration: category -> RSS URLs (major US news sites) ---
const FEEDS_BY_CATEGORY: Record<string, { url: string; sourceName: string }[]> = {
  finance: [
    { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=AAPL,GOOGL,MSFT,AMZN,TSLA&region=US&lang=en-US', sourceName: 'Yahoo Finance' },
    { url: 'http://rss.cnn.com/rss/money_latest.rss', sourceName: 'CNN Business' },
    { url: 'https://feeds.npr.org/1019/rss.xml', sourceName: 'NPR Business' },
    { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.xml', sourceName: 'CNBC' },
    { url: 'https://feeds.reuters.com/reuters/businessNews', sourceName: 'Reuters' },
  ],
  tech: [
    { url: 'http://rss.cnn.com/rss/cnn_tech.rss', sourceName: 'CNN Tech' },
    { url: 'https://techcrunch.com/feed/', sourceName: 'TechCrunch' },
    { url: 'https://feeds.arstechnica.com/arstechnica/index', sourceName: 'Ars Technica' },
    { url: 'https://feeds.npr.org/1018/rss.xml', sourceName: 'NPR Technology' },
  ],
  lifestyle: [
    { url: 'http://rss.cnn.com/rss/cnn_health.rss', sourceName: 'CNN Health' },
    { url: 'http://rss.cnn.com/rss/cnn_travel.rss', sourceName: 'CNN Travel' },
    { url: 'https://feeds.npr.org/1014/rss.xml', sourceName: 'NPR Health' },
  ],
  entertainment: [
    { url: 'http://rss.cnn.com/rss/cnn_showbiz.rss', sourceName: 'CNN Entertainment' },
    { url: 'https://feeds.npr.org/1008/rss.xml', sourceName: 'NPR Arts' },
    { url: 'https://variety.com/feed/', sourceName: 'Variety' },
  ],
  sports: [
    { url: 'https://www.espn.com/espn/rss/news', sourceName: 'ESPN' },
    { url: 'http://rss.cnn.com/rss/cnn_us.rss', sourceName: 'CNN US' }, // often includes sports
    { url: 'https://feeds.npr.org/1055/rss.xml', sourceName: 'NPR Sports' },
  ],
};

const ARTICLES_PER_CATEGORY = 20;
const MIN_CONTENT_LENGTH = 100;

// Paywalled domains: skip fetching (no full-text access without subscription)
const PAYWALLED_DOMAINS = [
  'wsj.com', 'www.wsj.com', 'wallstreetjournal.com',
  'nytimes.com', 'www.nytimes.com',
  'ft.com', 'www.ft.com',
  'economist.com', 'www.economist.com',
  'bloomberg.com', 'www.bloomberg.com',
  'barrons.com', 'www.barrons.com',
];

function isPaywalledUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return PAYWALLED_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

// --- Rate limiting & anti-blocking ---
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (compatible; FeedLingo/1.0; +https://feedlingo.fly.dev)',
];

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitteredDelay(baseMs: number): Promise<void> {
  const jitter = Math.random() * baseMs * 0.5;
  return delay(baseMs + jitter);
}

async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastErr: Error | null = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (i < maxRetries - 1) {
        const backoff = Math.min(2000 * Math.pow(2, i), 10000);
        await delay(backoff);
      }
    }
  }
  throw lastErr;
}

// --- HTML stripping ---
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[\s]+/g, ' ')
    .trim();
}

// --- GPT helpers (reused from articleIngest) ---
const DIFFICULTY_LEVELS = ['A2', 'B1', 'B2'] as const;
const DIFFICULTY_PROMPTS: Record<string, string> = {
  A2: 'CEFR A2 (elementary): Use very simple words. Short sentences (5-10 words).',
  B1: 'CEFR B1 (intermediate): Use common vocabulary. Clear sentences.',
  B2: 'CEFR B2 (upper-intermediate): IELTS band 6 level. Moderate complexity.',
};

async function simplifyWithGPT(
  openai: OpenAI,
  text: string,
  targetLevel?: string
): Promise<string> {
  if (text.length < 50) return text;
  const levelHint = targetLevel ? DIFFICULTY_PROMPTS[targetLevel] || '' : 'IELTS band 6 (B2)';
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Rewrite for ${levelHint}. Keep same meaning. Output ONLY the rewritten text.`,
        },
        { role: 'user', content: text.slice(0, 4000) },
      ],
      max_tokens: 1500,
    });
    return completion.choices[0]?.message?.content?.trim() || text;
  } catch {
    return text;
  }
}

async function extractKeywordsAndDifficulty(
  openai: OpenAI,
  title: string,
  content: string
): Promise<{ keywords: string[]; difficulty: string; difficultyScore: number }> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Extract 5 topic keywords (English) and CEFR level (A1-C2). JSON: { "keywords": ["kw1",...], "difficulty": "B1", "difficultyScore": 41 }',
        },
        {
          role: 'user',
          content: `Title: ${title}\n\n${content.slice(0, 2000)}\n\nJSON only.`,
        },
      ],
      max_tokens: 150,
    });
    const raw = completion.choices[0]?.message?.content?.trim() || '{}';
    const parsed = JSON.parse(raw.replace(/```\w*\n?|\n?```/g, '')) as {
      keywords?: string[];
      difficulty?: string;
      difficultyScore?: number;
    };
    const kw = Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 5) : [];
    const diff = parsed.difficulty && ['A1','A2','B1','B2','C1','C2'].includes(parsed.difficulty)
      ? parsed.difficulty
      : 'B1';
    const score = typeof parsed.difficultyScore === 'number' ? parsed.difficultyScore : 50;
    return { keywords: kw, difficulty: diff, difficultyScore: score };
  } catch {
    return { keywords: [], difficulty: 'B1', difficultyScore: 50 };
  }
}

const DIFFICULTY_SCORES: Record<string, number> = {
  A1: 10, A2: 25, B1: 41, B2: 56, C1: 71, C2: 86,
};

// --- RSS fetch with rate limit ---
async function fetchFeedItems(
  feedUrl: string,
  sourceNameOverride?: string
): Promise<{ title: string; link: string; content: string; pubDate: string; sourceName: string }[]> {
  const customParser = new Parser({
    timeout: 15000,
    headers: { 'User-Agent': randomUserAgent() },
  });
  const feed = await customParser.parseURL(feedUrl);
  const sourceName = sourceNameOverride || feed.title || 'Unknown';
  return (feed.items || [])
    .filter((i) => i.title && i.link && (i.link as string).startsWith('http'))
    .map((i) => ({
      title: (i.title || 'Untitled').trim(),
      link: (i.link || '').trim(),
      content: stripHtml(
        (i as any).contentSnippet || (i as any).content || (i as any).description || ''
      ),
      pubDate: (i.pubDate || new Date().toISOString()).split('T')[0],
      sourceName,
    }));
}

// --- Full-text extraction (Readability) ---
async function fetchFullContent(url: string, referrer: string): Promise<string> {
  const dom = await JSDOM.fromURL(url, {
    pretendToBeVisual: true,
    userAgent: randomUserAgent(),
    referrer,
  });
  const reader = new Readability(dom.window.document);
  const parsed = reader.parse();
  return parsed?.textContent?.trim() || '';
}

// --- Ingest one article ---
async function ingestArticle(
  openai: OpenAI,
  item: { title: string; link: string; content: string; pubDate: string; sourceName: string; category: string }
): Promise<'ingested' | 'skipped' | 'error'> {
  const url = item.link;
  if (isPaywalledUrl(url)) return 'skipped';
  const existing = getArticleByUrl(url);
  if (existing?.content) return 'skipped';

  let content = '';
  try {
    content = await fetchWithRetry(() =>
      fetchFullContent(url, new URL(url).origin + '/')
    );
  } catch {
    content = item.content;
  }

  if (content.length < MIN_CONTENT_LENGTH && item.content.length < MIN_CONTENT_LENGTH) {
    return 'error';
  }
  if (content.length < MIN_CONTENT_LENGTH) content = item.content;

  const title = item.title;
  const pubDate = item.pubDate;
  const sourceName = item.sourceName;

  const parentId = uuidv4();
  const origMeta = await extractKeywordsAndDifficulty(openai, title, content);

  upsertArticle({
    id: parentId,
    parent_id: null,
    source_url: url,
    title,
    content,
    simplified_content: null,
    keywords: origMeta.keywords,
    is_translated: false,
    difficulty_original: origMeta.difficulty,
    difficulty_simplified: null,
    difficulty_score_original: origMeta.difficultyScore,
    difficulty_score_simplified: null,
    pub_date: pubDate,
    source_name: sourceName,
  });

  // Simplified variants
  for (const level of DIFFICULTY_LEVELS) {
    const simplified = await simplifyWithGPT(openai, content, level);
    const variantId = uuidv4();
    const variantUrl = `${url}#${level}`;
    const simpMeta = await extractKeywordsAndDifficulty(openai, title, simplified);
    const score = DIFFICULTY_SCORES[level] ?? 50;

    upsertArticle({
      id: variantId,
      parent_id: parentId,
      source_url: variantUrl,
      title: `${title} (${level})`,
      content,
      simplified_content: simplified,
      keywords: simpMeta.keywords.length > 0 ? simpMeta.keywords : origMeta.keywords,
      is_translated: true,
      difficulty_original: origMeta.difficulty,
      difficulty_simplified: level,
      difficulty_score_original: origMeta.difficultyScore,
      difficulty_score_simplified: score,
      pub_date: pubDate,
      source_name: sourceName,
    });
  }

  return 'ingested';
}

export interface CrawlResult {
  ingested: number;
  skipped: number;
  errors: number;
  byCategory: Record<string, { ingested: number; skipped: number }>;
  durationMs: number;
}

export async function runDailyCrawl(): Promise<CrawlResult> {
  const start = Date.now();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY required for daily crawl');
  }

  const openai = new OpenAI({ apiKey });
  const result: CrawlResult = {
    ingested: 0,
    skipped: 0,
    errors: 0,
    byCategory: {},
    durationMs: 0,
  };

  const seenUrls = new Set<string>();

  for (const [category, feeds] of Object.entries(FEEDS_BY_CATEGORY)) {
    result.byCategory[category] = { ingested: 0, skipped: 0 };
    const categoryItems: { title: string; link: string; content: string; pubDate: string; sourceName: string; category: string }[] = [];

    for (const { url: feedUrl, sourceName } of feeds) {
      await jitteredDelay(2000); // Rate limit between feed fetches
      try {
        const items = await fetchWithRetry(() => fetchFeedItems(feedUrl, sourceName));
        for (const it of items) {
          if (!seenUrls.has(it.link)) {
            seenUrls.add(it.link);
            categoryItems.push({ ...it, sourceName, category });
          }
        }
      } catch (e) {
        console.error(`[Crawler] Feed failed ${feedUrl}:`, e);
      }
    }

    const toProcess = categoryItems.slice(0, ARTICLES_PER_CATEGORY);

    for (const item of toProcess) {
      await jitteredDelay(3000); // 2–4.5s between article fetches
      try {
        const status = await ingestArticle(openai, item);
        if (status === 'ingested') {
          result.ingested++;
          result.byCategory[category].ingested++;
        } else if (status === 'skipped') {
          result.skipped++;
          result.byCategory[category].skipped++;
        } else {
          result.errors++;
        }
      } catch (e) {
        result.errors++;
        console.error(`[Crawler] Article failed ${item.link}:`, e);
      }
    }
  }

  result.durationMs = Date.now() - start;

  const reportDate = new Date().toISOString().split('T')[0];
  insertCrawlReport({
    reportDate,
    ingested: result.ingested,
    skipped: result.skipped,
    errors: result.errors,
    byCategory: result.byCategory,
    durationMs: result.durationMs,
  });

  return result;
}

export function formatDailyReport(result: CrawlResult): string {
  const date = new Date().toISOString().split('T')[0];
  const lines: string[] = [
    `# Daily Crawl Report — ${date}`,
    '',
    `- **Ingested:** ${result.ingested}`,
    `- **Skipped:** ${result.skipped}`,
    `- **Errors:** ${result.errors}`,
    `- **Duration:** ${(result.durationMs / 1000).toFixed(1)}s`,
    '',
    '## By Category',
    '',
  ];
  for (const [cat, stats] of Object.entries(result.byCategory)) {
    lines.push(`- **${cat}:** ingested=${stats.ingested} skipped=${stats.skipped}`);
  }
  return lines.join('\n');
}
