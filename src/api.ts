import { User, Word } from './types';

const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('word-assistant-token');
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
