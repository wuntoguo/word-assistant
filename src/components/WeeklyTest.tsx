import { useState, useEffect, useRef } from 'react';
import { useSetAtom } from 'jotai';
import { levelWriteAtom, type LevelData } from '../store';
import { submitTestResult } from '../api';

const LEVEL_BANDS = [
  { min: 0, max: 20, band: 'A1', label: 'Beginner' },
  { min: 21, max: 40, band: 'A2', label: 'Elementary' },
  { min: 41, max: 55, band: 'B1', label: 'Intermediate' },
  { min: 56, max: 70, band: 'B2', label: 'Upper Intermediate' },
  { min: 71, max: 85, band: 'C1', label: 'Advanced' },
  { min: 86, max: 100, band: 'C2', label: 'Proficient' },
];

function computeLocalLevel(testResults: { score: number; total: number }[]): LevelData {
  let testScore = 50;
  if (testResults.length > 0) {
    testScore = testResults.reduce((s, t) => s + (t.total > 0 ? (t.score / t.total) * 100 : 50), 0) / testResults.length;
  }
  const score = Math.round(Math.max(0, Math.min(100, testScore)));
  const band = LEVEL_BANDS.find((b) => score >= b.min && score <= b.max) || LEVEL_BANDS[0];
  return { levelScore: score, band: band.band, label: band.label, testCount: testResults.length, feedbackCount: 0 };
}

interface TestQuestion {
  question: string;
  options: string[];
  correct: number;
}

interface WeeklyTestData {
  article: { title: string; content: string; source?: string };
  questions: TestQuestion[];
}

const LOCAL_TEST_KEY = 'feedlingo-test-results';

export default function WeeklyTest() {
  const [data, setData] = useState<WeeklyTestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'article' | 'quiz'>('article');
  const [answers, setAnswers] = useState<number[]>([]);
  const [showResult, setShowResult] = useState(false);
  const setLevel = useSetAtom(levelWriteAtom);
  const submittedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchTest() {
      try {
        const res = await fetch('/api/discovery/weekly-test');
        if (!res.ok) throw new Error('Failed to load');
        const d = await res.json() as WeeklyTestData;
        if (!cancelled) {
          setData(d);
          setAnswers(new Array(d.questions?.length || 0).fill(-1));
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load');
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchTest();
    return () => { cancelled = true; };
  }, []);

  const selectAnswer = (qIdx: number, optIdx: number) => {
    if (showResult) return;
    setAnswers((prev) => {
      const next = [...prev];
      next[qIdx] = optIdx;
      return next;
    });
  };

  const score = data?.questions?.reduce((s, q, i) => s + (answers[i] === q.correct ? 1 : 0), 0) ?? 0;

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <div className="inline-block w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-500">Generating weekly test…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <p className="text-amber-700">{error || 'No test available'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-slate-800 mb-6 text-center">Weekly Test</h2>

      {step === 'article' ? (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <h3 className="text-xl font-bold text-slate-800 mb-2">{data.article.title}</h3>
            {data.article.source && (
              <span className="text-xs text-slate-400">{data.article.source}</span>
            )}
            <div className="mt-4 text-slate-700 leading-relaxed whitespace-pre-wrap">
              {data.article.content}
            </div>
          </div>
          <button
            onClick={() => setStep('quiz')}
            className="w-full py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700"
          >
            Start quiz
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {data.questions.map((q, qIdx) => (
            <div key={qIdx} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
              <p className="font-medium text-slate-800 mb-4">
                {qIdx + 1}. {q.question}
              </p>
              <div className="space-y-2">
                {q.options.map((opt, oIdx) => {
                  const selected = answers[qIdx] === oIdx;
                  const isCorrect = oIdx === q.correct;
                  const showCorrect = showResult && isCorrect;
                  const showWrong = showResult && selected && !isCorrect;
                  return (
                    <button
                      key={oIdx}
                      onClick={() => selectAnswer(qIdx, oIdx)}
                      disabled={showResult}
                      className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-colors ${
                        showCorrect ? 'border-emerald-500 bg-emerald-50' :
                        showWrong ? 'border-red-500 bg-red-50' :
                        selected ? 'border-indigo-500 bg-indigo-50' :
                        'border-slate-200 hover:border-indigo-300'
                      }`}
                    >
                      <span className="font-medium text-slate-700">{opt}</span>
                      {showCorrect && <span className="ml-2 text-emerald-600">✓ Correct</span>}
                      {showWrong && <span className="ml-2 text-red-600">✗ Wrong</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <button
            onClick={async () => {
              setShowResult(true);
              if (submittedRef.current) return;
              submittedRef.current = true;
              const total = data.questions.length;
              const res = await submitTestResult(score, total);
              if (res) {
                setLevel({ ...res, feedbackCount: res.feedbackCount ?? 0 });
              } else {
                const local = JSON.parse(localStorage.getItem(LOCAL_TEST_KEY) || '[]');
                local.push({ score, total, date: new Date().toISOString().split('T')[0] });
                localStorage.setItem(LOCAL_TEST_KEY, JSON.stringify(local.slice(-8)));
                setLevel(computeLocalLevel(local.slice(-8)));
              }
            }}
            disabled={answers.some((a) => a < 0)}
            className="w-full py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {showResult ? `Score: ${score}/${data.questions.length}` : 'Check answers'}
          </button>
        </div>
      )}
    </div>
  );
}
