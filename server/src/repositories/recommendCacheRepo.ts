import db from '../db/client.js';
import { getArticleById, type DbArticle } from './articleRepo.js';

export function getShownArticleKeysInLast3Days(userId: string, days = 1): Set<string> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString();
  const rows = db.prepare(`
    SELECT article_key FROM user_shown_articles
    WHERE user_id = ? AND shown_at >= ?
  `).all(userId, sinceStr) as { article_key: string }[];
  return new Set(rows.map((r) => r.article_key));
}

export function recordShownArticles(userId: string, articleKeys: string[]): void {
  const now = new Date().toISOString();
  for (const key of articleKeys) {
    db.prepare(`
      INSERT INTO user_shown_articles (user_id, article_key, shown_at, show_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(user_id, article_key) DO UPDATE SET
        shown_at = excluded.shown_at,
        show_count = COALESCE(show_count, 0) + 1
    `).run(userId, key, now);
  }
}

export function getArticleShowCounts(userId: string): Map<string, number> {
  const rows = db.prepare(`
    SELECT article_key, COALESCE(show_count, 1) AS cnt
    FROM user_shown_articles WHERE user_id = ?
  `).all(userId) as { article_key: string; cnt: number }[];
  return new Map(rows.map((r) => [r.article_key, r.cnt]));
}

export function getArticleEmbedding(articleId: string): number[] | null {
  const row = db.prepare('SELECT embedding_json FROM article_embeddings WHERE article_id = ?').get(articleId) as { embedding_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.embedding_json) as number[];
  } catch {
    return null;
  }
}

export function upsertArticleEmbedding(articleId: string, embedding: number[]): void {
  const json = JSON.stringify(embedding);
  db.prepare(`
    INSERT INTO article_embeddings (article_id, embedding_json) VALUES (?, ?)
    ON CONFLICT(article_id) DO UPDATE SET embedding_json = excluded.embedding_json
  `).run(articleId, json);
}

export function getUserEmbedding(userId: string): { embedding: number[]; interestsHash: string } | null {
  const row = db.prepare('SELECT embedding_json, interests_hash FROM user_embeddings WHERE user_id = ?').get(userId) as { embedding_json: string; interests_hash: string } | undefined;
  if (!row) return null;
  try {
    return {
      embedding: JSON.parse(row.embedding_json) as number[],
      interestsHash: row.interests_hash || '',
    };
  } catch {
    return null;
  }
}

export function upsertUserEmbedding(userId: string, embedding: number[], interestsHash: string): void {
  const json = JSON.stringify(embedding);
  db.prepare(`
    INSERT INTO user_embeddings (user_id, embedding_json, interests_hash) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET embedding_json = excluded.embedding_json, interests_hash = excluded.interests_hash
  `).run(userId, json, interestsHash);
}

export function getUserTopArticles(userId: string, limit = 100): Array<{
  article_id: string;
  total_score: number;
  interest_score: number;
  difficulty_score: number;
  interest_reason: string;
  difficulty_reason: string;
  recommendation_reason: string;
}> {
  return db.prepare(`
    SELECT article_id, total_score, interest_score, difficulty_score,
           interest_reason, difficulty_reason, recommendation_reason
    FROM user_top_articles
    WHERE user_id = ?
    ORDER BY total_score DESC
    LIMIT ?
  `).all(userId, limit) as Array<{
    article_id: string;
    total_score: number;
    interest_score: number;
    difficulty_score: number;
    interest_reason: string;
    difficulty_reason: string;
    recommendation_reason: string;
  }>;
}

export function getUserTopArticlesWithArticle(userId: string, limit = 100): Array<{
  article: DbArticle;
  total_score: number;
  interest_score: number;
  difficulty_score: number;
  interest_reason: string;
  difficulty_reason: string;
  recommendation_reason: string;
}> {
  const rows = db.prepare(`
    SELECT u.article_id, u.total_score, u.interest_score, u.difficulty_score,
           u.interest_reason, u.difficulty_reason, u.recommendation_reason
    FROM user_top_articles u
    JOIN articles a ON a.id = u.article_id
    WHERE u.user_id = ?
      AND (
        COALESCE(a.is_vocab_story, 0) = 1
        OR COALESCE(a.content_len, LENGTH(a.content), 0) >= 500
      )
    ORDER BY u.total_score DESC
    LIMIT ?
  `).all(userId, limit * 2) as Array<{
    article_id: string;
    total_score: number;
    interest_score: number;
    difficulty_score: number;
    interest_reason: string;
    difficulty_reason: string;
    recommendation_reason: string;
  }>;

  const result: Array<{
    article: DbArticle;
    total_score: number;
    interest_score: number;
    difficulty_score: number;
    interest_reason: string;
    difficulty_reason: string;
    recommendation_reason: string;
  }> = [];

  for (const r of rows) {
    const article = getArticleById(r.article_id);
    if (!article) continue;
    if (article.is_vocab_story && article.vocab_story_user_id !== userId) continue;
    result.push({
      article,
      total_score: r.total_score,
      interest_score: r.interest_score,
      difficulty_score: r.difficulty_score,
      interest_reason: r.interest_reason || '',
      difficulty_reason: r.difficulty_reason || '',
      recommendation_reason:
        r.recommendation_reason || 'Interest: 50. Difficulty: 50. Total: 50 (0.4×interest + 0.6×difficulty)',
    });
  }

  return result;
}

export function upsertUserTopArticle(
  userId: string,
  articleId: string,
  scores: {
    totalScore: number;
    interestScore: number;
    difficultyScore: number;
    interestReason?: string;
    difficultyReason?: string;
    recommendationReason?: string;
  }
): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_top_articles (user_id, article_id, total_score, interest_score, difficulty_score, interest_reason, difficulty_reason, recommendation_reason, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, article_id) DO UPDATE SET
      total_score = excluded.total_score, interest_score = excluded.interest_score, difficulty_score = excluded.difficulty_score,
      interest_reason = excluded.interest_reason, difficulty_reason = excluded.difficulty_reason,
      recommendation_reason = excluded.recommendation_reason, updated_at = excluded.updated_at
  `).run(
    userId,
    articleId,
    scores.totalScore,
    scores.interestScore,
    scores.difficultyScore,
    scores.interestReason || '',
    scores.difficultyReason || '',
    scores.recommendationReason || 'Interest: 50. Difficulty: 50. Total: 50 (0.4×interest + 0.6×difficulty)',
    now
  );
}

export function pruneUserTopArticles(userId: string, keepTop = 100): void {
  const rows = db.prepare(`
    SELECT article_id FROM user_top_articles WHERE user_id = ?
    ORDER BY total_score DESC
    LIMIT ?
  `).all(userId, keepTop) as { article_id: string }[];

  if (rows.length === 0) return;

  const keep = rows.map((r) => r.article_id);
  const placeholders = keep.map(() => '?').join(',');
  db.prepare(`
    DELETE FROM user_top_articles WHERE user_id = ? AND article_id NOT IN (${placeholders})
  `).run(userId, ...keep);
}

export function purgeOldUserTopArticles(daysBack = 3): number {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceStr = since.toISOString().split('T')[0];
  const result = db.prepare(`
    DELETE FROM user_top_articles
    WHERE article_id IN (
      SELECT a.id
      FROM articles a
      WHERE COALESCE(date(a.pub_date), date(a.created_at)) < date(?)
    )
  `).run(sinceStr);
  return result.changes;
}
