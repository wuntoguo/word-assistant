import { useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { wordsAtom, allDueReviewWordsAtom, userAtom, tokenWriteAtom } from '../store';
import { getTodayString, getWeekRange, getWordsInDateRange } from '../utils';

const STAGE_LABELS = ['New', 'Learning', 'Familiar', 'Good', 'Strong', 'Mastered'];
const STAGE_COLORS = [
  'bg-slate-400',
  'bg-orange-400',
  'bg-yellow-400',
  'bg-blue-400',
  'bg-indigo-500',
  'bg-emerald-500',
];

export default function ProfileStats() {
  const words = useAtomValue(wordsAtom);
  const dueWords = useAtomValue(allDueReviewWordsAtom);
  const user = useAtomValue(userAtom);
  const setToken = useSetAtom(tokenWriteAtom);

  const today = getTodayString();
  const weekRange = useMemo(() => getWeekRange(0), []);

  const todayWords = useMemo(
    () => words.filter((w) => w.dateAdded === today),
    [words, today]
  );

  const weekWords = useMemo(
    () => getWordsInDateRange(words, weekRange.start, weekRange.end),
    [words, weekRange]
  );

  const totalReviews = useMemo(
    () => words.reduce((sum, w) => sum + w.reviewCount, 0),
    [words]
  );

  const weekReviews = useMemo(
    () => weekWords.reduce((sum, w) => sum + w.reviewCount, 0),
    [weekWords]
  );

  const masteredCount = useMemo(
    () => words.filter((w) => w.memoryStage >= 4).length,
    [words]
  );

  const stageDistribution = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0];
    for (const w of words) {
      counts[Math.min(w.memoryStage, 5)]++;
    }
    return counts;
  }, [words]);

  const maxStageCount = Math.max(...stageDistribution, 1);

  const studyStreak = useMemo(() => {
    const dateSet = new Set(words.map((w) => w.dateAdded));
    let streak = 0;
    const d = new Date();
    // Check today first; if no words today, start from yesterday
    const todayStr = d.toISOString().split('T')[0];
    if (!dateSet.has(todayStr)) {
      d.setDate(d.getDate() - 1);
    }
    while (true) {
      const dateStr = d.toISOString().split('T')[0];
      if (dateSet.has(dateStr)) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }, [words]);

  const handleLogout = () => {
    setToken(null);
    window.location.reload();
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">Profile</h1>
        <p className="text-slate-500">Your vocabulary learning statistics</p>
      </div>

      {/* Account info */}
      {user && (
        <div className="bg-white rounded-2xl shadow-md border border-slate-100 p-6 mb-6">
          <div className="flex items-center gap-4">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="w-14 h-14 rounded-full" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-xl font-bold">
                {(user.name || user.email || '?')[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-lg font-semibold text-slate-800 truncate">
                {user.name || 'User'}
              </div>
              {user.email && (
                <div className="text-sm text-slate-400 truncate">{user.email}</div>
              )}
              <div className="text-xs text-slate-300 mt-0.5 capitalize">
                via {user.provider}
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-red-200"
            >
              Sign out
            </button>
          </div>
        </div>
      )}

      {/* Study streak + quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 text-center">
          <div className="text-3xl font-bold text-orange-500">{studyStreak}</div>
          <div className="text-xs text-slate-400 mt-1">Day Streak</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 text-center">
          <div className="text-3xl font-bold text-indigo-600">{words.length}</div>
          <div className="text-xs text-slate-400 mt-1">Total Words</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 text-center">
          <div className="text-3xl font-bold text-emerald-600">{masteredCount}</div>
          <div className="text-xs text-slate-400 mt-1">Mastered</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 text-center">
          <div className="text-3xl font-bold text-purple-600">{totalReviews}</div>
          <div className="text-xs text-slate-400 mt-1">Total Reviews</div>
        </div>
      </div>

      {/* Today's activity */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
          Today
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-indigo-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-indigo-600">{todayWords.length}</div>
            <div className="text-sm text-indigo-500">Words looked up</div>
          </div>
          <div className="bg-amber-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-amber-600">{dueWords.length}</div>
            <div className="text-sm text-amber-500">Due for review</div>
          </div>
        </div>
        {todayWords.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {todayWords.map((w) => (
              <span
                key={w.id}
                className="px-2.5 py-1 bg-slate-100 rounded-full text-xs text-slate-600"
              >
                {w.word}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* This week's activity */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-1">
          This Week
        </h3>
        <p className="text-xs text-slate-300 mb-4">{weekRange.label}</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-blue-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-blue-600">{weekWords.length}</div>
            <div className="text-sm text-blue-500">Words added</div>
          </div>
          <div className="bg-purple-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-purple-600">{weekReviews}</div>
            <div className="text-sm text-purple-500">Reviews done</div>
          </div>
        </div>
      </div>

      {/* Memory stage distribution */}
      {words.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 mb-6">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
            Memory Stage Distribution
          </h3>
          <div className="space-y-3">
            {STAGE_LABELS.map((label, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-20 text-xs text-slate-500 text-right">{label}</div>
                <div className="flex-1 bg-slate-100 rounded-full h-6 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${STAGE_COLORS[i]} transition-all duration-500 flex items-center justify-end pr-2`}
                    style={{
                      width: `${Math.max(
                        (stageDistribution[i] / maxStageCount) * 100,
                        stageDistribution[i] > 0 ? 12 : 0
                      )}%`,
                    }}
                  >
                    {stageDistribution[i] > 0 && (
                      <span className="text-xs font-bold text-white">
                        {stageDistribution[i]}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {words.length === 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center">
          <div className="text-5xl mb-4">&#128218;</div>
          <p className="text-slate-500">No words yet.</p>
          <p className="text-sm text-slate-400 mt-1">
            Start looking up words to track your progress!
          </p>
        </div>
      )}
    </div>
  );
}
