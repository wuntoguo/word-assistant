import db from '../db/client.js';

export interface DbArticle {
  id: string;
  parent_id: string | null;
  source_url: string;
  title: string;
  content: string | null;
  simplified_content: string | null;
  keywords: string;
  is_translated: number;
  difficulty_original: string | null;
  difficulty_simplified: string | null;
  difficulty_score_original: number | null;
  difficulty_score_simplified: number | null;
  pub_date: string | null;
  source_name: string | null;
  created_at: string;
  fulltext_status?: string | null;
  content_source?: string | null;
  content_len?: number | null;
  last_crawled_at?: string | null;
  crawl_error?: string | null;
  is_vocab_story?: number;
  vocab_story_user_id?: string | null;
}

export function upsertArticle(article: {
  id: string;
  parent_id?: string | null;
  source_url: string;
  title: string;
  content?: string | null;
  simplified_content?: string | null;
  keywords?: string[];
  is_translated?: boolean;
  difficulty_original?: string | null;
  difficulty_simplified?: string | null;
  difficulty_score_original?: number | null;
  difficulty_score_simplified?: number | null;
  pub_date?: string | null;
  source_name?: string | null;
  fulltext_status?: 'pending' | 'success' | 'failed';
  content_source?: string | null;
  content_len?: number | null;
  last_crawled_at?: string | null;
  crawl_error?: string | null;
}): void {
  const keywords = JSON.stringify(article.keywords || []);
  db.prepare(`
    INSERT INTO articles (id, parent_id, source_url, title, content, simplified_content, keywords, is_translated,
      difficulty_original, difficulty_simplified, difficulty_score_original, difficulty_score_simplified,
      pub_date, source_name, fulltext_status, content_source, content_len, last_crawled_at, crawl_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_url) DO UPDATE SET
      title = excluded.title,
      content = COALESCE(excluded.content, content),
      simplified_content = COALESCE(excluded.simplified_content, simplified_content),
      keywords = CASE WHEN excluded.keywords != '[]' THEN excluded.keywords ELSE keywords END,
      is_translated = excluded.is_translated,
      difficulty_original = COALESCE(excluded.difficulty_original, difficulty_original),
      difficulty_simplified = COALESCE(excluded.difficulty_simplified, difficulty_simplified),
      difficulty_score_original = COALESCE(excluded.difficulty_score_original, difficulty_score_original),
      difficulty_score_simplified = COALESCE(excluded.difficulty_score_simplified, difficulty_score_simplified),
      pub_date = COALESCE(excluded.pub_date, pub_date),
      source_name = COALESCE(excluded.source_name, source_name),
      fulltext_status = COALESCE(excluded.fulltext_status, fulltext_status),
      content_source = COALESCE(excluded.content_source, content_source),
      content_len = COALESCE(excluded.content_len, content_len),
      last_crawled_at = COALESCE(excluded.last_crawled_at, last_crawled_at),
      crawl_error = excluded.crawl_error
  `).run(
    article.id, article.parent_id || null, article.source_url, article.title,
    article.content ?? null, article.simplified_content ?? null, keywords,
    article.is_translated ? 1 : 0,
    article.difficulty_original ?? null, article.difficulty_simplified ?? null,
    article.difficulty_score_original ?? null, article.difficulty_score_simplified ?? null,
    article.pub_date ?? null, article.source_name ?? null,
    article.fulltext_status ?? null, article.content_source ?? null,
    article.content_len ?? (article.content ? article.content.length : null),
    article.last_crawled_at ?? new Date().toISOString(),
    article.crawl_error ?? null
  );
}

export function getArticleByUrl(sourceUrl: string): DbArticle | undefined {
  return db.prepare('SELECT * FROM articles WHERE source_url = ?').get(sourceUrl) as DbArticle | undefined;
}

export function getArticleById(id: string): DbArticle | undefined {
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as DbArticle | undefined;
}

