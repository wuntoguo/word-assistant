import { Router, Request, Response } from 'express';
import { optionalAuthMiddleware } from './auth.js';
import { authMiddleware } from './auth.js';
import {
  insertEvents,
  getUserActivitySummary,
  type EventInput,
  type EventScene,
  type EventType,
} from '../repositories/eventRepo.js';

export const eventsRouter = Router();

const ALLOWED_TYPES: Set<EventType> = new Set([
  'impression',
  'click',
  'dwell_time',
  'like',
  'dislike',
  'skip',
  'play_audio',
  'complete_audio',
]);

const ALLOWED_SCENES: Set<EventScene> = new Set(['article', 'audio', 'system']);

function trimStr(v: unknown, max = 256): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}

function normalizeEvent(raw: Record<string, unknown>, userId: string | null): EventInput | null {
  const eventType = trimStr(raw.eventType, 64) as EventType | null;
  const scene = trimStr(raw.scene, 32) as EventScene | null;
  if (!eventType || !scene || !ALLOWED_TYPES.has(eventType) || !ALLOWED_SCENES.has(scene)) {
    return null;
  }

  const position = typeof raw.position === 'number' ? Math.max(0, Math.floor(raw.position)) : null;
  const score = typeof raw.score === 'number' ? raw.score : null;
  const dwellMs = typeof raw.dwellMs === 'number' ? Math.max(0, Math.floor(raw.dwellMs)) : null;

  const metadata = raw.metadata && typeof raw.metadata === 'object' ? (raw.metadata as Record<string, unknown>) : undefined;

  return {
    userId,
    sessionId: trimStr(raw.sessionId, 128),
    requestId: trimStr(raw.requestId, 128),
    eventType,
    scene,
    itemId: trimStr(raw.itemId, 256),
    itemType: trimStr(raw.itemType, 64),
    position,
    score,
    dwellMs,
    metadata,
    occurredAt: trimStr(raw.occurredAt, 64),
  };
}

eventsRouter.post('/batch', optionalAuthMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId ?? null;
  const payload = req.body as { events?: Record<string, unknown>[] } | Record<string, unknown>;

  const rawEvents = Array.isArray((payload as { events?: Record<string, unknown>[] }).events)
    ? (payload as { events?: Record<string, unknown>[] }).events || []
    : [payload as Record<string, unknown>];

  if (rawEvents.length === 0) {
    res.status(400).json({ error: 'events required' });
    return;
  }
  if (rawEvents.length > 200) {
    res.status(400).json({ error: 'Too many events (max 200)' });
    return;
  }

  const events: EventInput[] = [];
  for (const raw of rawEvents) {
    const e = normalizeEvent(raw, userId);
    if (e) events.push(e);
  }

  if (events.length === 0) {
    res.status(400).json({ error: 'No valid events' });
    return;
  }

  const inserted = insertEvents(events);
  res.json({ ok: true, inserted });
});

eventsRouter.get('/me/summary', authMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const startDate = (req.query.start as string) || new Date().toISOString().split('T')[0];
  const endDate = (req.query.end as string) || startDate;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    res.status(400).json({ error: 'Invalid date range format, expected YYYY-MM-DD' });
    return;
  }
  if (startDate > endDate) {
    res.status(400).json({ error: 'start must be <= end' });
    return;
  }

  const summary = getUserActivitySummary(userId, startDate, endDate);
  res.json({ startDate, endDate, ...summary });
});
