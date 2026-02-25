import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data.db');

const db: InstanceType<typeof Database> = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT,
    name TEXT,
    avatar_url TEXT,
    provider TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    password_hash TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(provider, provider_id)
  );

  CREATE TABLE IF NOT EXISTS words (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    word TEXT NOT NULL,
    phonetic TEXT DEFAULT '',
    audio_url TEXT DEFAULT '',
    part_of_speech TEXT DEFAULT '',
    definitions TEXT DEFAULT '[]',
    examples TEXT DEFAULT '[]',
    date_added TEXT NOT NULL,
    next_review_date TEXT NOT NULL,
    review_count INTEGER DEFAULT 0,
    memory_stage INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, word)
  );

  CREATE INDEX IF NOT EXISTS idx_words_user_id ON words(user_id);
  CREATE INDEX IF NOT EXISTS idx_words_updated_at ON words(user_id, updated_at);

  CREATE TABLE IF NOT EXISTS weekly_test_results (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    test_date TEXT NOT NULL,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, test_date)
  );

  CREATE TABLE IF NOT EXISTS article_feedback (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    article_key TEXT NOT NULL,
    liked INTEGER,
    hard INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, article_key)
  );

  CREATE INDEX IF NOT EXISTS idx_test_results_user ON weekly_test_results(user_id);
  CREATE INDEX IF NOT EXISTS idx_feedback_user ON article_feedback(user_id);

  CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    interest_keywords TEXT DEFAULT '[]',
    preferred_level_band TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES articles(id),
    source_url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    content TEXT,
    simplified_content TEXT,
    keywords TEXT DEFAULT '[]',
    is_translated INTEGER DEFAULT 0,
    difficulty_original TEXT,
    difficulty_simplified TEXT,
    difficulty_score_original INTEGER,
    difficulty_score_simplified INTEGER,
    pub_date TEXT,
    source_name TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_articles_pub_date ON articles(pub_date);
  CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at);
`);

// Migrate: add archived column if it doesn't exist
try {
  db.exec(`ALTER TABLE words ADD COLUMN archived INTEGER DEFAULT 0`);
} catch {
  // Column already exists
}

// Migrate: add password_hash column if it doesn't exist
try {
  db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT`);
} catch {
  // Column already exists
}

// Migrate: add article_id to article_feedback
try {
  db.exec(`ALTER TABLE article_feedback ADD COLUMN article_id TEXT REFERENCES articles(id)`);
} catch {
  // Column already exists
}

// Migrate: vocab story marker for AI-generated stories from user's words
try {
  db.exec(`ALTER TABLE articles ADD COLUMN is_vocab_story INTEGER DEFAULT 0`);
  db.exec(`ALTER TABLE articles ADD COLUMN vocab_story_user_id TEXT`);
} catch {
  // Columns already exist
}

// Migrate: remove vocab stories from user_top_articles (personalized per user, must not be in shared pool)
try {
  db.exec(`DELETE FROM user_top_articles WHERE article_id IN (SELECT id FROM articles WHERE is_vocab_story = 1)`);
} catch {
  //
}

// Migrate: create user_profiles table (static profile)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      interest_keywords TEXT DEFAULT '[]',
      preferred_level_band TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
} catch {
  // Table already exists
}

// Migrate: daily_crawl_reports
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_crawl_reports (
      id TEXT PRIMARY KEY,
      report_date TEXT NOT NULL,
      ingested INTEGER DEFAULT 0,
      skipped INTEGER DEFAULT 0,
      errors INTEGER DEFAULT 0,
      by_category TEXT,
      duration_ms INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_crawl_reports_date ON daily_crawl_reports(report_date)`);
} catch {
  //
}

// Migrate: recommendation cache tables
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS article_embeddings (
      article_id TEXT PRIMARY KEY REFERENCES articles(id),
      embedding_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_embeddings (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      embedding_json TEXT NOT NULL,
      interests_hash TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_top_articles (
      user_id TEXT NOT NULL REFERENCES users(id),
      article_id TEXT NOT NULL REFERENCES articles(id),
      total_score REAL NOT NULL,
      interest_score REAL NOT NULL,
      difficulty_score REAL NOT NULL,
      interest_reason TEXT,
      difficulty_reason TEXT,
      recommendation_reason TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, article_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_user_top_articles_score ON user_top_articles(user_id, total_score DESC)`);
} catch {
  //
}

