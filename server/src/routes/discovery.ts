import { Router, Request, Response } from 'express';
import Parser from 'rss-parser';
import net from 'node:net';
import { runDailyIngest, runInit } from '../articleIngest.js';
import {
  getAllArticles,
  getArticleCount,
  getArticleById,
  getArticleByUrl,
  getDiscoveryFulltextArticles,
  getDiscoveryFulltextCount,
} from '../repositories/articleRepo.js';
import OpenAI from 'openai';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

export const discoveryRouter = Router();
const OPS_SECRET = process.env.CRON_SECRET || process.env.ADMIN_SECRET || '';

const parser = new Parser({ timeout: 10000 });

// Tech headlines — major tickers surface high-impact news (ordered by recency/prominence)
const YAHOO_RSS_URL = 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=AAPL,GOOGL,MSFT,AMZN,TSLA,META,NVDA&region=US&lang=en-US';
const CACHE_TTL = 1000 * 60 * 60; // 1 hour
let cacheData: { data: RawArticle[]; fetchedAt: number } | null = null;

interface RawArticle {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  creator?: string;
}

function isAuthorizedOpsRequest(req: Request): boolean {
  if (!OPS_SECRET) return false;
  const auth = req.headers.authorization || req.headers['x-cron-secret'] || req.query?.secret;
  const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '') : String(auth || '');
  return token === OPS_SECRET;
}

