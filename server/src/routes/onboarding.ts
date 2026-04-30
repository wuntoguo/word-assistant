import { Router, Request, Response } from 'express';
import { authMiddleware } from './auth.js';
import { markOnboardingComplete } from '../repositories/userRepo.js';
import { upsertUserProfile, getUserProfile } from '../repositories/userRepo.js';

export const onboardingRouter = Router();

// Exam score → CEFR band
function examScoreToBand(exam: string, score: number): string {
  switch (exam) {
    case 'gaokao':
      if (score >= 135) return 'B2.1';
      if (score >= 110) return 'B1.2';
      if (score >= 85)  return 'A2.2';
      return 'A2.1';
    case 'cet4':
      if (score >= 550) return 'B2.1';
      if (score >= 450) return 'B1.2';
      return 'A2.2';
    case 'cet6':
      if (score >= 550) return 'C1.1';
      if (score >= 450) return 'B2.1';
      return 'B1.2';
    case 'ielts': {
      const f = parseFloat(String(score));
      if (f >= 7.0) return 'C1.1';
      if (f >= 6.0) return 'B2.2';
      if (f >= 5.0) return 'B2.1';
      if (f >= 4.0) return 'B1.1';
      return 'A2.2';
    }
    case 'toefl':
      if (score >= 100) return 'C1.1';
      if (score >= 80)  return 'B2.1';
      if (score >= 60)  return 'B1.2';
      return 'B1.1';
    default:
      return 'B1.1';
  }
}

// 16-word recognition → CEFR band
const WORD_GROUPS: Record<string, string[]> = {
  A1: ['food', 'happy', 'big', 'run'],
  A2: ['describe', 'imagine', 'silence', 'curious'],
  B1: ['reluctant', 'negotiate', 'emphasis', 'occasional'],
  B2: ['ambiguous', 'scrutinize', 'eloquent', 'inevitable'],
};

function wordCheckToBand(recognizedWords: string[]): string {
  const recSet = new Set(recognizedWords.map((w) => w.toLowerCase()));
  const b2 = WORD_GROUPS.B2.filter((w) => recSet.has(w)).length;
  const b1 = WORD_GROUPS.B1.filter((w) => recSet.has(w)).length;
  const a2 = WORD_GROUPS.A2.filter((w) => recSet.has(w)).length;

  if (b2 >= 3) return 'B2.1';
  if (b2 >= 2 && b1 >= 3) return 'B1.2';
  if (b1 >= 3) return 'B1.2';
  if (b1 >= 2 && a2 >= 3) return 'B1.1';
  if (a2 >= 3) return 'A2.2';
  if (a2 >= 2) return 'A2.1';
  return 'A1.2';
}

// POST /api/onboarding
// Body: { method: 'exam', exam: string, score: number }
//     | { method: 'word_check', recognizedWords: string[] }
//     | { method: 'skip' }
onboardingRouter.post('/', authMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { method, exam, score, recognizedWords } = req.body as {
    method: 'exam' | 'word_check' | 'skip';
    exam?: string;
    score?: number;
    recognizedWords?: string[];
  };

  let band: string | null = null;

  if (method === 'exam' && exam && score != null) {
    band = examScoreToBand(exam, Number(score));
  } else if (method === 'word_check' && Array.isArray(recognizedWords)) {
    band = wordCheckToBand(recognizedWords);
  }
  // method === 'skip' → band stays null, will use default B1 in recommendations

  // Preserve existing interest keywords
  const existing = getUserProfile(userId);
  const keywords = existing
    ? (JSON.parse(existing.interest_keywords || '[]') as string[])
    : [];

  upsertUserProfile(userId, keywords, band);
  markOnboardingComplete(userId);

  res.json({ ok: true, band });
});

export { WORD_GROUPS };
