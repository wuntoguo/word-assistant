import { v4 as uuidv4 } from 'uuid';
import db from '../db/client.js';

export interface DbUser {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  provider: string;
  provider_id: string;
  password_hash: string | null;
  created_at: string;
}

export interface DbUserProfile {
  user_id: string;
  interest_keywords: string;
  preferred_level_band: string | null;
  created_at: string;
  updated_at: string;
}

export function findUserByProvider(provider: string, providerId: string): DbUser | undefined {
  return db.prepare(
    'SELECT * FROM users WHERE provider = ? AND provider_id = ?'
  ).get(provider, providerId) as DbUser | undefined;
}

export function createUser(user: Omit<DbUser, 'created_at'>): DbUser {
  db.prepare(
    'INSERT INTO users (id, email, name, avatar_url, provider, provider_id, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(user.id || uuidv4(), user.email, user.name, user.avatar_url, user.provider, user.provider_id, user.password_hash || null);
  return findUserByProvider(user.provider, user.provider_id)!;
}

export function findUserById(id: string): DbUser | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUser | undefined;
}

export function findUserByEmail(email: string): DbUser | undefined {
  return db.prepare(
    "SELECT * FROM users WHERE provider = 'email' AND provider_id = ?"
  ).get(email.toLowerCase()) as DbUser | undefined;
}

export function findAnyUserByEmail(email: string): DbUser | undefined {
  return db.prepare(
    'SELECT * FROM users WHERE lower(email) = lower(?) ORDER BY created_at ASC LIMIT 1'
  ).get(email.trim()) as DbUser | undefined;
}

export function updateUserPassword(userId: string, passwordHash: string): void {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

export function getUserProfile(userId: string): DbUserProfile | undefined {
  return db.prepare('SELECT * FROM user_profiles WHERE user_id = ?')
    .get(userId) as DbUserProfile | undefined;
}

export function upsertUserProfile(
  userId: string,
  interestKeywords: string[],
  preferredLevelBand: string | null
): void {
  const keywordsJson = JSON.stringify(interestKeywords);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_profiles (user_id, interest_keywords, preferred_level_band, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      interest_keywords = excluded.interest_keywords,
      preferred_level_band = excluded.preferred_level_band,
      updated_at = excluded.updated_at
  `).run(userId, keywordsJson, preferredLevelBand, now, now);
}

export function getActiveUserIds(sinceDays = 14): string[] {
  const fromSync = db.prepare('SELECT DISTINCT user_id FROM words').all() as { user_id: string }[];
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);
  const sinceStr = since.toISOString().split('T')[0];
  const fromFeedback = db.prepare('SELECT DISTINCT user_id FROM article_feedback WHERE date(created_at) >= ?').all(sinceStr) as { user_id: string }[];
  const ids = new Set<string>([...fromSync.map((r) => r.user_id), ...fromFeedback.map((r) => r.user_id)]);
  return [...ids];
}

export function getActiveUserIdsPage(
  sinceDays = 14,
  limit = 100,
  offset = 0
): string[] {
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);
  const sinceStr = since.toISOString().split('T')[0];
  const rows = db.prepare(`
    SELECT DISTINCT user_id FROM (
      SELECT user_id FROM words
      UNION ALL
      SELECT user_id FROM article_feedback WHERE date(created_at) >= ?
    )
    ORDER BY user_id
    LIMIT ? OFFSET ?
  `).all(sinceStr, limit, offset) as { user_id: string }[];
  return rows.map((r) => r.user_id);
}