export function getAllArticles(limit = 100): DbArticle[] {
  return db.prepare(`
    SELECT * FROM articles
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as DbArticle[];
}

export function getDiscoveryFulltextArticles(offset = 0, limit = 10, daysBack = 3): DbArticle[] {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceStr = since.toISOString().split('T')[0];
  return db.prepare(`
    WITH candidates AS (
      SELECT *,
             ROW_NUMBER() OVER (
               PARTITION BY COALESCE(parent_id, id)
               ORDER BY datetime(created_at) DESC
             ) AS rn
      FROM articles
      WHERE COALESCE(is_vocab_story, 0) = 0
        AND parent_id IS NULL
        AND COALESCE(date(pub_date), date(created_at)) >= date(?)
        AND (
          fulltext_status = 'success'
          OR (content IS NOT NULL AND LENGTH(content) >= 500)
        )
    )
    SELECT * FROM candidates
    WHERE rn = 1
    ORDER BY datetime(created_at) DESC
    LIMIT ? OFFSET ?
  `).all(sinceStr, limit, offset) as DbArticle[];
}

export function getDiscoveryFulltextCount(daysBack = 3): number {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceStr = since.toISOString().split('T')[0];
  const row = db.prepare(`
    SELECT COUNT(*) as c FROM articles
    WHERE COALESCE(is_vocab_story, 0) = 0
      AND parent_id IS NULL
      AND COALESCE(date(pub_date), date(created_at)) >= date(?)
      AND (
        fulltext_status = 'success'
        OR (content IS NOT NULL AND LENGTH(content) >= 500)
      )
  `).get(sinceStr) as { c: number };
  return row?.c ?? 0;
}

export function getArticleCount(): number {
  const row = db.prepare('SELECT COUNT(*) as c FROM articles').get() as { c: number };
  return row?.c ?? 0;
}

export function getArticleCountBySource(): { source_name: string; count: number }[] {
  return db.prepare(`
    SELECT COALESCE(source_name, '(Unknown)') as source_name, COUNT(*) as count
    FROM articles
    GROUP BY source_name
    ORDER BY count DESC
  `).all() as { source_name: string; count: number }[];
}

export function getArticleCountBySourceForDate(dateStr: string): { source_name: string; count: number }[] {
  return db.prepare(`
    SELECT COALESCE(source_name, '(Unknown)') as source_name, COUNT(*) as count
    FROM articles
    WHERE date(created_at) = ? AND COALESCE(is_vocab_story, 0) = 0
    GROUP BY source_name
    ORDER BY count DESC
  `).all(dateStr) as { source_name: string; count: number }[];
}

export function getArticleCountByDay(days = 14): { date: string; count: number }[] {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];
  return db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as count
    FROM articles
    WHERE created_at >= ?
    GROUP BY date(created_at)
    ORDER BY date DESC
  `).all(sinceStr) as { date: string; count: number }[];
}

function getArticlesTop2PerSourceForAudio(): DbArticle[] {
  return db.prepare(`
    WITH ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY COALESCE(source_name, '(Unknown)')
        ORDER BY COALESCE(pub_date, created_at) DESC
      ) AS rn
      FROM articles
      WHERE COALESCE(is_vocab_story, 0) = 0
        AND (simplified_content IS NOT NULL AND simplified_content != ''
             OR content IS NOT NULL AND content != '')
    )
    SELECT * FROM ranked WHERE rn <= 2
  `).all() as DbArticle[];
}

const FINANCE_TECH_SOURCES = [
  'Yahoo Finance', 'CNN Business', 'NPR Business',
  'CNN Tech', 'TechCrunch', 'Ars Technica', 'NPR Technology',
];

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function getArticlesTopFinanceTechForAudio(limit = 5, daysBack = 5): DbArticle[] {
  const placeholders = FINANCE_TECH_SOURCES.map(() => '?').join(',');
  const sinceStr = getDateDaysAgo(daysBack);
  return db.prepare(`
    SELECT * FROM articles
    WHERE COALESCE(is_vocab_story, 0) = 0
      AND source_name IN (${placeholders})
      AND date(COALESCE(pub_date, created_at)) >= ?
      AND (simplified_content IS NOT NULL AND simplified_content != ''
           OR content IS NOT NULL AND content != '')
    ORDER BY date(COALESCE(pub_date, created_at)) DESC,
             MAX(LENGTH(COALESCE(simplified_content, '')), LENGTH(COALESCE(content, ''))) DESC
    LIMIT ?
  `).all(...FINANCE_TECH_SOURCES, sinceStr, limit) as DbArticle[];
}

