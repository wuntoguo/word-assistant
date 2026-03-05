import { v4 as uuidv4 } from 'uuid';
import db from '../db/client.js';

export interface DbTestResult {
  id: string;
  user_id: string;
  test_date: string;
  score: number;
  total: number;
  created_at: string;
}

export interface DbArticleFeedback {
  id: string;
  user_id: string;
  article_key: string;
  article_id: string | null;
  liked: number | null;
  hard: number | null;
  created_at: string;
}

export function upsertTestResult(userId: string, testDate: string, score: number, total: number): void {
  const id = `${userId}-${testDate}`;
  db.prepare(`
    INSERT INTO weekly_test_results (id, user_id, test_date, score, total)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, test_date) DO UPDATE SET score = excluded.score, total = excluded.total
  `).run(id, userId, testDate, score, total);
}

export function getTestResultsByUser(userId: string, limit = 8): DbTestResult[] {
  return db.prepare(
    'SELECT * FROM weekly_test_results WHERE user_id = ? ORDER BY test_date DESC LIMIT ?'
  ).all(userId, limit) as DbTestResult[];
}

export function upsertArticleFeedback(
  userId: string,
  articleKey: string,
  liked: boolean | null,
  hard: number | null
): void {
  const likedNum = liked === null ? null : (liked ? 1 : 0);
  const existing = db.prepare(
    'SELECT id FROM article_feedback WHERE user_id = ? AND article_key = ?'
  ).get(userId, articleKey) as { id: string } | undefined;

  if (existing) {
    db.prepare('UPDATE article_feedback SET liked = ?, hard = ? WHERE id = ?')
      .run(likedNum, hard, existing.id);
  } else {
    db.prepare(
      'INSERT INTO article_feedback (id, user_id, article_key, liked, hard) VALUES (?, ?, ?, ?, ?)'
    ).run(uuidv4(), userId, articleKey, likedNum, hard);
  }
}

export function upsertArticleFeedbackWithArticleId(
  userId: string,
  articleKeyOrId: string,
  articleId: string | null,
  liked: boolean | null,
  hard: number | null
): void {
  const likedNum = liked === null ? null : (liked ? 1 : 0);
  const existing = db.prepare(
    'SELECT id FROM article_feedback WHERE user_id = ? AND article_key = ?'
  ).get(userId, articleKeyOrId) as { id: string } | undefined;

  if (existing) {
    db.prepare('UPDATE article_feedback SET liked = ?, hard = ?, article_id = ? WHERE id = ?')
      .run(likedNum, hard, articleId, existing.id);
  } else {
    db.prepare(
      'INSERT INTO article_feedback (id, user_id, article_key, article_id, liked, hard) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), userId, articleKeyOrId, articleId, likedNum, hard);
  }
}

export function getFeedbackByUser(userId: string, limit = 30): DbArticleFeedback[] {
  return db.prepare(
    'SELECT * FROM article_feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, limit) as DbArticleFeedback[];
}
