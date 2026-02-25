import { Word, AudioAccent } from './types';

// Ebbinghaus-inspired spaced repetition intervals (in days)
const MEMORY_INTERVALS = [
  1,   // Stage 0 -> review after 1 day
  2,   // Stage 1 -> review after 2 days
  4,   // Stage 2 -> review after 4 days
  7,   // Stage 3 -> review after 7 days
  15,  // Stage 4 -> review after 15 days
  30,  // Stage 5 -> review after 30 days
];

export function getNextReviewDate(memoryStage: number): string {
  const days = MEMORY_INTERVALS[Math.min(memoryStage, MEMORY_INTERVALS.length - 1)];
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

export function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

export function getWeekRange(offsetWeeks: number = 0): { start: string; end: string; label: string } {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset + offsetWeeks * 7);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const format = (d: Date) => d.toISOString().split('T')[0];
  const formatDisplay = (d: Date) =>
    `${d.getMonth() + 1}/${d.getDate()}`;

  return {
    start: format(monday),
    end: format(sunday),
    label: `${formatDisplay(monday)} - ${formatDisplay(sunday)}`,
  };
}

export function getWordsInDateRange(words: Word[], start: string, end: string): Word[] {
  return words.filter((w) => w.dateAdded >= start && w.dateAdded <= end);
}

