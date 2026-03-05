/**
 * Article TTS: generate audio from simplified content.
 * Uses Google Translate TTS (free, no API key, node-gtts).
 * - Voice: en (English)
 * - Format: MP3
 * - Max ~100 chars per request; text is chunked automatically
 */

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getArticleById } from './repositories/articleRepo.js';

const require = createRequire(import.meta.url);
const gtts = require('node-gtts')('en');
const getMP3Duration = require('get-mp3-duration');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATABASE_PATH
  ? path.join(path.dirname(process.env.DATABASE_PATH), 'audio')
  : path.join(__dirname, '..', 'data', 'audio');

const MAX_CHARS = 4500; // node-gtts chunks by 100 chars, concatenates
const EXCERPT_CHARS = 4200; // Target for 3-5 min; use whatever content we have up to this
const MIN_TEXT_CHARS = 50; // Bare minimum (title only ok)

/** Truncate at sentence boundary so TTS has natural pauses (avoids mid-sentence cut). */
function truncateAtSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  // Find last sentence boundary (. ! ?) followed by space or newline
  const re = /[.!?](?:\s|$)/g;
  let lastIdx = -1;
  let m;
  while ((m = re.exec(truncated)) !== null) lastIdx = m.index + m[0].length;
  if (lastIdx > MIN_TEXT_CHARS) return text.slice(0, lastIdx).trim();
  // Fallback: last space before limit (avoid mid-word)
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > MIN_TEXT_CHARS ? text.slice(0, lastSpace).trim() : truncated.trim();
}

function getTextForTts(article: { title: string; simplified_content?: string | null; content?: string | null }): string {
  const content = (article.simplified_content || article.content || '').trim();
  const budget = Math.min(EXCERPT_CHARS, MAX_CHARS - (article.title?.length || 0) - 20);
  const excerpt = truncateAtSentence(content, budget);
  const text = [article.title, excerpt].filter(Boolean).join('. ');
  return text.slice(0, MAX_CHARS).trim() || article.title || '';
}

async function ensureAudioDir(): Promise<string> {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  return DATA_DIR;
}

function saveToFile(filepath: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    gtts.save(filepath, text, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function generateArticleAudio(
  articleId: string
): Promise<{ ok: true; audioPath: string } | { ok: false; error: string }> {
  const article = getArticleById(articleId);
  if (!article) return { ok: false, error: 'Article not found' };

  const text = getTextForTts(article);
  if (!text || text.length < MIN_TEXT_CHARS) {
    return { ok: false, error: `No content to synthesize (got ${text?.length ?? 0} chars)` };
  }

  const dir = await ensureAudioDir();
  const audioPath = path.join(dir, `${articleId}.mp3`);

  try {
    await saveToFile(audioPath, text);
    const buf = fs.readFileSync(audioPath);
    const durationMs = getMP3Duration(buf);
    console.log('[TTS] Generated', articleId, 'textLen:', text.length, 'fileBytes:', buf.length, 'duration:', Math.round(durationMs / 1000), 's');
    return { ok: true, audioPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[TTS] Failed', articleId, msg);
    return { ok: false, error: msg };
  }
}

export function getArticleAudioPath(articleId: string): string | null {
  const p = path.join(DATA_DIR, `${articleId}.mp3`);
  return fs.existsSync(p) ? p : null;
}

/** Duration in seconds, or null if file missing/invalid. */
export function getArticleAudioDurationSeconds(articleId: string): number | null {
  const p = getArticleAudioPath(articleId);
  if (!p) return null;
  try {
    const buf = fs.readFileSync(p);
    const ms = getMP3Duration(buf);
    return Math.round(ms / 1000);
  } catch {
    return null;
  }
}

export function getAudioDir(): string {
  return DATA_DIR;
}
