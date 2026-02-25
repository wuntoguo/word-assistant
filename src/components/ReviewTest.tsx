import { useState, useMemo, useEffect, useRef } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { wordsAtom, todayReviewWordsAtom, allDueReviewWordsAtom, customPracticeWordsAtom, recordActivity } from '../store';
import { getNextReviewDate, getTodayString } from '../utils';
import { getDistractorWords } from '../commonWords';
import { checkWordHasImage } from '../imageCheck';
import { Word } from '../types';
import WordCard from './WordCard';
import PhonemeBreakdown from './PhonemeBreakdown';
import WordImage from './WordImage';

interface ReviewTestProps {
  onReviewComplete?: () => void;
}

const STAGE_LABELS = ['New', 'Learning', 'Familiar', 'Good', 'Strong', 'Mastered'];
const STAGE_INTERVALS = ['1 day', '2 days', '4 days', '7 days', '15 days', '30 days'];

const THINK_SECONDS = 3;

type ReviewMode = 'word' | 'audio' | 'definition' | 'image';

function pickMode(word: Word, hasImage: boolean): ReviewMode {
  const pool: ReviewMode[] = ['word', 'definition'];
  if (hasImage) pool.push('image');
  if (word.audioUrl) pool.push('audio');
  return pool[Math.floor(Math.random() * pool.length)];
}

const PRACTICE_SIZE = 10;

function pickWordsForPractice(allWords: Word[], excludeIds: Set<string>): Word[] {
  const active = allWords
    .filter((w) => !w.archived && !excludeIds.has(w.id))
    .sort((a, b) => {
      if (a.memoryStage !== b.memoryStage) return a.memoryStage - b.memoryStage;
      return a.nextReviewDate.localeCompare(b.nextReviewDate);
    });
  return active.slice(0, PRACTICE_SIZE).sort(() => Math.random() - 0.5);
}

function getWordChoiceOptions(correctWord: Word, allSessionWords: Word[], allWords: Word[], count: number = 4): string[] {
  const exclude = new Set([correctWord.word.toLowerCase()]);
  const fromUser: string[] = [
    ...allSessionWords.filter((w) => w.word.toLowerCase() !== correctWord.word.toLowerCase()).map((w) => w.word),
    ...allWords.filter((w) => w.word.toLowerCase() !== correctWord.word.toLowerCase()).map((w) => w.word),
  ];
  const userPool = [...new Set(fromUser)].sort(() => Math.random() - 0.5);
  const distractors: string[] = [];
  for (const w of userPool) {
    if (distractors.length >= count - 1) break;
    const lower = w.toLowerCase();
    if (!exclude.has(lower)) {
      distractors.push(w);
      exclude.add(lower);
    }
  }
  const needed = count - 1 - distractors.length;
  if (needed > 0) {
    const fromCommon = getDistractorWords(correctWord.word, exclude, needed);
    distractors.push(...fromCommon);
  }
  return [correctWord.word, ...distractors].sort(() => Math.random() - 0.5);
}

function getDefinitionChoiceOptions(correctWord: Word, allSessionWords: Word[], allWords: Word[], count: number = 4): string[] {
  const correctDef = correctWord.definitions?.[0] ?? correctWord.word;
  const others = [...allSessionWords, ...allWords]
    .filter((w) => w.id !== correctWord.id && w.definitions?.length)
    .flatMap((w) => w.definitions);
  const unique = [...new Set(others)].filter((d) => d !== correctDef && d.length > 10);
  const shuffled = unique.sort(() => Math.random() - 0.5);
  const distractors = shuffled.slice(0, count - 1);
  return [correctDef, ...distractors].sort(() => Math.random() - 0.5);
}

function isChoiceCorrect(selected: string, word: Word, mode: ReviewMode): boolean {
  if (mode === 'word') {
    return word.definitions?.some((d) => d === selected) ?? false;
  }
  return selected.toLowerCase() === word.word.toLowerCase();
}

