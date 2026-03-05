import { Router, Request, Response } from 'express';
import { authMiddleware } from './auth.js';
import { getUserProfile, upsertUserProfile } from '../repositories/userRepo.js';

export const profileRouter = Router();

profileRouter.get('/', authMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const profile = getUserProfile(userId);
  if (!profile) {
    return res.json({
      interestKeywords: [],
      preferredLevelBand: null,
    });
  }
  try {
    const interestKeywords = JSON.parse(profile.interest_keywords || '[]') as string[];
    res.json({
      interestKeywords,
      preferredLevelBand: profile.preferred_level_band,
    });
  } catch {
    res.json({ interestKeywords: [], preferredLevelBand: profile.preferred_level_band });
  }
});

profileRouter.put('/', authMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const { interestKeywords, preferredLevelBand } = req.body as {
    interestKeywords?: string[];
    preferredLevelBand?: string | null;
  };

  const keywords = Array.isArray(interestKeywords) ? interestKeywords : [];
  const band = typeof preferredLevelBand === 'string' && preferredLevelBand
    ? preferredLevelBand
    : null;

  upsertUserProfile(userId, keywords, band);
  res.json({ ok: true, interestKeywords: keywords, preferredLevelBand: band });
});