// Migrate: user_shown_articles (show_count for demotion, no filtering)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_shown_articles (
      user_id TEXT NOT NULL REFERENCES users(id),
      article_key TEXT NOT NULL,
      shown_at TEXT DEFAULT (datetime('now')),
      show_count INTEGER DEFAULT 1,
      PRIMARY KEY (user_id, article_key)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_user_shown_at ON user_shown_articles(user_id, shown_at)`);
  try {
    db.exec(`ALTER TABLE user_shown_articles ADD COLUMN show_count INTEGER DEFAULT 1`);
  } catch {
    /* column may already exist */
  }
} catch {
  //
}

// Migrate: metrics_daily for monitoring
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS metrics_daily (
      date TEXT PRIMARY KEY,
      define_requests INTEGER DEFAULT 0,
      article_content_requests INTEGER DEFAULT 0,
      recommend_requests INTEGER DEFAULT 0,
      article_reads INTEGER DEFAULT 0,
      sync_requests INTEGER DEFAULT 0,
      weekly_test_requests INTEGER DEFAULT 0,
      unique_users INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
} catch {
  //
}

// --- User queries ---

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

export function findUserByProvider(provider: string, providerId: string): DbUser | undefined {
  return db.prepare(
    'SELECT * FROM users WHERE provider = ? AND provider_id = ?'
  ).get(provider, providerId) as DbUser | undefined;
}

export function createUser(user: Omit<DbUser, 'created_at'>): DbUser {
  db.prepare(
    'INSERT INTO users (id, email, name, avatar_url, provider, provider_id, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(user.id, user.email, user.name, user.avatar_url, user.provider, user.provider_id, user.password_hash || null);
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

export function updateUserPassword(userId: string, passwordHash: string): void {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

// --- User profiles (static profile for recommendations) ---

export interface DbUserProfile {
  user_id: string;
  interest_keywords: string;
  preferred_level_band: string | null;
  created_at: string;
  updated_at: string;
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

// --- Word queries ---

export interface DbWord {
  id: string;
  user_id: string;
  word: string;
  phonetic: string;
  audio_url: string;
  part_of_speech: string;
  definitions: string;   // JSON array string
  examples: string;      // JSON array string
  date_added: string;
  next_review_date: string;
  review_count: number;
  memory_stage: number;
  archived: number;      // 0 = active, 1 = archived
  updated_at: string;
}

export function getWordsByUser(userId: string, since?: string): DbWord[] {
  if (since) {
    return db.prepare(
      'SELECT * FROM words WHERE user_id = ? AND updated_at > ?'
    ).all(userId, since) as DbWord[];
  }
  return db.prepare(
    'SELECT * FROM words WHERE user_id = ?'
  ).all(userId) as DbWord[];
}

export function getWordsFromLastNDays(userId: string, days = 7): DbWord[] {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString();
  return db.prepare(
    'SELECT * FROM words WHERE user_id = ? AND archived = 0 AND date_added >= date(?) ORDER BY date_added DESC'
  ).all(userId, sinceStr) as DbWord[];
}

export function getWordByUserAndWord(userId: string, word: string): DbWord | undefined {
  return db.prepare(
    'SELECT * FROM words WHERE user_id = ? AND word = ?'
  ).get(userId, word) as DbWord | undefined;
}

export function upsertWord(word: DbWord): void {
  db.prepare(`
    INSERT INTO words (id, user_id, word, phonetic, audio_url, part_of_speech, definitions, examples, date_added, next_review_date, review_count, memory_stage, archived, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, word) DO UPDATE SET
      phonetic = excluded.phonetic,
      audio_url = excluded.audio_url,
      part_of_speech = excluded.part_of_speech,
      definitions = excluded.definitions,
      examples = excluded.examples,
      date_added = excluded.date_added,
      next_review_date = excluded.next_review_date,
      review_count = excluded.review_count,
      memory_stage = excluded.memory_stage,
      archived = excluded.archived,
      updated_at = excluded.updated_at
  `).run(
    word.id, word.user_id, word.word, word.phonetic, word.audio_url,
    word.part_of_speech, word.definitions, word.examples,
    word.date_added, word.next_review_date, word.review_count,
    word.memory_stage, word.archived ? 1 : 0, word.updated_at
  );
}

// --- Level / Test results / Feedback ---

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
  const hardNum = hard;
  const existing = db.prepare(
    'SELECT id FROM article_feedback WHERE user_id = ? AND article_key = ?'
  ).get(userId, articleKey) as { id: string } | undefined;
  if (existing) {
    db.prepare('UPDATE article_feedback SET liked = ?, hard = ? WHERE id = ?')
      .run(likedNum, hardNum, existing.id);
  } else {
    db.prepare(
      'INSERT INTO article_feedback (id, user_id, article_key, liked, hard) VALUES (?, ?, ?, ?, ?)'
    ).run(uuidv4(), userId, articleKey, likedNum, hardNum);
  }
}

export function getFeedbackByUser(userId: string, limit = 30): DbArticleFeedback[] {
  return db.prepare(
    'SELECT * FROM article_feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, limit) as DbArticleFeedback[];
}

// --- Articles (recommendation system) ---

export interface DbArticle {
  id: string;
  parent_id: string | null;
  source_url: string;
  title: string;
  content: string | null;
  simplified_content: string | null;
  keywords: string;  // JSON array
  is_translated: number;
  difficulty_original: string | null;
  difficulty_simplified: string | null;
  difficulty_score_original: number | null;
  difficulty_score_simplified: number | null;
  pub_date: string | null;
  source_name: string | null;
  created_at: string;
  is_vocab_story?: number;     // 1 = personalized per user, must not recommend to others
  vocab_story_user_id?: string | null;
}

export function getArticleByUrl(sourceUrl: string): DbArticle | undefined {
  return db.prepare('SELECT * FROM articles WHERE source_url = ?').get(sourceUrl) as DbArticle | undefined;
}

export function getArticleById(id: string): DbArticle | undefined {
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as DbArticle | undefined;
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
}): void {
  const keywords = JSON.stringify(article.keywords || []);
  db.prepare(`
    INSERT INTO articles (id, parent_id, source_url, title, content, simplified_content, keywords, is_translated,
      difficulty_original, difficulty_simplified, difficulty_score_original, difficulty_score_simplified,
      pub_date, source_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      source_name = COALESCE(excluded.source_name, source_name)
  `).run(
    article.id, article.parent_id || null, article.source_url, article.title,
    article.content ?? null, article.simplified_content ?? null, keywords,
    article.is_translated ? 1 : 0,
    article.difficulty_original ?? null, article.difficulty_simplified ?? null,
    article.difficulty_score_original ?? null, article.difficulty_score_simplified ?? null,
    article.pub_date ?? null, article.source_name ?? null
  );
}

export function getAllArticles(limit = 100): DbArticle[] {
  return db.prepare(`
    SELECT * FROM articles
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as DbArticle[];
}

