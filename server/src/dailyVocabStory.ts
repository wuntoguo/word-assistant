import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { getWordsFromLastNDays } from './repositories/wordRepo.js';
import { getActiveUserIds } from './repositories/userRepo.js';
import { getVocabStoryTodayCount, insertVocabStoryArticle } from './repositories/articleRepo.js';

const SYSTEM_PROMPT = `You are a creative English teacher writing short stories to help learners remember new vocabulary.

Given a list of English words (with optional definitions), write an engaging, memorable short story (200-400 words) that:
1. Naturally incorporates ALL the given words in context
2. Is fun and easy to follow—suitable for intermediate (B1-B2) learners
3. Uses each word correctly; the story should help reinforce the word's meaning
4. Has a clear beginning, middle, and end
5. Can be humorous, surprising, or heartwarming—avoid being boring
6. Write in clear, readable English—no slang or overly complex sentences

Output ONLY the story text, no title, no explanations.`;

async function generateStoryWithGPT(openai: OpenAI, words: { word: string; definitions?: string }[]): Promise<string> {
  const wordList = words
    .map((w) => (w.definitions ? `"${w.word}" (${w.definitions})` : w.word))
    .join(', ');
  const userContent = `Write a short story using these words naturally: ${wordList}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    max_tokens: 800,
  });
  return completion.choices[0]?.message?.content?.trim() || '';
}

function buildWordsForStory(words: ReturnType<typeof getWordsFromLastNDays>, variant = 0): { word: string; definitions?: string }[] {
  const wordsForStory = words.slice(0, 18).map((w) => {
    let def: string | undefined;
    try {
      const arr = JSON.parse(w.definitions) as string[];
      def = arr?.[0]?.slice(0, 80);
    } catch {
      //
    }
    return { word: w.word, definitions: def };
  });

  if (wordsForStory.length <= 12) return wordsForStory.slice(0, 12);

  const shift = (variant * 4) % wordsForStory.length;
  const rotated = [...wordsForStory.slice(shift), ...wordsForStory.slice(0, shift)];
  return rotated.slice(0, 12);
}

export async function generateVocabStoryForUser(userId: string): Promise<{
  ok: boolean;
  id?: string;
  title?: string;
  error?: string;
}> {
  return generateVocabStoryForUserWithWords(userId, buildWordsForStory(getWordsFromLastNDays(userId, 7), 0));
}

async function generateVocabStoryForUserWithWords(
  userId: string,
  wordsForStory: { word: string; definitions?: string }[]
): Promise<{
  ok: boolean;
  id?: string;
  title?: string;
  error?: string;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'OPENAI_API_KEY not configured' };
  }

  if (wordsForStory.length < 3) return { ok: false, error: `Need at least 3 words (got ${wordsForStory.length})` };

  try {
    const openai = new OpenAI({ apiKey });
    const storyText = await generateStoryWithGPT(openai, wordsForStory);

    if (!storyText) {
      return { ok: false, error: 'GPT returned empty story' };
    }

    const id = uuidv4();
    const sourceUrl = `feedlingo://vocab-story/${id}`;
    const keywords = wordsForStory.map((w) => w.word);
    const title = `Your Vocabulary Story: ${keywords.slice(0, 4).join(', ')}${keywords.length > 4 ? '...' : ''}`;

    insertVocabStoryArticle({
      id,
      source_url: sourceUrl,
      title,
      content: storyText,
      simplified_content: storyText,
      keywords,
      userId,
    });

    return { ok: true, id, title };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Story generation failed';
    console.error('[DailyVocabStory] Error for user', userId, msg);
    return { ok: false, error: msg };
  }
}

export async function runDailyVocabStoryGeneration(options?: { userId?: string }): Promise<{
  generated: number;
  skipped: number;
  errors: string[];
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { generated: 0, skipped: 0, errors: ['OPENAI_API_KEY not configured'] };
  }

  const userIds = options?.userId ? [options.userId] : getActiveUserIds(7);
  let generated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const userId of userIds) {
    const words = getWordsFromLastNDays(userId, 7);
    if (words.length < 3) {
      skipped++;
      continue;
    }
    const existingToday = getVocabStoryTodayCount(userId);
    const targetToday = words.length >= 8 ? 3 : 2;
    const need = Math.max(0, targetToday - existingToday);
    if (need === 0) {
      skipped++;
      continue;
    }

    for (let i = 0; i < need; i++) {
      const wordsForStory = buildWordsForStory(words, existingToday + i);
      const result = await generateVocabStoryForUserWithWords(userId, wordsForStory);
      if (result.ok) {
        generated++;
        console.log(`[DailyVocabStory] Generated for ${userId}: ${result.title}`);
      } else {
        errors.push(`${userId}: ${result.error}`);
      }
    }
  }

  return { generated, skipped, errors };
}
