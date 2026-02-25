import { Router, Request, Response } from 'express';

export const sentencesRouter = Router();

const cache = new Map<string, { sentences: string[]; fetchedAt: number }>();
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours

sentencesRouter.get('/:word', async (req: Request, res: Response) => {
  const word = (req.params.word as string)?.trim().toLowerCase();
  if (!word) {
    res.status(400).json({ sentences: [] });
    return;
  }

  const cached = cache.get(word);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    res.json({ sentences: cached.sentences });
    return;
  }

  try {
    const url = `https://tatoeba.org/en/api_v0/search?from=eng&query=${encodeURIComponent(word)}&orphans=no&unapproved=no&limit=10`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'FeedLingo/1.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      res.json({ sentences: [] });
      return;
    }

    const data = await resp.json() as {
      results: Array<{ text: string; lang: string }>;
    };

    const sentences = (data.results || [])
      .filter((r) => r.lang === 'eng' && r.text.length >= 10 && r.text.length <= 200)
      .map((r) => r.text)
      .filter((text) => {
        const lower = text.toLowerCase();
        return lower.includes(word) || lower.includes(word.replace(/s$/, '')) || lower.includes(word.replace(/ed$/, '')) || lower.includes(word.replace(/ing$/, ''));
      })
      .slice(0, 5);

    cache.set(word, { sentences, fetchedAt: Date.now() });
    res.json({ sentences });
  } catch {
    res.json({ sentences: [] });
  }
});
