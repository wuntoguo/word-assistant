import { useState, useRef } from 'react';
import { useAtom } from 'jotai';
import { wordsAtom } from '../store';
import { Word } from '../types';
import { lookupWord, getTodayString, getNextReviewDate } from '../utils';

interface WordLookupProps {
  onWordAdded?: () => void;
}

export default function WordLookup({ onWordAdded }: WordLookupProps) {
  const [words, setWords] = useAtom(wordsAtom);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Word | null>(null);
  const [saved, setSaved] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const handleSearch = async () => {
    const term = searchTerm.trim();
    if (!term) return;

    setLoading(true);
    setError('');
    setResult(null);
    setSaved(false);

    try {
      const data = await lookupWord(term);
      const now = new Date().toISOString();
      const word: Word = {
        ...data,
        id: Date.now().toString(),
        dateAdded: getTodayString(),
        nextReviewDate: getNextReviewDate(0),
        reviewCount: 0,
        memoryStage: 0,
        updatedAt: now,
      };
      setResult(word);

      // Auto-save if not already in the list
      const exists = words.some(
        (w) => w.word.toLowerCase() === word.word.toLowerCase()
      );
      if (!exists) {
        setWords((prev) => [...prev, word]);
        setSaved(true);
        onWordAdded?.();
      } else {
        setSaved(false);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to look up word.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const playAudio = () => {
    if (audioRef.current) {
      audioRef.current.play();
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">Word Lookup</h1>
        <p className="text-slate-500">Search any English word to see its pronunciation, definition, and examples</p>
      </div>

      {/* Search bar */}
      <div className="flex gap-3 mb-6">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 px-4 py-3 rounded-xl border border-slate-200 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent text-lg placeholder-slate-400"
          placeholder="Type a word, e.g. serendipity"
          autoFocus
        />
        <button
          onClick={handleSearch}
          disabled={loading || !searchTerm.trim()}
          className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Searching
            </span>
          ) : (
            'Search'
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
          {error}
        </div>
      )}

      {/* Result Card */}
      {result && (
        <div className="bg-white rounded-2xl shadow-md border border-slate-100 overflow-hidden">
          {/* Header */}
          <div className="p-6 bg-gradient-to-r from-indigo-500 to-purple-500 text-white">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-bold">{result.word}</h2>
                <p className="text-indigo-100 mt-1 text-lg font-mono">{result.phonetic || 'No phonetic available'}</p>
              </div>
              <div className="flex items-center gap-2">
                {result.audioUrl && (
                  <>
                    <audio ref={audioRef} src={result.audioUrl} />
                    {result.audioAccent && (
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        result.audioAccent === 'US' ? 'bg-white/30' : 'bg-amber-400/80 text-amber-900'
                      }`}>
                        {result.audioAccent}
                      </span>
                    )}
                    <button
                      onClick={playAudio}
                      className="w-12 h-12 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
                      title={`Play pronunciation${result.audioAccent ? ` (${result.audioAccent})` : ''}`}
                    >
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            </div>
            {result.partOfSpeech && (
              <span className="inline-block mt-2 px-3 py-1 bg-white/20 rounded-full text-sm">
                {result.partOfSpeech}
              </span>
            )}
          </div>

          {/* Body */}
          <div className="p-6 space-y-5">
            {/* Definitions */}
            <div>
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Definitions</h3>
              <ol className="space-y-2">
                {result.definitions.map((def, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-semibold">
                      {i + 1}
                    </span>
                    <span className="text-slate-700 leading-relaxed">{def}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Examples */}
            {result.examples.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Example Sentences</h3>
                <div className="space-y-2">
                  {result.examples.map((ex, i) => (
                    <div key={i} className="pl-4 border-l-3 border-indigo-300 text-slate-600 italic leading-relaxed">
                      "{ex}"
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Save status */}
            <div className="pt-3 border-t border-slate-100">
              {saved ? (
                <div className="flex items-center gap-2 text-emerald-600">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-sm font-medium">Saved to your word list! First review scheduled for tomorrow.</span>
                </div>
              ) : (
                <p className="text-sm text-slate-400">This word is already in your list.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recent lookups */}
      {words.length > 0 && !result && (
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Recently Added Words</h3>
          <div className="flex flex-wrap gap-2">
            {words.slice(-20).reverse().map((w) => (
              <button
                key={w.id}
                onClick={() => { setSearchTerm(w.word); }}
                className="px-3 py-1.5 bg-white rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-colors"
              >
                {w.word}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
