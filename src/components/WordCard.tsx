import { useState, useCallback } from 'react';
import { Word } from '../types';
import PhonemeBreakdown from './PhonemeBreakdown';
import WordImage from './WordImage';

interface WordCardProps {
  word: Word;
  footer?: React.ReactNode;
}

export default function WordCard({ word, footer }: WordCardProps) {
  const [playing, setPlaying] = useState(false);

  const playAudio = useCallback(async () => {
    if (!word.audioUrl || playing) return;
    setPlaying(true);
    try {
      const audio = new Audio(word.audioUrl);
      audio.onended = () => setPlaying(false);
      audio.onerror = () => setPlaying(false);
      await audio.play();
    } catch {
      setPlaying(false);
    }
  }, [word.audioUrl, playing]);

  return (
    <div className="bg-white rounded-2xl shadow-md border border-slate-100 overflow-hidden">
      {/* Header */}
      <div className="p-6 bg-gradient-to-r from-indigo-500 to-purple-500 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold">{word.word}</h2>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-indigo-100 text-lg font-mono">
                {word.phonetic || 'No phonetic available'}
              </p>
              {word.audioAccent && (
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    word.audioAccent === 'US'
                      ? 'bg-white/30'
                      : 'bg-amber-400/80 text-amber-900'
                  }`}
                >
                  {word.audioAccent}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {word.audioUrl && (
              <button
                onClick={playAudio}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full transition-colors ${
                  playing
                    ? 'bg-white/40 animate-pulse'
                    : 'bg-white/20 hover:bg-white/30'
                }`}
                title={`Play pronunciation${word.audioAccent ? ` (${word.audioAccent})` : ''}`}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                </svg>
                <span className="text-sm font-medium">{playing ? 'Playing...' : 'Play'}</span>
              </button>
            )}
          </div>
        </div>

        {word.partOfSpeech && (
          <span className="inline-block mt-2 px-3 py-1 bg-white/20 rounded-full text-sm">
            {word.partOfSpeech}
          </span>
        )}

        {word.phonetic && <PhonemeBreakdown phonetic={word.phonetic} />}
      </div>

      {/* Body */}
      <div className="p-6 space-y-5">
        {/* Definitions */}
        <div>
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Definitions
          </h3>
          <ol className="space-y-2">
            {word.definitions.map((def, i) => (
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
        {word.examples.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Example Sentences
            </h3>
            <div className="space-y-2">
              {word.examples.map((ex, i) => (
                <div
                  key={i}
                  className="pl-4 border-l-3 border-indigo-300 text-slate-600 italic leading-relaxed"
                >
                  &ldquo;{ex}&rdquo;
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Word image from Wikipedia */}
        <WordImage word={word.word} />

        {/* Optional footer slot */}
        {footer}
      </div>
    </div>
  );
}
