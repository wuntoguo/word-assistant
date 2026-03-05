export type AppEventType =
  | 'impression'
  | 'click'
  | 'dwell_time'
  | 'like'
  | 'dislike'
  | 'skip'
  | 'play_audio'
  | 'complete_audio';

export type AppEventScene = 'article' | 'audio' | 'system';

export interface AppEvent {
  eventType: AppEventType;
  scene: AppEventScene;
  itemId?: string;
  itemType?: string;
  position?: number;
  score?: number;
  dwellMs?: number;
  requestId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}

const SESSION_KEY = 'feedlingo-session-id';

function getSessionId(): string {
  let sid = localStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

export function createRequestId(): string {
  return crypto.randomUUID();
}

export async function trackEvents(events: AppEvent[]): Promise<void> {
  if (!events.length) return;

  const payload = {
    events: events.map((e) => ({
      ...e,
      sessionId: e.sessionId || getSessionId(),
      occurredAt: e.occurredAt || new Date().toISOString(),
    })),
  };

  try {
    const token = localStorage.getItem('feedlingo-token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    await fetch('/api/events/batch', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // telemetry should never block UX
  }
}
