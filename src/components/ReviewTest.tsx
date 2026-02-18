import { useState, useMemo } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { wordsAtom, todayReviewWordsAtom, allDueReviewWordsAtom } from '../store';
import { getNextReviewDate } from '../utils';
import WordCard from './WordCard';

interface ReviewTestProps {
  onReviewComplete?: () => void;
}

const STAGE_LABELS = ['New', 'Learning', 'Familiar', 'Good', 'Strong', 'Mastered'];
const STAGE_INTERVALS = ['1 day', '2 days', '4 days', '7 days', '15 days', '30 days'];

export default function ReviewTest({ onReviewComplete }: ReviewTestProps) {
  const todayBatch = useAtomValue(todayReviewWordsAtom);
  const allDueWords = useAtomValue(allDueReviewWordsAtom);
  const [allWords, setAllWords] = useAtom(wordsAtom);
  const [started, setStarted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [results, setResults] = useState<{ wordId: string; remembered: boolean }[]>([]);
  const [isFinished, setIsFinished] = useState(false);
  const [expandedWordId, setExpandedWordId] = useState<string | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);

  const shuffledWords = useMemo(() => {
    return [...todayBatch].sort(() => Math.random() - 0.5);
  }, [todayBatch]);

  const currentWord = shuffledWords[currentIndex];
  const totalDue = allDueWords.length;
  const batchSize = shuffledWords.length;
  const remainingAfterBatch = totalDue - batchSize;

  const handleAnswer = (remembered: boolean) => {
    if (!currentWord) return;

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
    setResults([]);
    setIsFinished(false);
  };

  // === No words to review ===
  if (totalDue === 0 && !isFinished) {
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
            <div className="grid grid-cols-2 gap-3 max-w-xs mx-auto">
              <div className="p-3 bg-indigo-50 rounded-xl text-center">
                <div className="text-xl font-bold text-indigo-600">{totalWords}</div>
                <div className="text-xs text-indigo-500">Total Words</div>
              </div>
              <div className="p-3 bg-emerald-50 rounded-xl text-center">
                <div className="text-xl font-bold text-emerald-600">{masteredCount}</div>
                <div className="text-xs text-emerald-500">Mastered</div>
              </div>
            </div>
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

          <button
            onClick={resetReview}
            className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors"
          >
            Done
          </button>
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
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Daily Review</h1>
          <p className="text-slate-500 mb-6">
            Time to strengthen your memory!
          </p>

          <div className="bg-indigo-50 rounded-xl p-6 mb-6">
            <div className="text-4xl font-bold text-indigo-600 mb-1">{batchSize}</div>
            <div className="text-sm text-indigo-500">words to review now</div>
            {remainingAfterBatch > 0 && (
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
            onClick={() => setStarted(true)}
            className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors text-lg"
          >
            Start Review
          </button>
        </div>
      </div>
    );
  }

  // === Active review (flashcard) ===
  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Daily Review</h1>
        <p className="text-slate-400 text-sm">Recall the meaning, then check your answer</p>
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
          <h2 className="text-4xl font-bold mb-2">{currentWord.word}</h2>
          {showAnswer && (
            <div className="mt-2">
              <p className="text-indigo-100 text-lg font-mono">{currentWord.phonetic}</p>
              {currentWord.audioUrl && (
                <button
                  onClick={playAudio}
                  className={`mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-full transition-colors ${
                    audioPlaying
                      ? 'bg-white/40 animate-pulse'
                      : 'bg-white/20 hover:bg-white/30'
                  }`}
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                  </svg>
                  <span className="text-sm font-medium">{audioPlaying ? 'Playing...' : 'Play'}</span>
                </button>
              )}
            </div>
          )}
        </div>

        <div className="p-6">
          {!showAnswer ? (
            <div className="text-center py-8">
              <p className="text-slate-400 mb-6">Do you remember the meaning of this word?</p>
              <button
                onClick={() => setShowAnswer(true)}
                className="px-8 py-3 bg-slate-100 text-slate-700 rounded-xl font-semibold hover:bg-slate-200 transition-colors"
              >
                Show Answer
              </button>
            </div>
          ) : (
            <div className="space-y-4">
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
