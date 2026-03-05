#!/usr/bin/env npx tsx
import 'dotenv/config';
import OpenAI from 'openai';
import db from '../src/db/client.js';

type Row = {
  id: string;
  title: string;
  content: string | null;
  simplified_content: string | null;
  difficulty_simplified: string | null;
};

const LEVELS = new Set(['A2', 'B1', 'B2']);
const LEVEL_PROMPTS: Record<string, string> = {
  A2: 'CEFR A2 (elementary): Use very simple words. Short sentences (5-10 words).',
  B1: 'CEFR B1 (intermediate): Use common vocabulary. Clear sentences.',
  B2: 'CEFR B2 (upper-intermediate): IELTS band 6 level. Moderate complexity.',
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
        content: `Rewrite this text for ${levelHint}. Keep meaning exactly the same.\n- Do NOT omit or add facts.\n- Keep names, numbers, dates, percentages, and entities unchanged.\n- Keep paragraph structure close to original.\n- Use simpler words and shorter sentences only.\n- Output ONLY rewritten text.`,
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

async function simplifyArticle(openai: OpenAI, text: string, level: string): Promise<string> {
  if (text.length < 50) return text;
  const levelHint = LEVEL_PROMPTS[level] || LEVEL_PROMPTS.B2;
  const chunks = splitForSimplify(text);
  const rewritten: string[] = [];
  for (const chunk of chunks.slice(0, MAX_SIMPLIFY_CHUNKS)) {
    rewritten.push(await simplifyChunk(openai, chunk, levelHint));
  }
  if (chunks.length > MAX_SIMPLIFY_CHUNKS) rewritten.push(...chunks.slice(MAX_SIMPLIFY_CHUNKS));
  return rewritten.join('\n\n').trim() || text;
}

async function main() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error('OPENAI_API_KEY is required');
    process.exit(1);
  }

  const onlyToday = process.env.ONLY_TODAY === '1';
  const force = process.env.FORCE === '1';
  const daysBack = Math.max(0, parseInt(process.env.DAYS_BACK || '30', 10));
  const limit = Math.max(1, parseInt(process.env.LIMIT || '120', 10));
  const qualityClause = force
    ? ''
    : `
      AND (
        simplified_content IS NULL
        OR LENGTH(TRIM(simplified_content)) < 120
        OR (LENGTH(simplified_content) * 1.0 / NULLIF(LENGTH(content), 0)) < 0.45
      )
    `;

  const sql = onlyToday
    ? `
      SELECT id, title, content, simplified_content, difficulty_simplified
      FROM articles
      WHERE COALESCE(is_vocab_story, 0) = 0
        AND date(COALESCE(pub_date, created_at)) = date('now')
        AND COALESCE(content_len, LENGTH(content), 0) >= 500
        ${qualityClause}
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `
    : `
      SELECT id, title, content, simplified_content, difficulty_simplified
      FROM articles
      WHERE COALESCE(is_vocab_story, 0) = 0
        AND date(COALESCE(pub_date, created_at)) >= date('now', ?)
        AND COALESCE(content_len, LENGTH(content), 0) >= 500
        ${qualityClause}
      ORDER BY date(COALESCE(pub_date, created_at)) DESC, datetime(created_at) DESC
      LIMIT ?
    `;

  const rows = (onlyToday
    ? db.prepare(sql).all(limit)
    : db.prepare(sql).all(`-${daysBack} day`, limit)) as Row[];

  console.log(`[Backfill] candidates=${rows.length} onlyToday=${onlyToday} force=${force} daysBack=${daysBack} limit=${limit}`);
  if (rows.length === 0) return;

  const openai = new OpenAI({ apiKey: key });
  const update = db.prepare(`
    UPDATE articles
    SET simplified_content = ?,
        last_crawled_at = ?,
        crawl_error = NULL
    WHERE id = ?
  `);

  let ok = 0;
  let failed = 0;

  for (const row of rows) {
    const content = (row.content || '').trim();
    if (content.length < 50) {
      failed++;
      continue;
    }
    const level = LEVELS.has(row.difficulty_simplified || '') ? (row.difficulty_simplified as string) : 'B2';
    try {
      const simplified = await simplifyArticle(openai, content, level);
      update.run(simplified, new Date().toISOString(), row.id);
      ok++;
      if (ok % 10 === 0) console.log(`[Backfill] processed ${ok}/${rows.length}`);
    } catch (e) {
      failed++;
      console.error('[Backfill] failed:', row.id, row.title?.slice(0, 80), e instanceof Error ? e.message : String(e));
    }
  }

  console.log(`[Backfill] done ok=${ok} failed=${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
