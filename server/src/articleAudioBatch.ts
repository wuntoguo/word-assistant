/**
 * Batch TTS: generate audio for daily hot 3-5 finance+tech + liked articles.
 * Pool = top 5 finance/tech (by recency) + top 10 by likes, max 10.
 */

import fs from 'fs';
import { getArticlesForAudioGeneration } from './db.js';
import { generateArticleAudio, getArticleAudioPath, getArticleAudioDurationSeconds, getAudioDir } from './articleTts.js';

const MIN_ACCEPTABLE_DURATION_SEC = 90; // Re-generate if audio < 1.5 min

export interface ArticleAudioBatchResult {
  generated: number;
  skipped: number;
  regenerated: number;
  errors: string[];
}

export async function runArticleAudioBatch(options?: {
  dryRun?: boolean;
}): Promise<ArticleAudioBatchResult> {
  const dryRun = options?.dryRun ?? false;

  const articles = getArticlesForAudioGeneration();
  const result: ArticleAudioBatchResult = { generated: 0, skipped: 0, regenerated: 0, errors: [] };
  console.log('[ArticleAudio] Pool size:', articles.length, 'articles');

  for (const article of articles) {
    const existingPath = getArticleAudioPath(article.id);
    const duration = existingPath ? getArticleAudioDurationSeconds(article.id) : null;
    const tooShort = duration !== null && duration < MIN_ACCEPTABLE_DURATION_SEC;

    if (existingPath && !tooShort) {
      result.skipped++;
      continue;
    }
    if (existingPath && tooShort) {
      try {
        fs.unlinkSync(existingPath);
      } catch {
        //
      }
    }
    if (dryRun) {
      result.generated++;
      continue;
    }
    const contentLen = (article.simplified_content || article.content || '').length;
    const r = await generateArticleAudio(article.id);
    if (r.ok) {
      if (existingPath && tooShort) result.regenerated++;
      else result.generated++;
      const dur = getArticleAudioDurationSeconds(article.id);
      console.log('[ArticleAudio] OK', article.id, 'contentLen:', contentLen, 'duration:', dur, 's');
    } else {
      result.errors.push(`${article.id}: ${r.error}`);
      console.log('[ArticleAudio] FAIL', article.id, 'contentLen:', contentLen, 'error:', r.error);
    }
  }

  console.log('[ArticleAudio] Batch done:', result);
  return result;
}
