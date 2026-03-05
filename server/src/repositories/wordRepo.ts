import db from '../db/client.js';

export interface DbWord {
  id: string;
  user_id: string;
  word: string;
  phonetic: string;
  audio_url: string;
  part_of_speech: string;
  definitions: string;
  examples: string;
  date_added: string;
  next_review_date: string;
  review_count: number;
  memory_stage: number;
  archived: number;
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
