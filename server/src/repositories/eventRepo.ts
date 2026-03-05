import { v4 as uuidv4 } from 'uuid';
import db from '../db/client.js';

const MIN_VALID_READ_MS = 8000;

export type EventType =
  | 'impression'
  | 'click'
  | 'dwell_time'
  | 'like'
  | 'dislike'
  | 'skip'
  | 'play_audio'
  | 'complete_audio';

export type EventScene = 'article' | 'audio' | 'system';

export interface EventInput {
  userId?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  eventType: EventType;
  scene: EventScene;
  itemId?: string | null;
  itemType?: string | null;
  position?: number | null;
  score?: number | null;
  dwellMs?: number | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string | null;
}

export interface EventRow {
  user_id: string | null;
  event_type: EventType;
  scene: EventScene;
  item_id: string | null;
  metadata_json: string;
  dwell_ms: number | null;
}

export interface UserActivitySummary {
  reads: number;
  readingSeconds: number;
  readingWords: number;
  listeningSeconds: number;
  likes: number;
  dislikes: number;
}

function toIsoOrNow(raw?: string | null): string {
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

export function insertEvents(events: EventInput[]): number {
  if (events.length === 0) return 0;

  const stmt = db.prepare(`
    INSERT INTO events_raw (
      id, user_id, session_id, request_id, event_type, scene,
      item_id, item_type, position, score, dwell_ms,
      metadata_json, occurred_at, event_date, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rows: EventInput[]) => {
    for (const e of rows) {
      const occurredAt = toIsoOrNow(e.occurredAt);
      const eventDate = occurredAt.split('T')[0];
      stmt.run(
        uuidv4(),
        e.userId || null,
        e.sessionId || null,
        e.requestId || null,
        e.eventType,
        e.scene,
        e.itemId || null,
        e.itemType || '',
        e.position ?? null,
        e.score ?? null,
        e.dwellMs ?? null,
        JSON.stringify(e.metadata || {}),
        occurredAt,
        eventDate,
        new Date().toISOString()
      );
    }
  });

  tx(events);
  return events.length;
}

export function aggregateEventsForDate(date: string): { summaryRows: number; itemRows: number } {
  const now = new Date().toISOString();

  db.prepare('DELETE FROM events_daily_agg WHERE date = ?').run(date);
  db.prepare('DELETE FROM item_engagement_daily WHERE date = ?').run(date);

  const summaryInsert = db.prepare(`
    INSERT INTO events_daily_agg (
      date, scene, event_type, item_type,
      events_count, unique_users, unique_items, avg_dwell_ms,
      created_at, updated_at
    )
    SELECT
      ?,
      scene,
      event_type,
      COALESCE(item_type, ''),
      COUNT(*) AS events_count,
      COUNT(DISTINCT user_id) AS unique_users,
      COUNT(DISTINCT item_id) AS unique_items,
      AVG(CASE WHEN dwell_ms > 0 THEN dwell_ms END) AS avg_dwell_ms,
      ?,
      ?
    FROM events_raw
    WHERE event_date = ?
    GROUP BY scene, event_type, COALESCE(item_type, '')
  `);

  const itemInsert = db.prepare(`
    INSERT INTO item_engagement_daily (
      date, scene, item_id,
      impressions, clicks, plays, completions,
      avg_dwell_ms, ctr, completion_rate,
      created_at, updated_at
    )
    SELECT
      ?,
      scene,
      item_id,
      SUM(CASE WHEN event_type = 'impression' THEN 1 ELSE 0 END) AS impressions,
      SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) AS clicks,
      SUM(CASE WHEN event_type = 'play_audio' THEN 1 ELSE 0 END) AS plays,
      SUM(CASE WHEN event_type = 'complete_audio' THEN 1 ELSE 0 END) AS completions,
      AVG(CASE WHEN dwell_ms > 0 THEN dwell_ms END) AS avg_dwell_ms,
      CASE
        WHEN SUM(CASE WHEN event_type = 'impression' THEN 1 ELSE 0 END) > 0
        THEN 1.0 * SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END)
          / SUM(CASE WHEN event_type = 'impression' THEN 1 ELSE 0 END)
        ELSE 0
      END AS ctr,
      CASE
        WHEN SUM(CASE WHEN event_type = 'play_audio' THEN 1 ELSE 0 END) > 0
        THEN 1.0 * SUM(CASE WHEN event_type = 'complete_audio' THEN 1 ELSE 0 END)
          / SUM(CASE WHEN event_type = 'play_audio' THEN 1 ELSE 0 END)
        ELSE 0
      END AS completion_rate,
      ?,
      ?
    FROM events_raw
    WHERE event_date = ?
      AND item_id IS NOT NULL
      AND item_id != ''
    GROUP BY scene, item_id
  `);

  const tx = db.transaction(() => {
    summaryInsert.run(date, now, now, date);
    itemInsert.run(date, now, now, date);
  });
  tx();

  const summaryRows = (db.prepare('SELECT COUNT(*) as c FROM events_daily_agg WHERE date = ?').get(date) as { c: number }).c;
  const itemRows = (db.prepare('SELECT COUNT(*) as c FROM item_engagement_daily WHERE date = ?').get(date) as { c: number }).c;

  return { summaryRows, itemRows };
}

export function getUserEventsSince(userId: string, sinceDate: string): EventRow[] {
  return db.prepare(`
    SELECT user_id, event_type, scene, item_id, metadata_json, dwell_ms
    FROM events_raw
    WHERE user_id = ? AND event_date >= ?
    ORDER BY occurred_at DESC
  `).all(userId, sinceDate) as EventRow[];
}

export function getUserActivitySummary(userId: string, startDate: string, endDate: string): UserActivitySummary {
  const row = db.prepare(`
    WITH skipped_article_items AS (
      SELECT DISTINCT item_id
      FROM events_raw
      WHERE user_id = ?
        AND scene = 'article'
        AND event_type = 'skip'
        AND event_date >= ?
        AND event_date <= ?
        AND item_id IS NOT NULL
        AND item_id != ''
    ),
    valid_article_dwell AS (
      SELECT item_id, dwell_ms, metadata_json
      FROM events_raw
      WHERE user_id = ?
        AND scene = 'article'
        AND event_type = 'dwell_time'
        AND event_date >= ?
        AND event_date <= ?
        AND COALESCE(dwell_ms, 0) >= ?
        AND (
          item_id IS NULL
          OR item_id = ''
          OR item_id NOT IN (SELECT item_id FROM skipped_article_items)
        )
    )
    SELECT
      COALESCE((SELECT COUNT(DISTINCT item_id) FROM valid_article_dwell WHERE item_id IS NOT NULL AND item_id != ''), 0) AS reads,
      COALESCE((SELECT SUM(COALESCE(dwell_ms, 0)) FROM valid_article_dwell), 0) AS reading_ms,
      COALESCE((SELECT SUM(COALESCE(CAST(json_extract(metadata_json, '$.wordCount') AS INTEGER), 0)) FROM valid_article_dwell), 0) AS reading_words,
      COALESCE(SUM(CASE WHEN scene = 'audio' AND event_type = 'dwell_time' THEN COALESCE(dwell_ms, 0) ELSE 0 END), 0) AS listening_ms,
      COUNT(CASE WHEN scene = 'article' AND event_type = 'like' THEN 1 END) AS likes,
      COUNT(CASE WHEN scene = 'article' AND event_type = 'dislike' THEN 1 END) AS dislikes
    FROM events_raw
    WHERE user_id = ?
      AND event_date >= ?
      AND event_date <= ?
  `).get(
    userId,
    startDate,
    endDate,
    userId,
    startDate,
    endDate,
    MIN_VALID_READ_MS,
    userId,
    startDate,
    endDate
  ) as {
    reads: number;
    reading_ms: number;
    reading_words: number;
    listening_ms: number;
    likes: number;
    dislikes: number;
  };

  return {
    reads: row?.reads || 0,
    readingSeconds: Math.round((row?.reading_ms || 0) / 1000),
    readingWords: row?.reading_words || 0,
    listeningSeconds: Math.round((row?.listening_ms || 0) / 1000),
    likes: row?.likes || 0,
    dislikes: row?.dislikes || 0,
  };
}
