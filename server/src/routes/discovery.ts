import { Router, Request, Response } from 'express';
import Parser from 'rss-parser';
import { runDailyIngest, runInit } from '../articleIngest.js';
import { getAllArticles, getArticleCount } from '../db.js';
import OpenAI from 'openai';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

export const discoveryRouter = Router();

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

export interface DiscoveryArticle {
  title: string;
  link: string;
  pubDate: string;
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

async function simplifyWithGPT(text: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || text.length < 50) return text;

  const openai = new OpenAI({ apiKey });
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an English teaching assistant. Rewrite the given text to be suitable for IELTS Reading band 6 (intermediate level, B2). 
- Keep the same meaning and structure
- Use simpler vocabulary (common words, avoid jargon)
- Shorten complex sentences into 2 shorter sentences if needed
- Maximum 2 sentences per idea
- Preserve proper nouns, company names, numbers
- Output ONLY the rewritten text, no explanations`,
        },
        {
          role: 'user',
          content: text,
        },
      ],
      max_tokens: 1000,
    });

    const result = completion.choices[0]?.message?.content?.trim();
    return result || text;
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
      pubDate: item.pubDate || new Date().toISOString(),
      description,
      creator: item.creator,
    });
  }
  return raw;
}

discoveryRouter.get('/debug/articles', async (req: Request, res: Response) => {
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

discoveryRouter.post('/init', async (req: Request, res: Response) => {
  try {
    const count = Math.min(20, Math.max(1, parseInt((req.query.count as string) || '20', 10)));
    const result = await runInit(count);
    res.json(result);
  } catch (err) {
    console.error('Init error:', err);
    res.status(500).json({ error: 'Init failed' });
  }
});

discoveryRouter.post('/ingest', async (_req: Request, res: Response) => {
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
  const limit = Math.min(10, Math.max(1, parseInt(req.query.limit as string || '2', 10)));

  const now = Date.now();
  if (!cacheData || now - cacheData.fetchedAt >= CACHE_TTL) {
    try {
      const raw = await fetchAndProcessFeed();
      cacheData = { data: raw, fetchedAt: Date.now() };
    } catch (err) {
      console.error('Discovery fetch error:', err);
      if (cacheData?.data) {
        // Use stale cache
      } else {
        res.status(500).json({ error: 'Failed to fetch discovery articles' });
        return;
      }
    }
  }

  const rawSlice = (cacheData!.data).slice(offset, offset + limit);
  const articles: DiscoveryArticle[] = [];

  for (const r of rawSlice) {
    const simplified = await simplifyWithGPT(r.description);
    articles.push({
      title: r.title,
      link: r.link,
      pubDate: r.pubDate,
      description: r.description,
      simplified,
      source: r.creator || 'Yahoo Finance',
    });
  }

  res.json({
    articles,
    hasMore: offset + limit < cacheData!.data.length,
    total: cacheData!.data.length,
    cached: now - cacheData!.fetchedAt < CACHE_TTL,
  });
});

discoveryRouter.get('/article-by-id/:id', async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!id) {
    res.status(400).json({ error: 'Article id required' });
    return;
  }
  const { getArticleById } = await import('../db.js');
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
  if (!url || !url.startsWith('http')) {
    res.status(400).json({ error: 'Valid url is required' });
    return;
  }

  const { getArticleByUrl } = await import('../db.js');
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