function getArticlesTop10ByLikesForAudio(daysBack = 5): DbArticle[] {
  const sinceStr = getDateDaysAgo(daysBack);
  const byLikes = db.prepare(`
    SELECT a.* FROM articles a
    INNER JOIN (
      SELECT article_id AS aid, COUNT(*) AS cnt FROM article_feedback
      WHERE liked = 1 AND article_id IS NOT NULL
      GROUP BY article_id
    ) t ON a.id = t.aid
    WHERE COALESCE(a.is_vocab_story, 0) = 0
      AND date(COALESCE(a.pub_date, a.created_at)) >= ?
      AND (a.simplified_content IS NOT NULL AND a.simplified_content != ''
           OR a.content IS NOT NULL AND a.content != '')
    ORDER BY date(COALESCE(a.pub_date, a.created_at)) DESC, t.cnt DESC
    LIMIT 10
  `).all(sinceStr) as DbArticle[];
  if (byLikes.length > 0) return byLikes;
  return getArticlesTop2PerSourceForAudio();
}

function audioSourceKey(a: { id: string; parent_id?: string | null }): string {
  return a.parent_id || a.id;
}

export function getArticlesForAudioGeneration(): DbArticle[] {
  const financeTechRecent = getArticlesTopFinanceTechForAudio(5, 3);
  const likesRecent = getArticlesTop10ByLikesForAudio(3);
  const financeTechFallback = financeTechRecent.length >= 4 ? [] : getArticlesTopFinanceTechForAudio(5, 14);
  const likesFallback = likesRecent.length >= 4 ? [] : getArticlesTop10ByLikesForAudio(14);
  const seen = new Set<string>();
  const bySource = new Map<string, DbArticle>();

  const add = (a: DbArticle) => {
    const key = audioSourceKey(a);
    if (seen.has(a.id)) return;
    const existing = bySource.get(key);
    if (!existing || (a.simplified_content && !existing.simplified_content)) {
      seen.add(a.id);
      if (existing) seen.delete(existing.id);
      bySource.set(key, a);
    }
  };

  for (const a of financeTechRecent) add(a);
  for (const a of likesRecent) add(a);
  for (const a of financeTechFallback) add(a);
  for (const a of likesFallback) add(a);
  return [...bySource.values()].slice(0, 10);
}

export function getArticlesForRecommendation(limit = 50, sinceDays = 7): DbArticle[] {
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);
  const sinceStr = since.toISOString().split('T')[0];
  return db.prepare(`
    SELECT * FROM articles
    WHERE (pub_date >= ? OR created_at >= ?)
      AND COALESCE(is_vocab_story, 0) = 0
      AND COALESCE(content_len, LENGTH(content), 0) >= 500
    ORDER BY created_at DESC, pub_date DESC
    LIMIT ?
  `).all(sinceStr, sinceStr, limit) as DbArticle[];
}

export function getSourceUrlByArticleId(articleId: string): string | undefined {
  const row = db.prepare('SELECT source_url FROM articles WHERE id = ?').get(articleId) as { source_url: string } | undefined;
  return row?.source_url;
}

export function getVocabStoryCount(): number {
  const row = db.prepare('SELECT COUNT(*) as c FROM articles WHERE is_vocab_story = 1').get() as { c: number };
  return row?.c ?? 0;
}

export function getCrawledArticleCount(): number {
  const row = db.prepare('SELECT COUNT(*) as c FROM articles WHERE COALESCE(is_vocab_story,0)=0').get() as { c: number };
  return row?.c ?? 0;
}

export function getUserCount(): number {
  const row = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  return row?.c ?? 0;
}

export function getWordCount(): number {
  const row = db.prepare('SELECT COUNT(*) as c FROM words').get() as { c: number };
  return row?.c ?? 0;
}

export function getArticleFeedbackCount(): number {
  const row = db.prepare('SELECT COUNT(*) as c FROM article_feedback').get() as { c: number };
  return row?.c ?? 0;
}

export function getDistinctFeedbackUsersOnDate(date: string): number {
  const row = db.prepare(
    'SELECT COUNT(DISTINCT user_id) as c FROM article_feedback WHERE date(created_at) = ?'
  ).get(date) as { c: number } | undefined;
  return row?.c ?? 0;
}

