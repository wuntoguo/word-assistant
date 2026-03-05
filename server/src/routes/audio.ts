import { Router, Request, Response } from 'express';
import { getArticlesForAudioGeneration } from '../repositories/articleRepo.js';
import { getArticleAudioPath, getArticleAudioDurationSeconds, getAudioDir } from '../articleTts.js';
import { getRecommendedAudioArticles } from '../recommendation.js';
import { optionalAuthMiddleware } from './auth.js';
import { computeFreshnessScore } from '../recommendation.js';
import { runTask } from '../offline/index.js';

export const audioRouter = Router();

let lastAudioSeedAt = 0;
const SEED_DEBOUNCE_MS = 5 * 60 * 1000; // 5 min

interface AudioItem {
  id: string;
  title: string;
  link: string;
  audioUrl?: string;
  durationSeconds?: number;
  keywords?: string[];
  pubDate: string;
  postedAt?: string | null;
  crawledAt?: string | null;
  description: string;
  simplified?: string;
  source?: string;
  recommendationReason?: string;
  scores?: { interestScore: number; difficultyScore: number; totalScore: number; freshnessScore?: number };
}

// GET /api/audio/debug - debug info for audio flow
audioRouter.get('/debug', (_req: Request, res: Response) => {
  const pool = getArticlesForAudioGeneration();
  const items = pool.map((a) => {
    const content = (a.simplified_content || a.content || '').trim();
    const hasAudio = !!getArticleAudioPath(a.id);
    return {
      id: a.id,
      title: a.title?.slice(0, 50),
      source: a.source_name,
      contentLen: content.length,
      hasAudio,
      durationSeconds: hasAudio ? getArticleAudioDurationSeconds(a.id) : null,
    };
  });
  res.json({
    audioDir: getAudioDir(),
    poolCount: pool.length,
    withAudioCount: items.filter((x) => x.hasAudio).length,
    lastAudioSeedAt,
    items,
  });
});

// GET /api/audio/article/:id - serve TTS audio for article
audioRouter.get('/article/:id', (req: Request, res: Response) => {
  const articleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id || '';
  const audioPath = getArticleAudioPath(articleId);
  if (!audioPath) {
    res.status(404).json({ error: 'Audio not found' });
    return;
  }
  res.sendFile(audioPath, { headers: { 'Content-Type': 'audio/mpeg' } }, (err) => {
    if (err) console.error('[Audio] sendFile error:', articleId, err?.message);
  });
});

// GET /api/audio/items - top 10 by likes (legacy list)
audioRouter.get('/items', (_req: Request, res: Response) => {
  const articles = getArticlesForAudioGeneration();
  const items: AudioItem[] = [];
  for (const a of articles) {
    if (!getArticleAudioPath(a.id)) continue;
    const kw = (() => {
      try { return JSON.parse(a.keywords || '[]') as string[]; } catch { return []; }
    })();
    items.push({
      id: a.id,
      title: a.title,
      link: a.source_url,
      audioUrl: `/api/audio/article/${a.id}`,
      durationSeconds: getArticleAudioDurationSeconds(a.id) ?? undefined,
      keywords: kw.length > 0 ? kw : undefined,
      pubDate: a.pub_date || a.created_at || '',
      postedAt: a.pub_date || null,
      crawledAt: a.created_at || null,
      description: (a.simplified_content || a.content || '').slice(0, 300),
      source: a.source_name || undefined,
    });
  }
  res.json({ items });
});

// GET /api/audio/recommend - recommended audio articles with scores (for Audio tab, recommendation algo)
audioRouter.get('/recommend', optionalAuthMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId ?? null;
  const scored = getRecommendedAudioArticles(userId);
  const showDebug = (req.query.debug as string) !== 'false';

  // When we have articles in pool without audio, trigger generation in background (debounced)
  const pool = getArticlesForAudioGeneration();
  const needAudio = pool.filter((a) => !getArticleAudioPath(a.id));
  if (needAudio.length > 0 && Date.now() - lastAudioSeedAt > SEED_DEBOUNCE_MS) {
    lastAudioSeedAt = Date.now();
    runTask('article-audio').then((r) => {
      if (r.ok) console.log('[Audio] Lazy seed:', (r.data as { generated: number }).generated, 'generated');
      else console.error('[Audio] Lazy seed failed:', r.error);
    }).catch((e) => console.error('[Audio] Lazy seed error:', e));
  }

  const items: AudioItem[] = scored.map((s) => {
    const freshness = computeFreshnessScore(s.article);
    const kw = (() => {
      try { return JSON.parse(s.article.keywords || '[]') as string[]; } catch { return []; }
    })();
    return {
      id: s.article.id,
      title: s.article.title,
      link: s.article.source_url,
      audioUrl: `/api/audio/article/${s.article.id}`,
      durationSeconds: getArticleAudioDurationSeconds(s.article.id) ?? undefined,
      keywords: kw.length > 0 ? kw : undefined,
      pubDate: s.article.pub_date || s.article.created_at || '',
      postedAt: s.article.pub_date || null,
      crawledAt: s.article.created_at || null,
      description: (s.article.simplified_content || s.article.content || '').slice(0, 300),
      simplified: s.article.simplified_content || s.article.content || '',
      source: s.article.source_name || undefined,
      recommendationReason: s.recommendationReason,
      scores: showDebug
        ? {
            interestScore: s.interestScore,
            difficultyScore: s.difficultyScore,
            totalScore: s.totalScore,
            freshnessScore: freshness,
          }
        : undefined,
    };
  });

  res.json({ items });
});
