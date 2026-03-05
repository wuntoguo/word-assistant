import type { DbArticle } from '../../repositories/recommendRepo.js';

export const DIFFICULTY_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export interface UserProfile {
  levelBand: string;
  levelScore: number;
  interestKeywords: string[];
  dislikeKeywords: string[];
  suitableDifficultyArticles: { keywords: string[]; difficulty: string }[];
  tooHardArticles: { keywords: string[]; difficulty: string }[];
  tooEasyArticles: { keywords: string[]; difficulty: string }[];
}

export interface ScoredArticle {
  article: DbArticle;
  interestScore: number;
  difficultyScore: number;
  totalScore: number;
  interestReason: string;
  difficultyReason: string;
  recommendationReason: string;
}
