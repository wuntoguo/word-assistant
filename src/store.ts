import { atom } from 'jotai';
import { Word, User, SyncStatus } from './types';

// --- Storage keys ---
const WORDS_KEY = 'feedlingo-words';
const TOKEN_KEY = 'feedlingo-token';
const LAST_SYNCED_KEY = 'feedlingo-last-synced';

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

// All words due for review (no limit), excluding archived
export const allDueReviewWordsAtom = atom((get) => {
  const words = get(wordsAtom);
  const today = new Date().toISOString().split('T')[0];
  return words.filter((w) => !w.archived && w.nextReviewDate <= today);
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

// Custom practice words: when set, Review uses these instead of daily batch (test-from-history)
export const customPracticeWordsAtom = atom<Word[] | null>(null);

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

// --- Level (dynamic English proficiency assessment) ---
const LEVEL_DATA_KEY = 'feedlingo-level';

export interface LevelData {
  levelScore: number;
  band: string;
  label: string;
  testCount: number;
  feedbackCount: number;
}

const defaultLevel: LevelData = {
  levelScore: 50,
  band: 'B1',
  label: 'Intermediate',
  testCount: 0,
  feedbackCount: 0,
};

export const levelAtom = atom<LevelData>(loadFromStorage<LevelData>(LEVEL_DATA_KEY, defaultLevel));

export const levelWriteAtom = atom(
  (get) => get(levelAtom),
  (_get, set, value: LevelData) => {
    set(levelAtom, value);
    saveToStorage(LEVEL_DATA_KEY, value);
  }
);

// --- Activity stats (reads, listening, reviews) per day ---
const ACTIVITY_STATS_KEY = 'feedlingo-activity';

export interface DayActivity {
  reads: number;
  readingSeconds: number;
  readingWords: number;
  listeningSeconds: number;
  reviews: number;
}

type ActivityStats = Record<string, Partial<DayActivity>>;

function loadActivityStats(): ActivityStats {
  return loadFromStorage<ActivityStats>(ACTIVITY_STATS_KEY, {});
}

const ACTIVITY_EVENT = 'feedlingo-activity-updated';

export function recordActivity(
  date: string,
  type: keyof DayActivity,
  value: number
): void {
  const stats = loadActivityStats();
  const day = stats[date] ?? {};
  const prev = (day[type] as number) ?? 0;
  stats[date] = { ...day, [type]: prev + value };
  saveToStorage(ACTIVITY_STATS_KEY, stats);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ACTIVITY_EVENT));
  }
}

export function getActivityForDate(date: string): DayActivity {
  const stats = loadActivityStats();
  const day = stats[date] ?? {};
  return {
    reads: day.reads ?? 0,
    readingSeconds: day.readingSeconds ?? 0,
    readingWords: day.readingWords ?? 0,
    listeningSeconds: day.listeningSeconds ?? 0,
    reviews: day.reviews ?? 0,
  };
}

export function getActivityForWeek(startDate: string, endDate: string): DayActivity {
  const stats = loadActivityStats();
  let reads = 0;
  let readingSeconds = 0;
  let readingWords = 0;
  let listeningSeconds = 0;
  let reviews = 0;
  for (const [d, day] of Object.entries(stats)) {
    if (d >= startDate && d <= endDate) {
      reads += day.reads ?? 0;
      readingSeconds += day.readingSeconds ?? 0;
      readingWords += day.readingWords ?? 0;
      listeningSeconds += day.listeningSeconds ?? 0;
      reviews += day.reviews ?? 0;
    }
  }
  return { reads, readingSeconds, readingWords, listeningSeconds, reviews };
}