function requireOpsAuth(req: Request, res: Response, next: () => void): void {
  if (!isAuthorizedOpsRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

function isPrivateIp(hostname: string): boolean {
  if (!net.isIP(hostname)) return false;
  if (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') return true;

  if (hostname.includes(':')) {
    const normalized = hostname.toLowerCase();
    return normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80');
  }

  const parts = hostname.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isSafeArticleUrl(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }

  if (!['http:', 'https:'].includes(u.protocol)) return false;
  if (u.username || u.password) return false;

  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return false;
  if (isPrivateIp(host)) return false;

  const allowList = (process.env.DISCOVERY_ALLOWED_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowList.length > 0) {
    return allowList.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  }

  return true;
}

export interface DiscoveryArticle {
  title: string;
  link: string;
  pubDate: string;
  postedAt?: string | null;
  crawledAt?: string | null;
  description: string;
  simplified: string;
  source?: string;
  fullContent?: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePubDate(rawPubDate?: string | null, rawIsoDate?: string | null): string {
  const candidates = [rawIsoDate, rawPubDate];
  for (const raw of candidates) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

const SIMPLIFY_CHARS_PER_CHUNK = 2200;
const MAX_SIMPLIFY_CHUNKS = 8;

function splitForSimplify(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (cleaned.length <= SIMPLIFY_CHARS_PER_CHUNK) return [cleaned];

  const paragraphs = cleaned.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    const next = current ? `${current}\n\n${p}` : p;
    if (next.length <= SIMPLIFY_CHARS_PER_CHUNK) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    if (p.length <= SIMPLIFY_CHARS_PER_CHUNK) {
      current = p;
      continue;
    }
    for (let i = 0; i < p.length; i += SIMPLIFY_CHARS_PER_CHUNK) {
      chunks.push(p.slice(i, i + SIMPLIFY_CHARS_PER_CHUNK));
    }
    current = '';
  }
  if (current) chunks.push(current);
  return chunks;
}

async function simplifyWithGPT(text: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || text.length < 50) return text;

  const openai = new OpenAI({ apiKey });
  try {
    const chunks = splitForSimplify(text);
    const rewritten: string[] = [];
    for (const chunk of chunks.slice(0, MAX_SIMPLIFY_CHUNKS)) {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an English teaching assistant. Rewrite to B2 level while preserving exact meaning.
- Do NOT omit or add facts.
- Keep names, numbers, dates, percentages, and entities unchanged.
- Keep paragraph structure close to original.
- Use simpler vocabulary and shorter sentences only.
- Output ONLY rewritten text.`,
          },
          { role: 'user', content: chunk },
        ],
        max_tokens: 1200,
      });
      const result = completion.choices[0]?.message?.content?.trim() || '';
      if (!result) {
        rewritten.push(chunk);
        continue;
      }
      const inWords = chunk.split(/\s+/).filter(Boolean).length;
      const outWords = result.split(/\s+/).filter(Boolean).length;
      rewritten.push(outWords < Math.max(40, Math.floor(inWords * 0.45)) ? chunk : result);
    }
    if (chunks.length > MAX_SIMPLIFY_CHUNKS) rewritten.push(...chunks.slice(MAX_SIMPLIFY_CHUNKS));
    return rewritten.join('\n\n').trim() || text;
  } catch {
    return text;
  }
}

async function fetchAndProcessFeed(): Promise<RawArticle[]> {
  const feed = await parser.parseURL(YAHOO_RSS_URL);
  const items = (feed.items || [])
    .filter((i) => i.title && (i.contentSnippet || i.content || i.description));

  const raw: RawArticle[] = [];
  for (const item of items) {
    const rawDesc = item.contentSnippet || item.content || item.description || '';
    const description = stripHtml(rawDesc);
    if (!description || description.length < 30) continue;
    raw.push({
      title: item.title || 'Untitled',
      link: item.link || '',
      pubDate: normalizePubDate(item.pubDate || null, (item as any).isoDate || null),
      description,
      creator: item.creator,
    });
  }
  return raw;
}

discoveryRouter.get('/debug/articles', requireOpsAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt((req.query.limit as string) || '50', 10)));
    const raw = getAllArticles(limit);
    const articles = raw.map((a) => ({
      id: a.id,
      parent_id: a.parent_id,
      title: a.title,
      source_url: a.source_url,
      keywords: (() => {
        try {
          return JSON.parse(a.keywords) as string[];
        } catch {
          return [];
        }
      })(),
      difficulty_original: a.difficulty_original,
      difficulty_simplified: a.difficulty_simplified,
      is_translated: !!a.is_translated,
      pub_date: a.pub_date,
      source_name: a.source_name,
      content_len: a.content?.length ?? 0,
      simplified_len: a.simplified_content?.length ?? 0,
    }));
    res.json({ count: articles.length, total: getArticleCount(), articles });
  } catch (err) {
    console.error('Debug articles error:', err);
    res.status(500).json({ error: 'Failed to list articles' });
  }
});

discoveryRouter.post('/init', requireOpsAuth, async (req: Request, res: Response) => {
  try {
    const count = Math.min(20, Math.max(1, parseInt((req.query.count as string) || '20', 10)));
    const result = await runInit(count);
    res.json(result);
  } catch (err) {
    console.error('Init error:', err);
    res.status(500).json({ error: 'Init failed' });
  }
});

discoveryRouter.post('/ingest', requireOpsAuth, async (_req: Request, res: Response) => {
  try {
    const result = await runDailyIngest();
    res.json(result);
  } catch (err) {
    console.error('Ingest error:', err);
    res.status(500).json({ error: 'Ingest failed' });
  }
});

discoveryRouter.get('/articles', async (req: Request, res: Response) => {
  const offset = Math.max(0, parseInt(req.query.offset as string || '0', 10));
  const limit = Math.min(10, Math.max(1, parseInt(req.query.limit as string || '10', 10)));
  const daysBack = Math.max(1, parseInt(process.env.DISCOVERY_DAYS_BACK || '3', 10));

  const totalFulltext = getDiscoveryFulltextCount(daysBack);
  const fulltextRows = getDiscoveryFulltextArticles(offset, limit, daysBack);
  const articles: DiscoveryArticle[] = fulltextRows.map((a) => {
    const full = (a.simplified_content || a.content || '').trim();
    const preview = full.slice(0, 600);
    return {
      title: a.title,
      link: a.source_url,
      pubDate: a.pub_date || a.created_at || new Date().toISOString(),
      postedAt: a.pub_date || null,
      crawledAt: a.created_at || null,
      description: preview,
      simplified: preview,
      source: a.source_name || 'Unknown',
    };
  });

  // Fallback: if fulltext pool is temporarily small, fill remainder with RSS summary.
  if (articles.length < limit) {
    const now = Date.now();
    if (!cacheData || now - cacheData.fetchedAt >= CACHE_TTL) {
      try {
        const raw = await fetchAndProcessFeed();
        cacheData = { data: raw, fetchedAt: Date.now() };
      } catch (err) {
        console.error('Discovery fallback RSS fetch error:', err);
      }
    }
    if (cacheData?.data?.length) {
      const rssNeed = limit - articles.length;
      const rssOffset = Math.max(0, offset - totalFulltext);
      const rawSlice = cacheData.data.slice(rssOffset, rssOffset + rssNeed);
      for (const r of rawSlice) {
        articles.push({
          title: r.title,
          link: r.link,
          pubDate: r.pubDate,
          postedAt: r.pubDate || null,
          crawledAt: null,
          description: r.description,
          simplified: r.description,
          source: r.creator || 'Yahoo Finance',
        });
      }
    }
  }

  const rssTotal = cacheData?.data?.length || 0;
  const total = totalFulltext + rssTotal;
  res.json({
    articles,
    hasMore: offset + articles.length < total,
    total,
    fulltextTotal: totalFulltext,
  });
});

discoveryRouter.get('/article-by-id/:id', async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!id) {
    res.status(400).json({ error: 'Article id required' });
    return;
  }
  const article = getArticleById(id);
  if (!article) {
    res.status(404).json({ error: 'Article not found' });
    return;
  }
  res.json({
    title: article.title,
    content: article.content || '',
    simplified: article.simplified_content || article.content || '',
    siteName: article.source_name || '',
  });
});

discoveryRouter.get('/article-content', async (req: Request, res: Response) => {
  const url = req.query.url as string;
  const fallbackSnippet = (req.query.fallback as string)?.trim();
  if (!url || !isSafeArticleUrl(url)) {
    res.status(400).json({ error: 'Valid url is required' });
    return;
  }

  const fromDb = getArticleByUrl(url);
  if (fromDb?.content) {
    res.json({
      title: fromDb.title,
      content: fromDb.content,
      simplified: fromDb.simplified_content || fromDb.content,
      siteName: fromDb.source_name || '',
    });
    return;
  }

  const useFallback = (text: string) => {
    const content = text || fallbackSnippet || 'No content available.';
    return simplifyWithGPT(content).then((simplified) =>
      res.json({ title: '', content, simplified, siteName: '', fromFallback: true })
    );
  };

  try {
    const dom = await JSDOM.fromURL(url, {
      pretendToBeVisual: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      referrer: 'https://finance.yahoo.com/',
    });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.textContent || article.textContent.length < 100) {
      if (fallbackSnippet && fallbackSnippet.length > 50) {
        await useFallback(fallbackSnippet);
        return;
      }
      res.status(404).json({ error: 'Could not extract article content' });
      return;
    }

    const simplified = await simplifyWithGPT(article.textContent);

    res.json({
      title: article.title,
      content: article.textContent,
      simplified,
      siteName: article.siteName,
    });
  } catch (err) {
    console.error('Article content fetch error:', err);
    if (fallbackSnippet && fallbackSnippet.length > 50) {
      try {
        await useFallback(fallbackSnippet);
        return;
      } catch {
        // ignore
      }
    }
    res.status(500).json({ error: 'Failed to fetch article content' });
  }
});

// Weekly test: 1 article + 5 multiple choice questions
discoveryRouter.get('/weekly-test', async (_req: Request, res: Response) => {
  try {
    const raw = await fetchAndProcessFeed();
    if (!raw.length) {
      res.status(404).json({ error: 'No articles available' });
      return;
    }
    const r = raw[0];
    const simplified = await simplifyWithGPT(r.description);

    const apiKey = process.env.OPENAI_API_KEY;
    let questions: { question: string; options: string[]; correct: number }[] = [];
    if (apiKey && simplified.length > 100) {
      try {
        const openai = new OpenAI({ apiKey });
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `Generate exactly 5 reading comprehension multiple choice questions about the given English text.
Output a JSON array. Each item: { "question": "...", "options": ["A", "B", "C", "D"], "correct": 0 } (0-3 index of correct option).
Questions should test understanding. Options: 4 per question. Use simple English. Output ONLY the JSON array, no markdown.`,
            },
            { role: 'user', content: simplified },
          ],
          max_tokens: 1500,
        });
        const text = completion.choices[0]?.message?.content?.trim() || '[]';
        const parsed = JSON.parse(text.replace(/```\w*\n?|\n?```/g, '')) as typeof questions;
        if (Array.isArray(parsed) && parsed.length >= 3) {
          questions = parsed.slice(0, 5);
        }
      } catch {
        // fallback questions
      }
    }

    if (questions.length === 0) {
      questions = [
        { question: 'What is the main topic of this article?', options: ['Technology', 'Business', 'Science', 'Culture'], correct: 0 },
        { question: 'Who or what is the article primarily about?', options: ['A company', 'A person', 'An event', 'A product'], correct: 0 },
      ];
    }

    res.json({
      article: {
        title: r.title,
        content: simplified,
        source: r.creator,
      },
      questions,
    });
  } catch (err) {
    console.error('Weekly test error:', err);
    res.status(500).json({ error: 'Failed to generate weekly test' });
  }
});
