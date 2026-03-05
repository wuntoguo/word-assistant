import db from '../db/client.js';

export interface UserProfileDaily {
  user_id: string;
  snapshot_date: string;
  interest_keywords_json: string;
  dislike_keywords_json: string;
  preferred_scene: string | null;
  avg_dwell_ms: number | null;
  article_ctr: number | null;
  audio_completion_rate: number | null;
  updated_at: string;
}

export function upsertUserProfileDaily(input: {
  userId: string;
  snapshotDate: string;
  interestKeywords: string[];
  dislikeKeywords: string[];
  preferredScene: string | null;
  avgDwellMs: number | null;
  articleCtr: number | null;
  audioCompletionRate: number | null;
}): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_profile_daily (
      user_id, snapshot_date, interest_keywords_json, dislike_keywords_json,
      preferred_scene, avg_dwell_ms, article_ctr, audio_completion_rate, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      snapshot_date = excluded.snapshot_date,
      interest_keywords_json = excluded.interest_keywords_json,
      dislike_keywords_json = excluded.dislike_keywords_json,
      preferred_scene = excluded.preferred_scene,
      avg_dwell_ms = excluded.avg_dwell_ms,
      article_ctr = excluded.article_ctr,
      audio_completion_rate = excluded.audio_completion_rate,
      updated_at = excluded.updated_at
  `).run(
    input.userId,
    input.snapshotDate,
    JSON.stringify(input.interestKeywords || []),
    JSON.stringify(input.dislikeKeywords || []),
    input.preferredScene,
    input.avgDwellMs,
    input.articleCtr,
    input.audioCompletionRate,
    now
  );
}

export function getUserProfileDaily(userId: string): UserProfileDaily | undefined {
  return db.prepare('SELECT * FROM user_profile_daily WHERE user_id = ?').get(userId) as UserProfileDaily | undefined;
}