export function getArticleCount(): number {
  const row = db.prepare('SELECT COUNT(*) as c FROM articles').get() as { c: number };
  return row?.c ?? 0;
}

export function getArticleCountBySource(): { source_name: string; count: number }[] {
  const rows = db.prepare(`
    SELECT COALESCE(source_name, '(Unknown)') as source_name, COUNT(*) as count
    FROM articles
    GROUP BY source_name
    ORDER BY count DESC
  `).all() as { source_name: string; count: number }[];
  return rows;
}

/** Articles created on a specific date, grouped by source_name. */
export function getArticleCountBySourceForDate(dateStr: string): { source_name: string; count: number }[] {
  const rows = db.prepare(`
    SELECT COALESCE(source_name, '(Unknown)') as source_name, COUNT(*) as count
    FROM articles
    WHERE date(created_at) = ? AND COALESCE(is_vocab_story, 0) = 0
    GROUP BY source_name
    ORDER BY count DESC
  `).all(dateStr) as { source_name: string; count: number }[];
  return rows;
}

export function getArticleCountByDay(days = 14): { date: string; count: number }[] {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];
  const rows = db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as count
    FROM articles
    WHERE created_at >= ?
    GROUP BY date(created_at)
    ORDER BY date DESC
  `).all(sinceStr) as { date: string; count: number }[];
  return rows;
}

/** Top 2 articles per source_name (category) for TTS audio. Excludes vocab stories. */
export function getArticlesTop2PerSourceForAudio(): DbArticle[] {
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

/** Finance + Tech source names for daily hot audio. */
const FINANCE_TECH_SOURCES = [
  'Yahoo Finance', 'CNN Business', 'NPR Business', 'CNBC', 'Reuters',
  'CNN Tech', 'TechCrunch', 'Ars Technica', 'NPR Technology',
];

/** Top N finance + tech articles. No min length - prefer longer, but include any with content. */
export function getArticlesTopFinanceTechForAudio(limit = 5): DbArticle[] {
  const placeholders = FINANCE_TECH_SOURCES.map(() => '?').join(',');
  return db.prepare(`
    SELECT * FROM articles
    WHERE COALESCE(is_vocab_story, 0) = 0
      AND source_name IN (${placeholders})
      AND (simplified_content IS NOT NULL AND simplified_content != ''
           OR content IS NOT NULL AND content != '')
    ORDER BY MAX(LENGTH(COALESCE(simplified_content, '')), LENGTH(COALESCE(content, ''))) DESC,
             COALESCE(pub_date, created_at) DESC
    LIMIT ?
  `).all(...FINANCE_TECH_SOURCES, limit) as DbArticle[];
}

/** Top 10 articles by like count for TTS audio. Fallback to top-2-per-source when no likes yet. */
export function getArticlesTop10ByLikesForAudio(): DbArticle[] {
  const byLikes = db.prepare(`
    SELECT a.* FROM articles a
    INNER JOIN (
      SELECT article_id AS aid, COUNT(*) AS cnt FROM article_feedback
      WHERE liked = 1 AND article_id IS NOT NULL
      GROUP BY article_id
    ) t ON a.id = t.aid
    WHERE COALESCE(a.is_vocab_story, 0) = 0
      AND (a.simplified_content IS NOT NULL AND a.simplified_content != ''
           OR a.content IS NOT NULL AND a.content != '')
    ORDER BY t.cnt DESC
    LIMIT 10
  `).all() as DbArticle[];
  if (byLikes.length > 0) return byLikes;
  return getArticlesTop2PerSourceForAudio();
}

/** sourceKey for parent_id dedup: same story (original + translated) = one audio. */
function audioSourceKey(a: { id: string; parent_id?: string | null }): string {
  return a.parent_id || a.id;
}

/** Pool for audio generation: top 5 finance+tech + top 10 by likes, deduped by id and parent_id. */
export function getArticlesForAudioGeneration(): DbArticle[] {
  const financeTech = getArticlesTopFinanceTechForAudio(5);
  const byLikes = getArticlesTop10ByLikesForAudio();
  const seen = new Set<string>();
  const bySource = new Map<string, DbArticle>();
  const add = (a: DbArticle) => {
    const key = audioSourceKey(a);
    if (seen.has(a.id)) return;
    const existing = bySource.get(key);
    // Prefer article with simplified_content (easier to listen), else keep first
    if (!existing || (a.simplified_content && !existing.simplified_content)) {
      seen.add(a.id);
      if (existing) seen.delete(existing.id);
      bySource.set(key, a);
    }
  };
  for (const a of financeTech) add(a);
  for (const a of byLikes) add(a);
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
    ORDER BY created_at DESC, pub_date DESC
    LIMIT ?
  `).all(sinceStr, sinceStr, limit) as DbArticle[];
}