export default function ReviewTest({ onReviewComplete }: ReviewTestProps) {
  const todayBatch = useAtomValue(todayReviewWordsAtom);
  const [customPracticeWords, setCustomPracticeWords] = useAtom(customPracticeWordsAtom);
  const allDueWords = useAtomValue(allDueReviewWordsAtom);
  const [allWords, setAllWords] = useAtom(wordsAtom);

  const practiceSource = customPracticeWords ?? todayBatch;
  const activeWordsForPractice = useMemo(() => allWords.filter((w) => !w.archived), [allWords]);
  const [started, setStarted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [results, setResults] = useState<{ wordId: string; remembered: boolean }[]>([]);
  const [isFinished, setIsFinished] = useState(false);
  const [expandedWordId, setExpandedWordId] = useState<string | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [sessionCards, setSessionCards] = useState<Array<{ word: Word; mode: ReviewMode }>>([]);
  const [thinkSecondsLeft, setThinkSecondsLeft] = useState(THINK_SECONDS);
  const [thinkComplete, setThinkComplete] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const thinkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pre-start: show live preview (from custom practice or daily batch)
  const previewWords = useMemo(() => {
    return [...practiceSource].sort(() => Math.random() - 0.5);
  }, [practiceSource]);

  // Once started, use the frozen session list; before start, use preview
  const shuffledWords = started ? sessionCards.map((c) => c.word) : previewWords;
  const shuffledCards = started ? sessionCards : previewWords.map((w) => ({ word: w, mode: 'word' as ReviewMode }));

  const currentCard = shuffledCards[currentIndex];
  const currentWord = currentCard?.word;
  const currentMode = currentCard?.mode ?? 'word';

  // Freeze options once per card so they don't change when re-rendering (e.g. replay audio)
  const frozenOptionsRef = useRef<{ cardKey: string; options: string[] } | null>(null);
  const choiceOptions = useMemo(() => {
    if (!currentWord || !thinkComplete) return [];
    const cardKey = `${currentIndex}-${currentWord.id}`;
    if (frozenOptionsRef.current?.cardKey === cardKey) {
      return frozenOptionsRef.current.options;
    }
    const options = currentMode === 'word'
      ? getDefinitionChoiceOptions(currentWord, shuffledWords, allWords, 4)
      : getWordChoiceOptions(currentWord, shuffledWords, allWords, 4);
    frozenOptionsRef.current = { cardKey, options };
    return options;
  }, [currentWord?.id, currentMode, currentIndex, thinkComplete, shuffledWords, allWords]);

  // Clear frozen options when moving to next card
  useEffect(() => {
    if (!thinkComplete) frozenOptionsRef.current = null;
  }, [currentIndex, thinkComplete]);

  // Auto-play audio once when in audio-first mode (per card)
  const audioAutoPlayedFor = useRef<string | null>(null);
  useEffect(() => {
    if (currentMode === 'audio' && currentWord?.audioUrl && !showAnswer && audioAutoPlayedFor.current !== currentWord.id) {
      audioAutoPlayedFor.current = currentWord.id;
      const audio = new Audio(currentWord.audioUrl);
      audio.play().catch(() => {});
    }
    if (showAnswer) audioAutoPlayedFor.current = null;
  }, [currentMode, currentWord?.id, currentWord?.audioUrl, showAnswer]);

  // Think-time countdown: when showAnswer is false, start countdown
  useEffect(() => {
    if (!currentWord || showAnswer) return;
    setThinkComplete(false);
    setThinkSecondsLeft(THINK_SECONDS);
    thinkTimerRef.current = setInterval(() => {
      setThinkSecondsLeft((prev) => {
        if (prev <= 1) {
          if (thinkTimerRef.current) clearInterval(thinkTimerRef.current);
          thinkTimerRef.current = null;
          setThinkComplete(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (thinkTimerRef.current) clearInterval(thinkTimerRef.current);
    };
  }, [currentIndex, showAnswer, currentWord]);
  const totalDue = allDueWords.length;
  const batchSize = shuffledWords.length;
  const remainingAfterBatch = totalDue - batchSize;

  const handleAnswer = (remembered: boolean) => {
    if (!currentWord) return;

    recordActivity(getTodayString(), 'reviews', 1);
    setResults((prev) => [...prev, { wordId: currentWord.id, remembered }]);

    setAllWords((prev) =>
      prev.map((w) => {
        if (w.id !== currentWord.id) return w;
        const newStage = remembered
          ? Math.min(w.memoryStage + 1, 5)
          : 0;
        return {
          ...w,
          memoryStage: newStage,
          nextReviewDate: getNextReviewDate(newStage),
          reviewCount: w.reviewCount + 1,
          updatedAt: new Date().toISOString(),
        };
      })
    );
    onReviewComplete?.();

    if (currentIndex + 1 >= shuffledWords.length) {
      setIsFinished(true);
    } else {
      setCurrentIndex((prev) => prev + 1);
      setShowAnswer(false);
      setThinkComplete(false);
      setSelectedChoice(null);
    }
  };

  const archiveWord = (wordId: string) => {
    setAllWords((prev) =>
      prev.map((w) =>
        w.id === wordId
          ? { ...w, archived: true, updatedAt: new Date().toISOString() }
          : w
      )
    );
    onReviewComplete?.();
  };

  const playAudio = async () => {
    if (!currentWord?.audioUrl || audioPlaying) return;
    setAudioPlaying(true);
    try {
      const audio = new Audio(currentWord.audioUrl);
      audio.onended = () => setAudioPlaying(false);
      audio.onerror = () => setAudioPlaying(false);
      await audio.play();
    } catch {
      setAudioPlaying(false);
    }
  };

  const resetReview = () => {
    setStarted(false);
    setCurrentIndex(0);
    setShowAnswer(false);
    setSelectedChoice(null);
    setResults([]);
    setIsFinished(false);
    setSessionCards([]);
    setThinkComplete(false);
    setCustomPracticeWords(null);
  };

  // === No words to review ===
  if (practiceSource.length === 0 && !isFinished) {
    const totalWords = allWords.length;
    const masteredCount = allWords.filter((w) => w.memoryStage >= 4).length;

    return (
      <div className="max-w-2xl mx-auto text-center">
        <div className="bg-white rounded-2xl shadow-md border border-slate-100 p-10">
          <div className="text-6xl mb-4">&#127881;</div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">All Caught Up!</h2>
          <p className="text-slate-500 mb-6">
            No words to review today. Keep looking up new words!
          </p>
          {totalWords > 0 && (
            <>
              <div className="grid grid-cols-2 gap-3 max-w-xs mx-auto mb-6">
                <div className="p-3 bg-indigo-50 rounded-xl text-center">
                  <div className="text-xl font-bold text-indigo-600">{totalWords}</div>
                  <div className="text-xs text-indigo-500">Total Words</div>
                </div>
                <div className="p-3 bg-emerald-50 rounded-xl text-center">
                  <div className="text-xl font-bold text-emerald-600">{masteredCount}</div>
                  <div className="text-xs text-emerald-500">Mastered</div>
                </div>
              </div>
              {activeWordsForPractice.length >= 2 && (
                <button
                  onClick={async () => {
                    setPreparing(true);
                    try {
                      const picked = pickWordsForPractice(allWords, new Set());
                      if (picked.length < 2) return;
                      const imageStatus = await Promise.all(picked.map((w) => checkWordHasImage(w.word)));
                      const cards = picked.map((w, i) => ({ word: w, mode: pickMode(w, imageStatus[i] ?? false) }));
                      setSessionCards(cards);
                      setCustomPracticeWords(picked);
                      setCurrentIndex(0);
                      setShowAnswer(false);
                      setSelectedChoice(null);
                      setResults([]);
                      setIsFinished(false);
                      setThinkComplete(false);
                      setStarted(true);
                    } finally {
                      setPreparing(false);
                    }
                  }}
                  disabled={preparing}
                  className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-70"
                >
                  {preparing ? 'Preparing...' : `Practice ${PRACTICE_SIZE} words`}
                </button>
              )}
            </>
          )}
        </div>

        {/* Spaced repetition explainer */}
        <div className="mt-6 bg-white rounded-2xl shadow-sm border border-slate-100 p-6 text-left">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">How Review Works</h3>
          <div className="space-y-2 text-sm text-slate-600">
            <p>Words are scheduled for review based on the <strong>Ebbinghaus memory curve</strong>:</p>
            <div className="grid grid-cols-3 gap-2 mt-3">
              {STAGE_LABELS.map((label, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-indigo-400" style={{ opacity: 0.3 + i * 0.14 }} />
                  <span>{label}: {STAGE_INTERVALS[i]}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-slate-400">Each day, up to 5 words are selected for review, prioritizing the weakest and most overdue words.</p>
          </div>
        </div>
      </div>
    );
  }

  // === Review finished ===
  if (isFinished) {
    const correctCount = results.filter((r) => r.remembered).length;
    const total = results.length;
    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    return (
      <div className="max-w-2xl mx-auto text-center">
        <div className="bg-white rounded-2xl shadow-md border border-slate-100 p-10">
          <div className="text-6xl mb-4">
            {percentage >= 80 ? '\u{1F31F}' : percentage >= 50 ? '\u{1F44D}' : '\u{1F4AA}'}
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Review Complete!</h2>
          <div className="mb-6">
            <div className="text-5xl font-bold text-indigo-600 mb-1">{percentage}%</div>
            <p className="text-slate-500">{correctCount} out of {total} words remembered</p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6 max-w-xs mx-auto">
            <div className="p-4 bg-emerald-50 rounded-xl">
              <div className="text-2xl font-bold text-emerald-600">{correctCount}</div>
              <div className="text-sm text-emerald-600">Remembered</div>
            </div>
            <div className="p-4 bg-red-50 rounded-xl">
              <div className="text-2xl font-bold text-red-500">{total - correctCount}</div>
              <div className="text-sm text-red-500">Forgot</div>
            </div>
          </div>

          {/* Next review info */}
          <div className="mb-6 text-sm text-slate-500">
            {correctCount > 0 && (
              <p>Remembered words will be reviewed at longer intervals.</p>
            )}
            {total - correctCount > 0 && (
              <p>Forgotten words are reset and will appear again tomorrow.</p>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={resetReview}
              className="px-6 py-3 bg-slate-200 text-slate-700 rounded-xl font-semibold hover:bg-slate-300 transition-colors"
            >
              Done
            </button>
            {activeWordsForPractice.length >= 2 && (
              <button
                onClick={async () => {
                  setPreparing(true);
                  try {
                    const picked = pickWordsForPractice(allWords, new Set(results.map((r) => r.wordId)));
                    if (picked.length < 2) return;
                    const imageStatus = await Promise.all(picked.map((w) => checkWordHasImage(w.word)));
                    const cards = picked.map((w, i) => ({ word: w, mode: pickMode(w, imageStatus[i] ?? false) }));
                    setSessionCards(cards);
                    setCustomPracticeWords(picked);
                    setCurrentIndex(0);
                    setShowAnswer(false);
                    setSelectedChoice(null);
                    setResults([]);
                    setIsFinished(false);
                    setThinkComplete(false);
                    setStarted(true);
                  } finally {
                    setPreparing(false);
                  }
                }}
                disabled={preparing}
                className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-70"
              >
                {preparing ? 'Preparing...' : `Practice ${PRACTICE_SIZE} more words`}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // === Pre-start: show today's review summary ===
  if (!started) {
    return (
      <div className="max-w-2xl mx-auto text-center">
        <div className="bg-white rounded-2xl shadow-md border border-slate-100 p-10">
          <div className="text-6xl mb-4">&#128218;</div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">
            {customPracticeWords ? 'Practice' : 'Daily Review'}
          </h1>
          <p className="text-slate-500 mb-6">
            {customPracticeWords ? 'Test yourself on selected words' : 'Time to strengthen your memory!'}
          </p>

          <div className="bg-indigo-50 rounded-xl p-6 mb-6">
            <div className="text-4xl font-bold text-indigo-600 mb-1">{batchSize}</div>
            <div className="text-sm text-indigo-500">words to review now</div>
            {!customPracticeWords && remainingAfterBatch > 0 && (
              <div className="text-xs text-slate-400 mt-2">
                +{remainingAfterBatch} more due &mdash; they'll appear in future sessions
              </div>
            )}
          </div>

          {/* Preview the words - clickable to expand details */}
          <div className="flex flex-wrap justify-center gap-2 mb-6">
            {shuffledWords.map((w) => (
              <button
                key={w.id}
                onClick={() => setExpandedWordId(expandedWordId === w.id ? null : w.id)}
                className={`px-3 py-1 rounded-full text-sm transition-colors ${
                  expandedWordId === w.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-indigo-100 hover:text-indigo-700'
                }`}
              >
                {w.word}
              </button>
            ))}
          </div>

          {/* Expanded word detail */}
          {expandedWordId && (
            <div className="mb-6 text-left">
              {shuffledWords
                .filter((w) => w.id === expandedWordId)
                .map((w) => (
                  <WordCard
                    key={w.id}
                    word={w}
                    footer={
                      <div className="pt-3 border-t border-slate-100">
                        <button
                          onClick={() => { archiveWord(w.id); setExpandedWordId(null); }}
                          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-red-500 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                          </svg>
                          Skip this word (not useful for me)
                        </button>
                      </div>
                    }
                  />
                ))}
            </div>
          )}

          <button
            onClick={async () => {
              setPreparing(true);
              try {
                const words = [...previewWords].sort(() => Math.random() - 0.5);
                const imageStatus = await Promise.all(words.map((w) => checkWordHasImage(w.word)));
                const cards = words.map((w, i) => ({ word: w, mode: pickMode(w, imageStatus[i] ?? false) }));
                setSessionCards(cards);
                setCurrentIndex(0);
                setShowAnswer(false);
                setSelectedChoice(null);
                setResults([]);
                setThinkComplete(false);
                setStarted(true);
              } finally {
                setPreparing(false);
              }
            }}
            disabled={preparing}
            className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors text-lg disabled:opacity-70"
          >
            {preparing ? 'Preparing...' : 'Start Review'}
          </button>
        </div>
      </div>
    );
  }

  // Safety: if currentWord is somehow undefined, finish
  if (!currentWord) {
    if (!isFinished) setIsFinished(true);
    return null;
  }

  // Mode-specific prompt labels
  const modeLabels: Record<ReviewMode, string> = {
    word: 'Recall the meaning of this word in your mind',
    audio: 'Listen and recall the meaning',
    definition: 'Guess the word from the definition',
    image: 'What word does this image represent?',
  };

  // === Active review (flashcard) ===
  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">
          {customPracticeWords ? 'Practice' : 'Daily Review'}
        </h1>
        <p className="text-slate-400 text-sm">{modeLabels[currentMode]}</p>
      </div>

      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex justify-between text-sm text-slate-500 mb-1">
          <span>Progress</span>
          <span>{currentIndex + 1} / {shuffledWords.length}</span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2">
          <div
            className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${((currentIndex + 1) / shuffledWords.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Flashcard */}
      <div className="bg-white rounded-2xl shadow-md border border-slate-100 overflow-hidden">
        <div className="p-8 text-center bg-gradient-to-r from-indigo-500 to-purple-500 text-white">
          {/* Prompt: what to show before reveal */}
          {!showAnswer ? (
            currentMode === 'word' ? (
              <h2 className="text-4xl font-bold mb-2">{currentWord.word}</h2>
            ) : currentMode === 'audio' ? (
              <div className="py-4">
                <p className="text-indigo-100 mb-4">Listen to the pronunciation</p>
                {currentWord.audioUrl && (
                  <button
                    onClick={playAudio}
                    className={`inline-flex items-center gap-2 px-6 py-4 rounded-full text-lg transition-colors ${
                      audioPlaying ? 'bg-white/40 animate-pulse' : 'bg-white/20 hover:bg-white/30'
                    }`}
                  >
                    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                    </svg>
                    <span className="font-semibold">{audioPlaying ? 'Playing...' : 'Play'}</span>
                  </button>
                )}
              </div>
            ) : currentMode === 'definition' ? (
              <div className="text-left py-2">
                <p className="text-indigo-100 text-sm mb-2">Definition:</p>
                <ol className="space-y-1 text-indigo-50">
                  {currentWord.definitions.slice(0, 3).map((d, i) => (
                    <li key={i} className="text-sm">{i + 1}. {d}</li>
                  ))}
                </ol>
              </div>
            ) : (
              <div className="py-4">
                <p className="text-indigo-100 mb-4">Look at the image and guess the word</p>
                <div className="bg-white/10 rounded-xl p-4 min-h-[140px] flex flex-col items-center justify-center gap-2">
                  <WordImage word={currentWord.word} />
                  <p className="text-indigo-200/80 text-xs">(No image? Recall from memory)</p>
                </div>
              </div>
            )
          ) : (
            <>
              <h2 className="text-4xl font-bold mb-2">{currentWord.word}</h2>
              <div className="mt-2">
                <p className="text-indigo-100 text-lg font-mono">{currentWord.phonetic}</p>
                {currentWord.audioUrl && (
                  <button
                    onClick={playAudio}
                    className={`mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-full transition-colors ${
                      audioPlaying ? 'bg-white/40 animate-pulse' : 'bg-white/20 hover:bg-white/30'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                    </svg>
                    <span className="text-sm font-medium">{audioPlaying ? 'Playing...' : 'Play'}</span>
                  </button>
                )}
                {currentWord.phonetic && <PhonemeBreakdown phonetic={currentWord.phonetic} />}
              </div>
            </>
          )}
        </div>

        <div className="p-6">
          {!showAnswer ? (
            <div className="text-center py-8">
              {thinkComplete ? (
                choiceOptions.length >= 2 ? (
                  <>
                    <p className="text-slate-400 mb-6">Choose the correct answer:</p>
                    <div className={`grid gap-3 max-w-xl mx-auto ${currentMode === 'word' ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
                      {choiceOptions.map((opt) => (
                        <button
                          key={opt}
                          onClick={() => { setSelectedChoice(opt); setShowAnswer(true); }}
                          className={`px-6 py-3 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-indigo-100 hover:text-indigo-700 transition-colors text-left ${
                            currentMode === 'word' ? 'line-clamp-2' : ''
                          }`}
                          title={currentMode === 'word' && opt.length > 60 ? opt : undefined}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-slate-400 mb-6">Not enough words for choices. Compare with your recall:</p>
                    <button
                      onClick={() => setShowAnswer(true)}
                      className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors"
                    >
                      Show Answer
                    </button>
                  </>
                )
              ) : (
                <>
                  <p className="text-slate-400 mb-4">Recall in your mind&hellip;</p>
                  <p className="text-4xl font-bold text-indigo-500 tabular-nums">{thinkSecondsLeft}</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {selectedChoice !== null && (
                <div
                  className={`p-3 rounded-xl text-center font-medium ${
                    isChoiceCorrect(selectedChoice, currentWord, currentMode)
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-red-50 text-red-600'
                  }`}
                >
                  {isChoiceCorrect(selectedChoice, currentWord, currentMode)
                    ? 'Correct!'
                    : currentMode === 'word'
                      ? 'Wrong. The correct meaning is above.'
                      : `Wrong. The answer is "${currentWord.word}".`}
                </div>
              )}
              {currentWord.partOfSpeech && (
                <span className="inline-block px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-sm font-medium">
                  {currentWord.partOfSpeech}
                </span>
              )}
              <div>
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Definitions</h3>
                <ol className="space-y-1.5">
                  {currentWord.definitions.map((def, i) => (
                    <li key={i} className="flex gap-2 text-slate-700">
                      <span className="text-indigo-400 font-semibold">{i + 1}.</span>
                      {def}
                    </li>
                  ))}
                </ol>
              </div>

              {currentWord.examples.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Examples</h3>
                  {currentWord.examples.map((ex, i) => (
                    <p key={i} className="text-slate-600 italic border-l-2 border-indigo-300 pl-3 mb-1">
                      &ldquo;{ex}&rdquo;
                    </p>
                  ))}
                </div>
              )}

              <div className="flex gap-4 pt-4">
                <button
                  onClick={() => handleAnswer(false)}
                  className="flex-1 py-3 bg-red-50 text-red-600 rounded-xl font-semibold hover:bg-red-100 transition-colors border border-red-200"
                >
                  I Forgot
                </button>
                <button
                  onClick={() => handleAnswer(true)}
                  className="flex-1 py-3 bg-emerald-50 text-emerald-600 rounded-xl font-semibold hover:bg-emerald-100 transition-colors border border-emerald-200"
                >
                  I Remember!
                </button>
              </div>
              <div className="pt-2 text-center">
                <button
                  onClick={() => {
                    archiveWord(currentWord.id);
                    if (currentIndex + 1 >= shuffledWords.length) {
                      setIsFinished(true);
                    } else {
                      setCurrentIndex((prev) => prev + 1);
                      setShowAnswer(false);
                      setSelectedChoice(null);
                      setThinkComplete(false);
                    }
                  }}
                  className="text-xs text-slate-400 hover:text-red-500 transition-colors"
                >
                  Skip forever (not useful for me)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stage info */}
      {showAnswer && (
        <div className="mt-4 text-center text-sm text-slate-400">
          Stage: {STAGE_LABELS[currentWord.memoryStage]} ({currentWord.memoryStage}/5) &middot; Reviewed {currentWord.reviewCount} times
          {currentWord.memoryStage < 5 && (
            <span> &middot; Next interval if correct: {STAGE_INTERVALS[Math.min(currentWord.memoryStage + 1, 5)]}</span>
          )}
        </div>
      )}
    </div>
  );
}
