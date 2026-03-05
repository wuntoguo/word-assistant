import { User, Word } from './types';

const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('feedlingo-token');
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `API error: ${res.status}`);
  }

  return res.json();
}

// --- Auth ---

export async function fetchCurrentUser(): Promise<User> {
  return apiFetch<User>('/auth/me');
}

export async function registerWithEmail(
  name: string,
  email: string,
  password: string
): Promise<{ token: string }> {
  return apiFetch<{ token: string }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  });
}

export async function loginWithEmail(
  email: string,
  password: string
): Promise<{ token: string }> {
  return apiFetch<{ token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export interface AuthProviders {
  email: boolean;
  google: boolean;
  github: boolean;
}

export async function fetchAuthProviders(): Promise<AuthProviders | null> {
  try {
    return await apiFetch<AuthProviders>('/auth/providers');
  } catch {
    return null;
  }
}

// --- Sync ---

export interface SyncResponse {
  serverWords: Word[];
  syncedAt: string;
}

export async function syncWords(
  lastSyncedAt: string | null,
  clientWords: Word[]
): Promise<SyncResponse> {
  return apiFetch<SyncResponse>('/sync', {
    method: 'POST',
    body: JSON.stringify({ lastSyncedAt, clientWords }),
  });
}

// --- Level ---

export interface LevelResult {
  levelScore: number;
  band: string;
  label: string;
  testCount: number;
  feedbackCount: number;
  testAvg: number;
  suitableRatio: number;
}

export async function submitTestResult(score: number, total: number): Promise<LevelResult | null> {
  try {
    return await apiFetch<LevelResult>('/level/test-result', {
      method: 'POST',
      body: JSON.stringify({ score, total }),
    });
  } catch {
    return null;
  }
}

export type DifficultyFeedback = 'appropriate' | 'too_hard' | 'too_easy';

export async function submitArticleFeedback(
  articleKey: string,
  liked?: boolean,
  difficulty?: DifficultyFeedback,
  articleId?: string
): Promise<LevelResult | null> {
  try {
    return await apiFetch<LevelResult>('/level/feedback', {
      method: 'POST',
      body: JSON.stringify({ articleKey, articleId, liked, difficulty }),
    });
  } catch {
    return null;
  }
}

export async function fetchLevel(): Promise<LevelResult | null> {
  try {
    return await apiFetch<LevelResult>('/level');
  } catch {
    return null;
  }
}

// --- Recommend ---

export interface RecommendArticle {
  id?: string;
  title: string;
  link: string;
  pubDate: string;
  postedAt?: string | null;
  crawledAt?: string | null;
  description: string;
  simplified: string;
  source?: string;
  keywords?: string[];
  difficulty?: string;
  audioUrl?: string;
  scores?: {
    interestScore: number;
    difficultyScore: number;
    totalScore: number;
    interestReason: string;
    difficultyReason: string;
    freshnessScore?: number;
    showCount?: number;
    adjustedTotal?: number;
  };
  recommendationReason?: string;
}

export interface RecommendResponse {
  articles: RecommendArticle[];
  hasMore: boolean;
  profile?: {
    levelBand: string;
    levelScore: number;
    interestKeywords: string[];
    suitableCount: number;
  };
}

export async function fetchRecommend(limit = 10, offset = 0, debug = false): Promise<RecommendResponse | null> {
  try {
    return await apiFetch<RecommendResponse>(`/recommend?limit=${limit}&offset=${offset}&debug=${debug ? 'true' : 'false'}`);
  } catch {
    return null;
  }
}

// --- Profile (static preferences for recommendations) ---

export interface UserProfilePreferences {
  interestKeywords: string[];
  preferredLevelBand: string | null;
}

export async function fetchProfile(): Promise<UserProfilePreferences | null> {
  try {
    return await apiFetch<UserProfilePreferences>('/profile');
  } catch {
    return null;
  }
}

export async function updateProfile(prefs: UserProfilePreferences): Promise<boolean> {
  try {
    await apiFetch<{ ok: boolean }>('/profile', {
      method: 'PUT',
      body: JSON.stringify(prefs),
    });
    return true;
  } catch {
    return false;
  }
}

// --- Activity summary ---
export interface ActivitySummary {
  startDate: string;
  endDate: string;
  reads: number;
  readingSeconds: number;
  readingWords: number;
  listeningSeconds: number;
  likes: number;
  dislikes: number;
}

export async function fetchMyActivitySummary(startDate: string, endDate: string): Promise<ActivitySummary | null> {
  try {
    return await apiFetch<ActivitySummary>(`/events/me/summary?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`);
  } catch {
    return null;
  }
}
