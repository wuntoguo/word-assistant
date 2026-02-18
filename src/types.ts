export type AudioAccent = 'US' | 'UK' | 'AU' | '';

export interface Word {
  id: string;
  word: string;
  phonetic: string;
  audioUrl: string;
  audioAccent: AudioAccent;
  partOfSpeech: string;
  definitions: string[];
  examples: string[];
  dateAdded: string;       // ISO date string (YYYY-MM-DD)
  nextReviewDate: string;  // ISO date string (YYYY-MM-DD)
  reviewCount: number;
  memoryStage: number;     // 0-5, stages in spaced repetition
  updatedAt: string;       // ISO datetime string for sync
  archived?: boolean;      // true = skip during review
}

export interface User {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  provider: string;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export interface ReviewResult {
  wordId: string;
  remembered: boolean;
  date: string;
}
