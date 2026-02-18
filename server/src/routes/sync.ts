import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware } from './auth.js';
import { getWordsByUser, getWordByUserAndWord, upsertWord, DbWord } from '../db.js';

export const syncRouter = Router();

// Ebbinghaus spaced repetition intervals (must match frontend)
const MEMORY_INTERVALS = [1, 2, 4, 7, 15, 30];

function recalculateNextReviewDate(memoryStage: number, fromDate?: string): string {
  const days = MEMORY_INTERVALS[Math.min(memoryStage, MEMORY_INTERVALS.length - 1)];
  const base = fromDate ? new Date(fromDate) : new Date();
  base.setDate(base.getDate() + days);
  return base.toISOString().split('T')[0];
}

interface ClientWord {
  id: string;
  word: string;
  phonetic: string;
  audioUrl: string;
  partOfSpeech: string;
  definitions: string[];
  examples: string[];
  dateAdded: string;
  nextReviewDate: string;
  reviewCount: number;
  memoryStage: number;
  updatedAt: string;
}

function clientToDb(cw: ClientWord, userId: string): DbWord {
  return {
    id: cw.id,
    user_id: userId,
    word: cw.word.toLowerCase(),
    phonetic: cw.phonetic,
    audio_url: cw.audioUrl,
    part_of_speech: cw.partOfSpeech,
    definitions: JSON.stringify(cw.definitions),
    examples: JSON.stringify(cw.examples),
    date_added: cw.dateAdded,
    next_review_date: cw.nextReviewDate,
    review_count: cw.reviewCount,
    memory_stage: cw.memoryStage,
    updated_at: cw.updatedAt || new Date().toISOString(),
  };
}

function dbToClient(dw: DbWord): ClientWord {
  return {
    id: dw.id,
    word: dw.word,
    phonetic: dw.phonetic,
    audioUrl: dw.audio_url,
    partOfSpeech: dw.part_of_speech,
    definitions: JSON.parse(dw.definitions),
    examples: JSON.parse(dw.examples),
    dateAdded: dw.date_added,
    nextReviewDate: dw.next_review_date,
    reviewCount: dw.review_count,
    memoryStage: dw.memory_stage,
    updatedAt: dw.updated_at,
  };
}

function mergeWord(clientWord: DbWord, serverWord: DbWord): DbWord {
  const mergedStage = Math.max(clientWord.memory_stage, serverWord.memory_stage);
  const mergedReviewCount = Math.max(clientWord.review_count, serverWord.review_count);

  // Richer data wins for definitions/examples
  const clientDefs: string[] = JSON.parse(clientWord.definitions);
  const serverDefs: string[] = JSON.parse(serverWord.definitions);
  const clientExamples: string[] = JSON.parse(clientWord.examples);
  const serverExamples: string[] = JSON.parse(serverWord.examples);

  return {
    id: serverWord.id, // keep server's ID
    user_id: serverWord.user_id,
    word: serverWord.word,
    phonetic: clientWord.phonetic || serverWord.phonetic,
    audio_url: clientWord.audio_url || serverWord.audio_url,
    part_of_speech: clientWord.part_of_speech || serverWord.part_of_speech,
    definitions: JSON.stringify(clientDefs.length >= serverDefs.length ? clientDefs : serverDefs),
    examples: JSON.stringify(clientExamples.length >= serverExamples.length ? clientExamples : serverExamples),
    date_added: clientWord.date_added < serverWord.date_added ? clientWord.date_added : serverWord.date_added,
    next_review_date: recalculateNextReviewDate(mergedStage),
    review_count: mergedReviewCount,
    memory_stage: mergedStage,
    updated_at: new Date().toISOString(),
  };
}

// POST /api/sync
syncRouter.post('/sync', authMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const { lastSyncedAt, clientWords } = req.body as {
    lastSyncedAt: string | null;
    clientWords: ClientWord[];
  };

  const now = new Date().toISOString();

  // Process client words: merge each with server state
  const processedClientWordNames = new Set<string>();

  for (const cw of clientWords || []) {
    const dbClientWord = clientToDb(cw, userId);
    const existingServer = getWordByUserAndWord(userId, dbClientWord.word);

    if (!existingServer) {
      // New word from client -> save directly
      upsertWord(dbClientWord);
    } else {
      // Merge client and server versions
      const merged = mergeWord(dbClientWord, existingServer);
      upsertWord(merged);
    }
    processedClientWordNames.add(dbClientWord.word);
  }

  // Get all server words updated since lastSyncedAt (to send back to client)
  // Include words we just merged (they have fresh updated_at)
  const serverChanges = lastSyncedAt
    ? getWordsByUser(userId, lastSyncedAt)
    : getWordsByUser(userId);

  // Convert to client format
  const serverWords = serverChanges.map(dbToClient);

  res.json({
    serverWords,
    syncedAt: now,
  });
});

// GET /api/words - get all words (fallback for full sync)
syncRouter.get('/words', authMiddleware, (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const words = getWordsByUser(userId);
  res.json({ words: words.map(dbToClient) });
});
