import { Word } from './types';

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

export async function lookupWord(term: string): Promise<Omit<Word, 'id' | 'dateAdded' | 'nextReviewDate' | 'reviewCount' | 'memoryStage' | 'updatedAt'>> {
  const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term.trim().toLowerCase())}`);

  if (!response.ok) {
    throw new Error('Word not found. Please check the spelling and try again.');
  }

  const data: DictionaryEntry[] = await response.json();
  const entry = data[0];

  // Categorize phonetics by accent: US > UK > AU > other
  const usEntry = entry.phonetics.find((p) => p.audio?.includes('-us'));
  const ukEntry = entry.phonetics.find((p) => p.audio?.includes('-uk'));
  const auEntry = entry.phonetics.find((p) => p.audio?.includes('-au'));
  const anyWithAudio = entry.phonetics.find((p) => p.audio && p.audio.length > 0);
  const anyWithText = entry.phonetics.find((p) => p.text && p.text.length > 0);

  // Prefer US audio, fallback UK > AU > any
  const bestAudioEntry = usEntry || ukEntry || auEntry || anyWithAudio;
  const audioUrl = bestAudioEntry?.audio || '';

  // For IPA text: prefer US entry's text, then any available text
  const phonetic = usEntry?.text || anyWithText?.text || entry.phonetic || '';

  // Tag the accent of the audio source
  const audioAccent = usEntry?.audio ? 'US' as const
    : ukEntry?.audio ? 'UK' as const
    : auEntry?.audio ? 'AU' as const
    : '' as const;

  // Collect definitions and examples from all meanings
  const allDefinitions: string[] = [];
  const allExamples: string[] = [];
  let primaryPartOfSpeech = '';

  for (const meaning of entry.meanings) {
    if (!primaryPartOfSpeech) {
      primaryPartOfSpeech = meaning.partOfSpeech;
    }
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

  // If fewer than 2 examples, try to get more from secondary entries
  if (allExamples.length < 2 && data.length > 1) {
    for (let i = 1; i < data.length && allExamples.length < 4; i++) {
      for (const meaning of data[i].meanings) {
        for (const def of meaning.definitions) {
          if (def.example && allExamples.length < 4 && !allExamples.includes(def.example)) {
            allExamples.push(def.example);
          }
        }
      }
    }
  }

  return {
    word: entry.word,
    phonetic,
    audioUrl,
    audioAccent,
    partOfSpeech: primaryPartOfSpeech,
    definitions: allDefinitions,
    examples: allExamples,
  };
}
