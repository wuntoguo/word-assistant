#!/usr/bin/env npx tsx
/**
 * Debug recommendation flow step by step.
 * Usage: cd server && npx tsx scripts/debug-recommend.ts [userId]
 */
import 'dotenv/config';
import { getRecommendedArticles } from '../src/recommendation.js';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data.db');
const db = new Database(DB_PATH);

function step(name: string, fn: () => void) {
  console.log('\n--- Step:', name, '---');
  fn();
}

const userId = process.argv[2];

step('1. Articles in DB', () => {
  const total = db.prepare('SELECT COUNT(*) as c FROM articles WHERE COALESCE(is_vocab_story,0)=0').get() as { c: number };
  const recent21 = db.prepare(`
    SELECT COUNT(*) as c FROM articles
    WHERE (pub_date >= date('now','-21 days') OR created_at >= date('now','-21 days'))
      AND COALESCE(is_vocab_story,0)=0
  `).get() as { c: number };
  const today = db.prepare(`
    SELECT COUNT(*) as c FROM articles
    WHERE date(created_at) = date('now') AND COALESCE(is_vocab_story,0)=0
  `).get() as { c: number };
  console.log('  Total articles (non-vocab):', total.c);
  console.log('  Last 21 days:', recent21.c);
  console.log('  Created today:', today.c);
});

step('2. Active users (getActiveUserIds logic)', () => {
  const fromWords = db.prepare('SELECT DISTINCT user_id FROM words').all() as { user_id: string }[];
  const fromFeedback = db.prepare(`
    SELECT DISTINCT user_id FROM article_feedback
    WHERE date(created_at) >= date('now','-14 days')
  `).all() as { user_id: string }[];
  const ids = new Set([...fromWords.map((r) => r.user_id), ...fromFeedback.map((r) => r.user_id)]);
  console.log('  Users with words:', fromWords.length);
  console.log('  Users with recent feedback:', fromFeedback.length);
  console.log('  Active user IDs:', [...ids]);
  if (ids.size === 0) console.log('  ⚠️ NO ACTIVE USERS - precompute will not run for anyone');
});

step('3. Users in DB', () => {
  const users = db.prepare('SELECT id, email, name FROM users').all() as { id: string; email?: string; name?: string }[];
  console.log('  Total users:', users.length);
  users.forEach((u) => console.log('    ', u.id, u.email || u.name || ''));
});

step('4. user_top_articles (recommend cache)', () => {
  const byUser = db.prepare(`
    SELECT user_id, COUNT(*) as cnt FROM user_top_articles GROUP BY user_id
  `).all() as { user_id: string; cnt: number }[];
  console.log('  Rows per user:', byUser.length ? byUser : 'NONE');
  if (byUser.length === 0) console.log('  ⚠️ user_top_articles is EMPTY - recommend will use real-time path or fallback');
});

if (userId) {
  step(`5. User ${userId} - detailed check`, () => {
    const cacheRows = db.prepare('SELECT COUNT(*) as c FROM user_top_articles WHERE user_id = ?').get(userId) as { c: number };
    const feedbackCount = db.prepare('SELECT COUNT(*) as c FROM article_feedback WHERE user_id = ?').get(userId) as { c: number };
    const wordsCount = db.prepare('SELECT COUNT(*) as c FROM words WHERE user_id = ?').get(userId) as { c: number };
    const userExists = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    console.log('  User exists:', !!userExists);
    console.log('  user_top_articles rows:', cacheRows.c);
    console.log('  Feedback count:', feedbackCount.c);
    console.log('  Words count:', wordsCount.c);
    if (cacheRows.c === 0) console.log('  ⚠️ No cache for this user - will use real-time scoring or getArticlesForRecommendation');
  });

  step('6. Simulate recommend dedup (sourceKey = parent_id || id)', () => {
    const rows = db.prepare(`
      SELECT u.article_id, u.difficulty_score, a.parent_id, a.id
      FROM user_top_articles u
      JOIN articles a ON a.id = u.article_id
      WHERE u.user_id = ? AND COALESCE(a.is_vocab_story,0)=0
      ORDER BY u.total_score DESC
    `).all(userId) as { article_id: string; difficulty_score: number; parent_id: string | null; id: string }[];

    const seenKeys = new Set(
      (db.prepare('SELECT article_key FROM article_feedback WHERE user_id = ?').all(userId) as { article_key: string }[])
        .map((r) => r.article_key)
    );

    const bySource = new Map<string, { id: string; difficulty_score: number }>();
    for (const r of rows) {
      const srcUrl = (db.prepare('SELECT source_url FROM articles WHERE id = ?').get(r.article_id) as { source_url: string })?.source_url;
      if (srcUrl && seenKeys.has(srcUrl)) continue;
      const key = r.parent_id || r.id;
      const existing = bySource.get(key);
      if (!existing || r.difficulty_score > existing.difficulty_score) {
        bySource.set(key, { id: r.article_id, difficulty_score: r.difficulty_score });
      }
    }
    const dedupedCount = bySource.size;
    const sliced = dedupedCount;
    const hasMore = 0 + 10 < dedupedCount;
    console.log('  Cache rows:', rows.length);
    console.log('  After feedback filter:', rows.length, '(feedback count:', seenKeys.size, ')');
    console.log('  Unique sourceKeys (parent_id||id):', dedupedCount);
    console.log('  slice(0,10) would return:', Math.min(10, dedupedCount), 'articles');
    console.log('  hasMore:', hasMore);
    if (dedupedCount < 8) console.log('  ⚠️ FEWER THAN 8 DEDUPED → frontend supplements with discovery!');
    if (dedupedCount <= 4) console.log('  ⚠️ ONLY', dedupedCount, 'UNIQUE → explains "4 results + hot articles"');
  });

}

async function runAsyncStep6b() {
  if (!userId) return;
  console.log('\n--- Step: 6b. Call getRecommendedArticles (actual API logic) ---');
  const { articles, hasMore } = await getRecommendedArticles(userId, 10, true, 0);
  console.log('  articles returned:', articles.length);
  console.log('  hasMore:', hasMore);
  if (articles.length > 0) {
    console.log('  first 2:', articles.slice(0, 2).map((a) => a.article.title?.slice(0, 45) + '...'));
  }
  if (articles.length < 8) console.log('  ⚠️ API returns', articles.length, '< 8 → frontend supplements with discovery!');
}

step('7. getArticleIdsCreatedSince(today)', () => {
  const today = new Date().toISOString().split('T')[0];
  const rows = db.prepare(`
    SELECT id FROM articles
    WHERE date(created_at) >= ? AND COALESCE(is_vocab_story,0)=0
  `).all(today) as { id: string }[];
  console.log('  New article IDs since today:', rows.length);
  if (rows.length === 0) console.log('  ⚠️ runDailyPipeline SKIPS recommend-precompute when this is 0');
});

await runAsyncStep6b();

console.log('\n--- Summary ---');
console.log('If you see discovery (no scores): check 1) logged in? 2) user in active list? 3) user_top_articles has rows?');
console.log('Local precompute: DAYS_BACK=14 npm run offline -- recommend-precompute');
console.log('Production: POST /api/cron/warm-recommendations with X-Cron-Secret (see OFFLINE_TASKS.md)');