export function getVocabStoriesForUser(userId: string, limit = 5): DbArticle[] {
  return db.prepare(`
    SELECT * FROM articles
    WHERE is_vocab_story = 1 AND vocab_story_user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit) as DbArticle[];
}

export function getVocabStoriesForToday(userId: string, limit = 5): DbArticle[] {
  const today = new Date().toISOString().split('T')[0];
  return db.prepare(`
    SELECT * FROM articles
    WHERE is_vocab_story = 1
      AND vocab_story_user_id = ?
      AND date(created_at) = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, today, limit) as DbArticle[];
}

export function getVocabStoryTodayCount(userId: string): number {
  const today = new Date().toISOString().split('T')[0];
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM articles
    WHERE is_vocab_story = 1
      AND vocab_story_user_id = ?
      AND date(created_at) = ?
  `).get(userId, today) as { c: number } | undefined;
  return row?.c ?? 0;
}

export function hasVocabStoryToday(userId: string): boolean {
  return getVocabStoryTodayCount(userId) > 0;
}

export function getVocabStoriesForRecommend(userId: string, excludeSourceUrls: Set<string>, limit = 2): DbArticle[] {
  const stories = getVocabStoriesForUser(userId, 20);
  return stories.filter((a) => !excludeSourceUrls.has(a.source_url)).slice(0, limit);
}

export function insertVocabStoryArticle(article: {
  id: string;
  source_url: string;
  title: string;
  content: string;
  simplified_content?: string;
  keywords: string[];
  userId: string;
}): void {
  const keywords = JSON.stringify(article.keywords || []);
  db.prepare(`
    INSERT INTO articles (id, parent_id, source_url, title, content, simplified_content, keywords, is_translated,
      difficulty_original, difficulty_simplified, pub_date, source_name, is_vocab_story, vocab_story_user_id)
    VALUES (?, NULL, ?, ?, ?, ?, ?, 1, 'B1', 'B1', ?, 'FeedLingo Vocab Story', 1, ?)
  `).run(
    article.id,
    article.source_url,
    article.title,
    article.content,
    article.simplified_content ?? article.content,
    keywords,
    new Date().toISOString().split('T')[0],
    article.userId,
  );
}

export function getArticleIdsCreatedSince(dateStr: string): string[] {
  const rows = db.prepare(`
    SELECT id FROM articles
    WHERE date(created_at) >= ? AND COALESCE(is_vocab_story, 0) = 0
  `).all(dateStr) as { id: string }[];
  return rows.map((r) => r.id);
}

export function getArticleIdsCreatedSincePage(dateStr: string, limit = 100, offset = 0): string[] {
  const rows = db.prepare(`
    SELECT id FROM articles
    WHERE date(created_at) >= ? AND COALESCE(is_vocab_story, 0) = 0
    ORDER BY datetime(created_at) DESC
    LIMIT ? OFFSET ?
  `).all(dateStr, limit, offset) as { id: string }[];
  return rows.map((r) => r.id);
}

export function getRecentTopicArticles(topic: 'finance' | 'travel', limit = 5, daysBack = 3): DbArticle[] {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceStr = since.toISOString().split('T')[0];

  if (topic === 'finance') {
    return db.prepare(`
      SELECT * FROM articles
      WHERE COALESCE(is_vocab_story, 0) = 0
        AND parent_id IS NULL
        AND COALESCE(content_len, LENGTH(content), 0) >= 500
        AND date(COALESCE(pub_date, created_at)) >= date(?)
        AND (
          source_name IN ('Yahoo Finance', 'CNN Business', 'NPR Business')
          OR lower(title) LIKE '%market%'
          OR lower(title) LIKE '%stock%'
          OR lower(title) LIKE '%earnings%'
          OR lower(title) LIKE '%economy%'
          OR lower(title) LIKE '%invest%'
        )
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `).all(sinceStr, limit) as DbArticle[];
  }

  return db.prepare(`
    SELECT * FROM articles
    WHERE COALESCE(is_vocab_story, 0) = 0
      AND parent_id IS NULL
      AND COALESCE(content_len, LENGTH(content), 0) >= 500
      AND date(COALESCE(pub_date, created_at)) >= date(?)
      AND (
        source_name IN ('CNN Travel')
        OR lower(title) LIKE '%travel%'
        OR lower(title) LIKE '%trip%'
        OR lower(title) LIKE '%flight%'
        OR lower(title) LIKE '%tourism%'
        OR lower(title) LIKE '%destination%'
      )
    ORDER BY datetime(created_at) DESC
    LIMIT ?
  `).all(sinceStr, limit) as DbArticle[];
}
