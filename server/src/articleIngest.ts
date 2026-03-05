import Parser from 'rss-parser';
import OpenAI from 'openai';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { v4 as uuidv4 } from 'uuid';
import { getArticleByUrl, upsertArticle } from './repositories/articleRepo.js';

const parser = new Parser({ timeout: 10000 });
const YAHOO_RSS_URL =
  'https://feeds.finance.yahoo.com/rss/2.0/headline?s=AAPL,GOOGL,MSFT,AMZN,TSLA,META,NVDA&region=US&lang=en-US';

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const DIFFICULTY_LEVELS = ['A2', 'B1', 'B2'] as const;
const DIFFICULTY_PROMPTS: Record<string, string> = {
  A2: 'CEFR A2 (elementary): Use very simple words (500-1000 word list). Short sentences (5-10 words). Avoid idioms.',
  B1: 'CEFR B1 (intermediate): Use common vocabulary. Clear sentences. Some compound structures ok.',
  B2: 'CEFR B2 (upper-intermediate): IELTS band 6 level. Moderate complexity. Standard vocabulary.',
};

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

async function simplifyChunk(openai: OpenAI, chunk: string, levelHint: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Rewrite this text for ${levelHint}. Keep meaning exactly the same.
- Do NOT omit or add facts.
- Keep names, numbers, dates, percentages, and entities unchanged.
- Keep paragraph structure close to original.
- Use simpler words and shorter sentences only.
- Output ONLY rewritten text.`,
      },
      { role: 'user', content: chunk },
    ],
    max_tokens: 1200,
  });
  const out = completion.choices[0]?.message?.content?.trim() || '';
  if (!out) return chunk;
  const inWords = chunk.split(/\s+/).filter(Boolean).length;
  const outWords = out.split(/\s+/).filter(Boolean).length;
  if (outWords < Math.max(40, Math.floor(inWords * 0.45))) return chunk;
  return out;
}

async function simplifyWithGPT(text: string, targetLevel?: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || text.length < 50) return text;
  const openai = new OpenAI({ apiKey });
  const levelHint = targetLevel ? DIFFICULTY_PROMPTS[targetLevel] || '' : 'IELTS Reading band 6 (intermediate, B2)';
  try {
    const chunks = splitForSimplify(text);
    const toSimplify = chunks.slice(0, MAX_SIMPLIFY_CHUNKS);
    const rewritten: string[] = [];
    for (const chunk of toSimplify) {
      rewritten.push(await simplifyChunk(openai, chunk, levelHint));
    }
    if (chunks.length > MAX_SIMPLIFY_CHUNKS) rewritten.push(...chunks.slice(MAX_SIMPLIFY_CHUNKS));
    return rewritten.join('\n\n').trim() || text;
  } catch {
    return text;
  }
}

async function extractKeywordsAndDifficulty(
  openai: OpenAI,
  title: string,
  content: string,
  isSimplified: boolean
): Promise<{ keywords: string[]; difficulty: string; difficultyScore: number }> {
  const levelLabel = isSimplified ? 'simplified' : 'original';
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Extract exactly 5 main topic keywords (English, comma-separated) and assess CEFR level (A1,A2,B1,B2,C1,C2). Output JSON: { "keywords": ["kw1","kw2",...], "difficulty": "B1", "difficultyScore": 41 } (difficultyScore: A1=10, A2=25, B1=41, B2=56, C1=71, C2=86)`,
        },
        {
          role: 'user',
          content: `Title: ${title}\n\n${content.slice(0, 2000)}\n\nFor this ${levelLabel} text, extract keywords and difficulty. JSON only.`,
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
    const diff: string = parsed.difficulty && ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(parsed.difficulty)
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

function normalizePubDate(rawPubDate?: string | null, rawIsoDate?: string | null): string {
  const candidates = [rawIsoDate, rawPubDate];
  for (const raw of candidates) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
}

export async function runInit(targetCount = 20): Promise<{
  ingested: number;
  skipped: number;
  errors: string[];
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ingested: 0, skipped: 0, errors: ['OPENAI_API_KEY required'] };
  }

  const openai = new OpenAI({ apiKey });
  const feed = await parser.parseURL(YAHOO_RSS_URL);
  const items = (feed.items || []).filter((i) => i.title && i.link).slice(0, targetCount);

  let ingested = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const item of items) {
    const url = item.link || '';
    if (!url.startsWith('http')) continue;

    const existing = getArticleByUrl(url);
    if (existing?.content) {
      skipped++;
      continue;
    }

    let content = '';
    let contentSource: 'readability' | 'rss_fallback' = 'readability';
    let crawlError: string | null = null;
    try {
      const dom = await JSDOM.fromURL(url, {
        pretendToBeVisual: true,
        userAgent: 'Mozilla/5.0 (compatible; FeedLingo/1.0)',
        referrer: 'https://finance.yahoo.com/',
      });
      const reader = new Readability(dom.window.document);
      const parsed = reader.parse();
      content = parsed?.textContent?.trim() || item.contentSnippet || item.content || item.description || '';
    } catch (e) {
      contentSource = 'rss_fallback';
      crawlError = 'fetch_failed';
      content = stripHtml(item.contentSnippet || item.content || item.description || '');
      if (content.length < 100) {
        errors.push(`${item.title}: fetch failed`);
        continue;
      }
    }

    if (content.length < 100) {
      skipped++;
      continue;
    }

    const title = item.title || 'Untitled';
    const pubDate = normalizePubDate(item.pubDate || null, (item as any).isoDate || null);
    const sourceName = (item as any).creator || 'Yahoo Finance';

    const parentId = uuidv4();
    const origMeta = await extractKeywordsAndDifficulty(openai, title, content, false);

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
      fulltext_status: contentSource === 'readability' ? 'success' : 'failed',
      content_source: contentSource,
      content_len: content.length,
      crawl_error: crawlError,
    });
    ingested++;

    for (const level of DIFFICULTY_LEVELS) {
      const simplified = await simplifyWithGPT(content, level);
      const variantId = uuidv4();
      const variantUrl = `${url}#${level}`;
      const simpMeta = await extractKeywordsAndDifficulty(openai, title, simplified, true);
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
        fulltext_status: contentSource === 'readability' ? 'success' : 'failed',
        content_source: contentSource,
        content_len: content.length,
        crawl_error: crawlError,
      });
      ingested++;
    }
  }

  return { ingested, skipped, errors };
}

