import { useState } from 'react';
import { parseIPA, PhonemeInfo } from '../ipa';

interface PhonemeBreakdownProps {
  phonetic: string;
}

export default function PhonemeBreakdown({ phonetic }: PhonemeBreakdownProps) {
  const [expanded, setExpanded] = useState(false);
  const phonemes = parseIPA(phonetic);

  if (phonemes.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-indigo-300 hover:text-white transition-colors"
      >
        <svg
          className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium">Phoneme Breakdown</span>
      </button>

      {expanded && (
        <div className="mt-3 bg-white/10 rounded-xl p-4">
          <div className="space-y-2">
            {phonemes.map((p: PhonemeInfo, i: number) => (
              <div
                key={i}
                className="flex items-center gap-3 text-sm"
              >
                <span className="w-14 text-right font-mono font-bold text-white/90">
                  {p.symbol}
                </span>
                <span className="text-indigo-200 text-xs">{p.example}</span>
                <span className="font-medium text-white/80">{p.exampleWord}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