export function exportToCSV(words: Word[]): void {
  const headers = ['Word', 'Phonetic', 'Part of Speech', 'Definitions', 'Examples', 'Date Added', 'Memory Stage', 'Review Count'];
  const rows = words.map((w) => [
    w.word,
    w.phonetic,
    w.partOfSpeech,
    w.definitions.join('; '),
    w.examples.join('; '),
    w.dateAdded,
    w.memoryStage.toString(),
    w.reviewCount.toString(),
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')),
  ].join('\n');

  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `vocabulary-${getTodayString()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

interface DictionaryPhonetic {
  text?: string;
  audio?: string;
}

interface DictionaryDefinition {
  definition: string;
  example?: string;
}

interface DictionaryMeaning {
  partOfSpeech: string;
  definitions: DictionaryDefinition[];
}

interface DictionaryEntry {
  word: string;
  phonetic?: string;
  phonetics: DictionaryPhonetic[];
  meanings: DictionaryMeaning[];
}

interface MWFallbackResult {
  phonetic: string;
  audioUrl: string;
  partOfSpeech: string;
  definitions: string[];
  examples: string[];
}

async function fetchMWFallback(word: string): Promise<MWFallbackResult | null> {
  try {
    const res = await fetch(`/api/define/${encodeURIComponent(word)}`);
    if (!res.ok) return null;
    return await res.json() as MWFallbackResult;
  } catch {
    return null;
  }
}

async function fetchMWLearner(word: string): Promise<MWFallbackResult | null> {
  try {
    const res = await fetch(`/api/define-learner/${encodeURIComponent(word)}`);
    if (!res.ok) return null;
    return await res.json() as MWFallbackResult;
  } catch {
    return null;
  }
}

async function fetchMWIntermediate(word: string): Promise<MWFallbackResult | null> {
  try {
    const res = await fetch(`/api/define-intermediate/${encodeURIComponent(word)}`);
    if (!res.ok) return null;
    return await res.json() as MWFallbackResult;
  } catch {
    return null;
  }
}

async function fetchTatoebaSentences(word: string): Promise<string[]> {
  try {
    const res = await fetch(`/api/sentences/${encodeURIComponent(word)}`);
    if (!res.ok) return [];
    const { sentences } = await res.json() as { sentences: string[] };
    return sentences;
  } catch {
    return [];
  }
}

export async function lookupWord(term: string): Promise<Omit<Word, 'id' | 'dateAdded' | 'nextReviewDate' | 'reviewCount' | 'memoryStage' | 'updatedAt'>> {
  const normalized = term.trim().toLowerCase();

  // --- 1. Fetch FD and MW Learner's in parallel ---
  let fdResult: {
    word: string;
    phonetic: string;
    audioUrl: string;
    audioAccent: string;
    partOfSpeech: string;
    definitions: string[];
    examples: string[];
  } | null = null;

  const [fdData, learnerResult, intermediateResult] = await Promise.all([
    fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalized)}`)
      .then((r) => (r.ok ? r.json() as Promise<DictionaryEntry[]> : null))
      .catch(() => null),
    fetchMWLearner(normalized),
    fetchMWIntermediate(normalized),
  ]);

  if (fdData && Array.isArray(fdData) && fdData.length > 0) {
    const entry = fdData[0];
    const usEntry = entry.phonetics.find((p) => p.audio?.includes('-us'));
    const ukEntry = entry.phonetics.find((p) => p.audio?.includes('-uk'));
    const auEntry = entry.phonetics.find((p) => p.audio?.includes('-au'));
    const anyWithAudio = entry.phonetics.find((p) => p.audio && p.audio.length > 0);
    const anyWithText = entry.phonetics.find((p) => p.text && p.text.length > 0);

    const bestAudioEntry = usEntry || ukEntry || auEntry || anyWithAudio;
    const audioUrl = bestAudioEntry?.audio || '';
    const phonetic = usEntry?.text || anyWithText?.text || entry.phonetic || '';
    const audioAccent = usEntry?.audio ? 'US'
      : ukEntry?.audio ? 'UK'
      : auEntry?.audio ? 'AU'
      : '';

    const allDefinitions: string[] = [];
    const allExamples: string[] = [];
    let primaryPartOfSpeech = '';

    for (const meaning of entry.meanings) {
      if (!primaryPartOfSpeech) primaryPartOfSpeech = meaning.partOfSpeech;
      for (const def of meaning.definitions) {
        if (allDefinitions.length < 3) {
          const prefix = entry.meanings.length > 1 ? `(${meaning.partOfSpeech}) ` : '';
          allDefinitions.push(prefix + def.definition);
        }
        if (def.example && allExamples.length < 4) {
          allExamples.push(def.example);
        }
      }
    }

    if (allExamples.length < 2 && fdData.length > 1) {
      for (let i = 1; i < fdData.length && allExamples.length < 4; i++) {
        for (const meaning of fdData[i].meanings) {
          for (const def of meaning.definitions) {
            if (def.example && allExamples.length < 4 && !allExamples.includes(def.example)) {
              allExamples.push(def.example);
            }
          }
        }
      }
    }

    fdResult = {
      word: entry.word,
      phonetic,
      audioUrl,
      audioAccent,
      partOfSpeech: primaryPartOfSpeech,
      definitions: allDefinitions,
      examples: allExamples,
    };
  }

  const simpleDefSource = learnerResult?.definitions?.length ? learnerResult : intermediateResult?.definitions?.length ? intermediateResult : null;

  // --- 2. MW Collegiate fallback for missing audio/phonetic ---
  const needsMW = !fdResult || !fdResult.audioUrl || !fdResult.phonetic ||
    (fdResult.definitions.length === 0 && !simpleDefSource?.definitions?.length);
  const mwResult = needsMW ? await fetchMWFallback(normalized) : null;

  if (!fdResult && !simpleDefSource && !mwResult) {
    throw new Error('Word not found. Please check the spelling and try again.');
  }

  // --- 3. Merge: prefer Learner's definitions (simpler), else FD, else MW ---
  const word = fdResult?.word || normalized;
  const phonetic = fdResult?.phonetic || simpleDefSource?.phonetic || mwResult?.phonetic || '';
  const audioUrl = fdResult?.audioUrl || simpleDefSource?.audioUrl || mwResult?.audioUrl || '';
  const audioAccent: AudioAccent = fdResult?.audioUrl
    ? (fdResult.audioAccent as AudioAccent)
    : simpleDefSource?.audioUrl || mwResult?.audioUrl ? 'US' : '';
  const partOfSpeech = fdResult?.partOfSpeech || simpleDefSource?.partOfSpeech || mwResult?.partOfSpeech || '';

  // Prefer Learner's or Intermediate definitions (clearer, simpler than FD/Collegiate)
  const useSimpleDefs = !!simpleDefSource?.definitions?.length;
  let definitions = useSimpleDefs
    ? simpleDefSource!.definitions
    : fdResult?.definitions || mwResult?.definitions || [];

  let examples = useSimpleDefs ? (simpleDefSource?.examples || []) : (fdResult?.examples || []);
  for (const src of [fdResult?.examples, mwResult?.examples]) {
    if (!src || examples.length >= 4) continue;
    for (const ex of src) {
      if (examples.length < 4 && !examples.includes(ex)) examples.push(ex);
    }
  }

  // --- 4. Last resort for examples: Tatoeba corpus ---
  if (examples.length < 2) {
    const tatoeba = await fetchTatoebaSentences(word);
    for (const s of tatoeba) {
      if (examples.length < 4 && !examples.includes(s)) {
        examples.push(s);
      }
    }
  }

  return {
    word,
    phonetic,
    audioUrl,
    audioAccent,
    partOfSpeech,
    definitions,
    examples,
  };
}

/** Safe article date formatter. Returns "—" for invalid/unparseable dates. */
export function formatArticleDate(pubDate: string | null | undefined, options?: { withTime?: boolean }): string {
  if (!pubDate || typeof pubDate !== 'string') return '—';
  const d = new Date(pubDate);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(options?.withTime && { hour: '2-digit', minute: '2-digit' }),
  });
}
