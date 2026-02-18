import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

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
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, word)
  );

  CREATE INDEX IF NOT EXISTS idx_words_user_id ON words(user_id);
  CREATE INDEX IF NOT EXISTS idx_words_updated_at ON words(user_id, updated_at);
`);

// --- User queries ---

export interface DbUser {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  provider: string;
  provider_id: string;
  created_at: string;
}

export function findUserByProvider(provider: string, providerId: string): DbUser | undefined {
  return db.prepare(
    'SELECT * FROM users WHERE provider = ? AND provider_id = ?'
  ).get(provider, providerId) as DbUser | undefined;
}

export function createUser(user: Omit<DbUser, 'created_at'>): DbUser {
  db.prepare(
    'INSERT INTO users (id, email, name, avatar_url, provider, provider_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(user.id, user.email, user.name, user.avatar_url, user.provider, user.provider_id);
  return findUserByProvider(user.provider, user.provider_id)!;
}

export function findUserById(id: string): DbUser | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUser | undefined;
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

export function getWordByUserAndWord(userId: string, word: string): DbWord | undefined {
  return db.prepare(
    'SELECT * FROM words WHERE user_id = ? AND word = ?'
  ).get(userId, word) as DbWord | undefined;
}

export function upsertWord(word: DbWord): void {
  db.prepare(`
    INSERT INTO words (id, user_id, word, phonetic, audio_url, part_of_speech, definitions, examples, date_added, next_review_date, review_count, memory_stage, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      updated_at = excluded.updated_at
  `).run(
    word.id, word.user_id, word.word, word.phonetic, word.audio_url,
    word.part_of_speech, word.definitions, word.examples,
    word.date_added, word.next_review_date, word.review_count,
    word.memory_stage, word.updated_at
  );
}

export default db;
