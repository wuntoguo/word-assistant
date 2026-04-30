import { useState } from 'react';
import { useSetAtom } from 'jotai';
import { userAtom } from '../store';
import { completeOnboarding } from '../api';

// 16 words across 4 CEFR levels — same order as server WORD_GROUPS
const WORD_CARDS = [
  { word: 'food',       level: 'A1' },
  { word: 'happy',      level: 'A1' },
  { word: 'big',        level: 'A1' },
  { word: 'run',        level: 'A1' },
  { word: 'describe',   level: 'A2' },
  { word: 'imagine',    level: 'A2' },
  { word: 'silence',    level: 'A2' },
  { word: 'curious',    level: 'A2' },
  { word: 'reluctant',  level: 'B1' },
  { word: 'negotiate',  level: 'B1' },
  { word: 'emphasis',   level: 'B1' },
  { word: 'occasional', level: 'B1' },
  { word: 'ambiguous',  level: 'B2' },
  { word: 'scrutinize', level: 'B2' },
  { word: 'eloquent',   level: 'B2' },
  { word: 'inevitable', level: 'B2' },
];

const EXAMS = [
  { key: 'gaokao', label: '高考', hint: '满分 150 分' },
  { key: 'cet4',   label: '四级 CET-4', hint: '满分 710 分' },
  { key: 'cet6',   label: '六级 CET-6', hint: '满分 710 分' },
  { key: 'ielts',  label: '雅思 IELTS', hint: '1–9 分' },
  { key: 'toefl',  label: '托福 TOEFL', hint: '0–120 分' },
];

type Screen = 'start' | 'exam_select' | 'exam_score' | 'word_check' | 'finishing';

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const setUser = useSetAtom(userAtom);

  const [screen, setScreen] = useState<Screen>('start');
  const [selectedExam, setSelectedExam] = useState('');
  const [scoreInput, setScoreInput] = useState('');
  const [scoreError, setScoreError] = useState('');
  const [cardIndex, setCardIndex] = useState(0);
  const [recognized, setRecognized] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function finish(payload: Parameters<typeof completeOnboarding>[0]) {
    setScreen('finishing');
    setLoading(true);
    try {
      await completeOnboarding(payload);
      setUser((u) => u ? { ...u, onboardingCompleted: true } : u);
      onDone();
    } catch {
      onDone(); // proceed anyway, onboarding can be re-skipped
    } finally {
      setLoading(false);
    }
  }

  function handleExamScore() {
    const n = parseFloat(scoreInput.trim());
    if (isNaN(n) || n < 0) {
      setScoreError('请输入有效分数');
      return;
    }
    setScoreError('');
    finish({ method: 'exam', exam: selectedExam, score: n });
  }

  function handleWordCard(know: boolean) {
    const card = WORD_CARDS[cardIndex];
    const newRecognized = know ? [...recognized, card.word] : recognized;

    if (cardIndex + 1 >= WORD_CARDS.length) {
      finish({ method: 'word_check', recognizedWords: newRecognized });
    } else {
      setRecognized(newRecognized);
      setCardIndex(cardIndex + 1);
    }
  }

  // ── Start screen ─────────────────────────────────────────────
  if (screen === 'start') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 bg-gray-50">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center space-y-2">
            <div className="text-4xl">👋</div>
            <h1 className="text-2xl font-bold text-gray-900">你考过英语考试吗？</h1>
            <p className="text-sm text-gray-500">选一个就好，帮我们推荐合适的内容</p>
          </div>

          <div className="space-y-3">
            {EXAMS.map((e) => (
              <button
                key={e.key}
                onClick={() => { setSelectedExam(e.key); setScreen('exam_score'); }}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 bg-white hover:border-indigo-400 hover:bg-indigo-50 transition-colors text-left"
              >
                <span className="font-medium text-gray-800">{e.label}</span>
                <span className="text-xs text-gray-400">{e.hint}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-col items-center gap-2 pt-2">
            <button
              onClick={() => setScreen('word_check')}
              className="text-sm text-indigo-600 hover:underline font-medium"
            >
              没考过，快速认一认词
            </button>
            <button
              onClick={() => finish({ method: 'skip' })}
              className="text-xs text-gray-400 hover:underline"
            >
              跳过，直接开始
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Exam score input ─────────────────────────────────────────
  if (screen === 'exam_score') {
    const exam = EXAMS.find((e) => e.key === selectedExam)!;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 bg-gray-50">
        <div className="w-full max-w-sm space-y-8">
          <button
            onClick={() => setScreen('start')}
            className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1"
          >
            ← 返回
          </button>

          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold text-gray-900">{exam.label}大概多少分？</h2>
            <p className="text-sm text-gray-500">{exam.hint}，大概填就行</p>
          </div>

          <div className="space-y-3">
            <input
              type="number"
              value={scoreInput}
              onChange={(e) => { setScoreInput(e.target.value); setScoreError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleExamScore()}
              placeholder={exam.key === 'ielts' ? '例如 6.5' : '例如 110'}
              className="w-full px-4 py-3 text-lg text-center rounded-xl border border-gray-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
              autoFocus
            />
            {scoreError && <p className="text-xs text-red-500 text-center">{scoreError}</p>}
            <button
              onClick={handleExamScore}
              className="w-full py-3 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-semibold transition-colors"
            >
              确认
            </button>
          </div>

          <div className="text-center">
            <button
              onClick={() => finish({ method: 'skip' })}
              className="text-xs text-gray-400 hover:underline"
            >
              不记得了，跳过
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Word check cards ──────────────────────────────────────────
  if (screen === 'word_check') {
    const card = WORD_CARDS[cardIndex];
    const progress = ((cardIndex) / WORD_CARDS.length) * 100;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 bg-gray-50">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span>认识几个？</span>
              <span>{cardIndex}/{WORD_CARDS.length}</span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
              <div
                className="h-full bg-indigo-400 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="flex flex-col items-center justify-center py-12 rounded-2xl bg-white border border-gray-100 shadow-sm">
            <span className="text-4xl font-bold text-gray-900 tracking-wide">{card.word}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleWordCard(false)}
              className="py-4 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-lg transition-colors"
            >
              不认识
            </button>
            <button
              onClick={() => handleWordCard(true)}
              className="py-4 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-semibold text-lg transition-colors"
            >
              认识 👍
            </button>
          </div>

          <div className="text-center">
            <button
              onClick={() => finish({ method: 'skip' })}
              className="text-xs text-gray-400 hover:underline"
            >
              跳过
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Finishing / loading ───────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-gray-50">
      {loading && (
        <div className="flex flex-col items-center gap-4 text-gray-500">
          <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">稍等一下...</span>
        </div>
      )}
    </div>
  );
}