export async function runDailyIngest(): Promise<{ ingested: number; skipped: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  const openai = apiKey ? new OpenAI({ apiKey }) : null;

  const feed = await parser.parseURL(YAHOO_RSS_URL);
  const items = (feed.items || []).filter((i) => i.title && i.link);

  let ingested = 0;
  let skipped = 0;

  for (const item of items) {
    const url = item.link || '';
    if (!url.startsWith('http')) continue;

    const existing = getArticleByUrl(url);
    if (existing && existing.content) {
      skipped++;
      continue;
    }

    let content = '';
    let contentSource: 'readability' | 'rss_fallback' = 'readability';
    let crawlError: string | null = null;
    try {
      const dom = await JSDOM.fromURL(url, {
        pretendToBeVisual: true,
        userAgent: 'Mozilla/5.0 (compatible; FeedLingo/1.0)',
        referrer: 'https://finance.yahoo.com/',
      });
      const reader = new Readability(dom.window.document);
      const parsed = reader.parse();
      content = parsed?.textContent?.trim() || item.contentSnippet || item.content || item.description || '';
    } catch {
      contentSource = 'rss_fallback';
      crawlError = 'fetch_failed';
      content = stripHtml(item.contentSnippet || item.content || item.description || '');
    }

    if (content.length < 100) {
      skipped++;
      continue;
    }

    const title = item.title || 'Untitled';
    const pubDate = normalizePubDate(item.pubDate || null, (item as any).isoDate || null);
    const sourceName = (item as any).creator || 'Yahoo Finance';

    const simplified = openai ? await simplifyWithGPT(content) : content;
    const isTranslated = simplified !== content && simplified.length > 0;

    let keywords: string[] = [];
    let diffOriginal = 'B1';
    let diffSimplified = 'B1';
    let scoreOriginal = 50;
    let scoreSimplified = 50;

    if (openai) {
      const orig = await extractKeywordsAndDifficulty(openai, title, content, false);
      keywords = orig.keywords;
      diffOriginal = orig.difficulty;
      scoreOriginal = orig.difficultyScore;

      if (isTranslated) {
        const simp = await extractKeywordsAndDifficulty(openai, title, simplified, true);
        if (simp.keywords.length > 0) keywords = simp.keywords;
        diffSimplified = simp.difficulty;
        scoreSimplified = simp.difficultyScore;
      } else {
        diffSimplified = diffOriginal;
        scoreSimplified = scoreOriginal;
      }
    }

    const id = existing?.id || uuidv4();
    upsertArticle({
      id,
      source_url: url,
      title,
      content,
      simplified_content: simplified,
      keywords,
      is_translated: isTranslated,
      difficulty_original: diffOriginal,
      difficulty_simplified: diffSimplified,
      difficulty_score_original: scoreOriginal,
      difficulty_score_simplified: scoreSimplified,
      pub_date: pubDate,
      source_name: sourceName,
      fulltext_status: contentSource === 'readability' ? 'success' : 'failed',
      content_source: contentSource,
      content_len: content.length,
      crawl_error: crawlError,
    });
    ingested++;
  }

  return { ingested, skipped };
}