export function getSourceUrlByArticleId(articleId: string): string | undefined {
  const row = db.prepare('SELECT source_url FROM articles WHERE id = ?').get(articleId) as { source_url: string } | undefined;
  return row?.source_url;
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

export function getVocabStoriesForUser(userId: string, limit = 5): DbArticle[] {
  return db.prepare(`
    SELECT * FROM articles
    WHERE is_vocab_story = 1 AND vocab_story_user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit) as DbArticle[];
}

export function hasVocabStoryToday(userId: string): boolean {
  const today = new Date().toISOString().split('T')[0];
  const row = db.prepare(`
    SELECT 1 FROM articles
    WHERE is_vocab_story = 1 AND vocab_story_user_id = ? AND date(created_at) = ?
  `).get(userId, today);
  return !!row;
}

/** First user with >= minWords in last N days (for dev/testing) */
export function getFirstUserIdWithEnoughWords(days = 7, minWords = 3): string | undefined {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString();
  const row = db.prepare(`
    SELECT user_id FROM words
    WHERE archived = 0 AND date_added >= date(?)
    GROUP BY user_id
    HAVING COUNT(*) >= ?
    ORDER BY MAX(date_added) DESC
    LIMIT 1
  `).get(sinceStr, minWords) as { user_id: string } | undefined;
  return row?.user_id;
}

export function getVocabStoriesForRecommend(userId: string, excludeSourceUrls: Set<string>, limit = 2): DbArticle[] {
  const stories = getVocabStoriesForUser(userId, 20);
  return stories
    .filter((a) => !excludeSourceUrls.has(a.source_url))
    .slice(0, limit);
}

export function upsertArticleFeedbackWithArticleId(
  userId: string,
  articleKeyOrId: string,
  articleId: string | null,
  liked: boolean | null,
  hard: number | null
): void {
  const likedNum = liked === null ? null : (liked ? 1 : 0);
  const hardNum = hard;
  const existing = db.prepare(
    'SELECT id FROM article_feedback WHERE user_id = ? AND article_key = ?'
  ).get(userId, articleKeyOrId) as { id: string } | undefined;
  if (existing) {
    db.prepare('UPDATE article_feedback SET liked = ?, hard = ?, article_id = ? WHERE id = ?')
      .run(likedNum, hardNum, articleId, existing.id);
  } else {
    db.prepare(
      'INSERT INTO article_feedback (id, user_id, article_key, article_id, liked, hard) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), userId, articleKeyOrId, articleId, likedNum, hardNum);
  }
}

// --- Daily crawl reports ---
export function insertCrawlReport(result: {
  reportDate: string;
  ingested: number;
  skipped: number;
  errors: number;
  byCategory: Record<string, { ingested: number; skipped: number }>;
  durationMs: number;
}): void {
  const id = uuidv4();
  const byCategory = JSON.stringify(result.byCategory);
  db.prepare(`
    INSERT INTO daily_crawl_reports (id, report_date, ingested, skipped, errors, by_category, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    result.reportDate,
    result.ingested,
    result.skipped,
    result.errors,
    byCategory,
    result.durationMs
  );
}

export function getCrawlReports(limit = 30): Array<{
  id: string;
  report_date: string;
  ingested: number;
  skipped: number;
  errors: number;
  by_category: string;
  duration_ms: number;
  created_at: string;
}> {
  return db.prepare(`
    SELECT * FROM daily_crawl_reports ORDER BY report_date DESC LIMIT ?
  `).all(limit) as any[];
}

// --- Metrics (monitoring) ---
const METRIC_COLUMNS = [
  'define_requests',
  'article_content_requests',
  'recommend_requests',
  'article_reads',
  'sync_requests',
  'weekly_test_requests',
  'unique_users',
] as const;

export type MetricType = typeof METRIC_COLUMNS[number];

const _updStmts: Record<string, ReturnType<typeof db.prepare>> = {};
const _insStmt = db.prepare(
  `INSERT OR IGNORE INTO metrics_daily (date, define_requests, article_content_requests, recommend_requests, article_reads, sync_requests, weekly_test_requests, unique_users, created_at, updated_at) VALUES (?, 0, 0, 0, 0, 0, 0, 0, ?, ?)`
);

function getUpdStmt(col: string): ReturnType<typeof db.prepare> {
  if (!_updStmts[col]) {
    _updStmts[col] = db.prepare(
      `UPDATE metrics_daily SET ${col} = ${col} + ?, updated_at = ? WHERE date = ?`
    );
  }
  return _updStmts[col];
}

export function incrementMetric(date: string, metric: MetricType, delta = 1): void {
  if (!METRIC_COLUMNS.includes(metric)) return;
  const now = new Date().toISOString();
  _insStmt.run(date, now, now);
  (getUpdStmt(metric) as { run: (...args: unknown[]) => unknown }).run(delta, now, date);
}

export function getMetricsForDate(date: string): Record<string, number> | null {
  const row = db.prepare('SELECT * FROM metrics_daily WHERE date = ?').get(date) as any;
  if (!row) return null;
  const out: Record<string, number> = {};
  for (const c of METRIC_COLUMNS) {
    out[c] = row[c] ?? 0;
  }
  return out;
}

export function getMetricsRange(startDate: string, endDate: string): Array<Record<string, unknown>> {
  const rows = db.prepare(`
    SELECT * FROM metrics_daily WHERE date >= ? AND date <= ? ORDER BY date DESC
  `).all(startDate, endDate) as any[];
  return rows;
}

// --- Recommendation cache ---

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

export function getUserTopArticles(userId: string, limit = 100): Array<{ article_id: string; total_score: number; interest_score: number; difficulty_score: number; interest_reason: string; difficulty_reason: string; recommendation_reason: string }> {
  return db.prepare(`
    SELECT article_id, total_score, interest_score, difficulty_score,
           interest_reason, difficulty_reason, recommendation_reason
    FROM user_top_articles
    WHERE user_id = ?
    ORDER BY total_score DESC
    LIMIT ?
  `).all(userId, limit) as any[];
}

export function upsertUserTopArticle(userId: string, articleId: string, scores: { totalScore: number; interestScore: number; difficultyScore: number; interestReason?: string; difficultyReason?: string; recommendationReason?: string }): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_top_articles (user_id, article_id, total_score, interest_score, difficulty_score, interest_reason, difficulty_reason, recommendation_reason, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, article_id) DO UPDATE SET
      total_score = excluded.total_score, interest_score = excluded.interest_score, difficulty_score = excluded.difficulty_score,
      interest_reason = excluded.interest_reason, difficulty_reason = excluded.difficulty_reason,
      recommendation_reason = excluded.recommendation_reason, updated_at = excluded.updated_at
  `).run(userId, articleId, scores.totalScore, scores.interestScore, scores.difficultyScore,
    scores.interestReason || '', scores.difficultyReason || '', scores.recommendationReason || 'Interest: 50. Difficulty: 50. Total: 50 (0.4×interest + 0.6×difficulty)', now);
}

export function pruneUserTopArticles(userId: string, keepTop = 100): void {
  const rows = db.prepare(`
    SELECT article_id FROM user_top_articles WHERE user_id = ?
    ORDER BY total_score DESC
    LIMIT ?
  `).all(userId, keepTop) as { article_id: string }[];
  if (rows.length === 0) return;
  const keep = rows.map(r => r.article_id);
  const placeholders = keep.map(() => '?').join(',');
  db.prepare(`
    DELETE FROM user_top_articles WHERE user_id = ? AND article_id NOT IN (${placeholders})
  `).run(userId, ...keep);
}

export function getArticleIdsCreatedSince(dateStr: string): string[] {
  const rows = db.prepare(`
    SELECT id FROM articles
    WHERE date(created_at) >= ? AND COALESCE(is_vocab_story, 0) = 0
  `).all(dateStr) as { id: string }[];
  return rows.map(r => r.id);
}

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

export function getActiveUserIds(sinceDays = 14): string[] {
  const fromSync = db.prepare('SELECT DISTINCT user_id FROM words').all() as { user_id: string }[];
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);
  const sinceStr = since.toISOString().split('T')[0];
  const fromFeedback = db.prepare('SELECT DISTINCT user_id FROM article_feedback WHERE date(created_at) >= ?').all(sinceStr) as { user_id: string }[];
  const ids = new Set<string>([...fromSync.map(r => r.user_id), ...fromFeedback.map(r => r.user_id)]);
  return [...ids];
}

export function getUserTopArticlesWithArticle(userId: string, limit = 100): Array<{ article: DbArticle; total_score: number; interest_score: number; difficulty_score: number; interest_reason: string; difficulty_reason: string; recommendation_reason: string }> {
  const rows = db.prepare(`
    SELECT u.article_id, u.total_score, u.interest_score, u.difficulty_score,
           u.interest_reason, u.difficulty_reason, u.recommendation_reason
    FROM user_top_articles u
    JOIN articles a ON a.id = u.article_id
    WHERE u.user_id = ?
    ORDER BY u.total_score DESC
    LIMIT ?
  `).all(userId, limit * 2) as any[];

  const result: Array<{ article: DbArticle; total_score: number; interest_score: number; difficulty_score: number; interest_reason: string; difficulty_reason: string; recommendation_reason: string }> = [];
  for (const r of rows) {
    const article = getArticleById(r.article_id);
    if (!article) continue;
    if (article.is_vocab_story && article.vocab_story_user_id !== userId) continue; // Never show another user's vocab story
    result.push({
      article,
      total_score: r.total_score,
      interest_score: r.interest_score,
      difficulty_score: r.difficulty_score,
      interest_reason: r.interest_reason || '',
      difficulty_reason: r.difficulty_reason || '',
      recommendation_reason: r.recommendation_reason || 'Interest: 50. Difficulty: 50. Total: 50 (0.4×interest + 0.6×difficulty)',
    });
  }
  return result;
}

export default db;
