import { Router, Request, Response } from 'express';
import { authMiddleware } from './auth.js';
import { getWordsFromLastNDays } from '../repositories/wordRepo.js';
import { getArticleById } from '../repositories/articleRepo.js';
import { generateVocabStoryForUser } from '../dailyVocabStory.js';

export const vocabStoryRouter = Router();

vocabStoryRouter.post('/generate', authMiddleware, async (req: Request, res: Response) => {
  const userId = (req as any).userId;

  const words = getWordsFromLastNDays(userId, 7);
  if (words.length < 3) {
    res.status(400).json({
      error: 'Need at least 3 words from the past week to generate a story',
      wordCount: words.length,
    });
    return;
  }

  const result = await generateVocabStoryForUser(userId);
  if (!result.ok) {
    if (result.error?.includes('not configured')) {
      res.status(503).json({ error: 'Story generation not configured' });
    } else {
      res.status(500).json({ error: result.error || 'Story generation failed' });
    }
    return;
  }

  const article = getArticleById(result.id!);
  res.json({
    id: result.id,
    title: result.title,
    content: article?.content ?? '',
    simplified: article?.simplified_content ?? article?.content ?? '',
    keywords: article ? JSON.parse(article.keywords || '[]') : [],
    source: 'FeedLingo Vocab Story',
    isVocabStory: true,
  });
});
