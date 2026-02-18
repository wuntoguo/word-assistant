import { atom } from 'jotai';
import { Word, User, SyncStatus } from './types';

// --- Storage keys ---
const WORDS_KEY = 'word-assistant-words';
const TOKEN_KEY = 'word-assistant-token';
const LAST_SYNCED_KEY = 'word-assistant-last-synced';

// --- localStorage helpers ---
function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

// --- Words atom (persisted to localStorage) ---
const baseWordsAtom = atom<Word[]>(loadFromStorage<Word[]>(WORDS_KEY, []));

export const wordsAtom = atom(
  (get) => get(baseWordsAtom),
  (_get, set, newWords: Word[] | ((prev: Word[]) => Word[])) => {
    set(baseWordsAtom, (prev) => {
      const result = typeof newWords === 'function' ? newWords(prev) : newWords;
      saveToStorage(WORDS_KEY, result);
      return result;
    });
  }
);

// All words due for review (no limit)
export const allDueReviewWordsAtom = atom((get) => {
  const words = get(wordsAtom);
  const today = new Date().toISOString().split('T')[0];
  return words.filter((w) => w.nextReviewDate <= today);
});

// Daily review batch: max 5 words, prioritized by urgency
// Priority: lower memoryStage first (weakest words), then most overdue
const DAILY_REVIEW_LIMIT = 5;

export const todayReviewWordsAtom = atom((get) => {
  const dueWords = get(allDueReviewWordsAtom);
  if (dueWords.length <= DAILY_REVIEW_LIMIT) return dueWords;

  // Sort: lowest memoryStage first, then earliest nextReviewDate (most overdue)
  const sorted = [...dueWords].sort((a, b) => {
    if (a.memoryStage !== b.memoryStage) return a.memoryStage - b.memoryStage;
    return a.nextReviewDate.localeCompare(b.nextReviewDate);
  });

  return sorted.slice(0, DAILY_REVIEW_LIMIT);
});

// --- Auth atoms ---
export const tokenAtom = atom<string | null>(
  localStorage.getItem(TOKEN_KEY)
);

export const tokenWriteAtom = atom(
  (get) => get(tokenAtom),
  (_get, set, token: string | null) => {
    set(tokenAtom, token);
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }
);

export const userAtom = atom<User | null>(null);

// --- Sync atoms ---
export const syncStatusAtom = atom<SyncStatus>('idle');

export const lastSyncedAtAtom = atom<string | null>(
  localStorage.getItem(LAST_SYNCED_KEY)
);

export const lastSyncedAtWriteAtom = atom(
  (get) => get(lastSyncedAtAtom),
  (_get, set, value: string | null) => {
    set(lastSyncedAtAtom, value);
    if (value) {
      localStorage.setItem(LAST_SYNCED_KEY, value);
    } else {
      localStorage.removeItem(LAST_SYNCED_KEY);
    }
  }
);

export const isOnlineAtom = atom<boolean>(navigator.onLine);
