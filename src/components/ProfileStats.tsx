import { useMemo, useEffect, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  wordsAtom,
  allDueReviewWordsAtom,
  userAtom,
  tokenWriteAtom,
  levelWriteAtom,
  levelAtom,
} from '../store';
import { getTodayString, getWeekRange, getWordsInDateRange } from '../utils';
import { getActivityForDate, getActivityForWeek } from '../store';
import { fetchLevel, fetchProfile, updateProfile, type UserProfilePreferences } from '../api';

function formatListening(totalMinutes: number): string {
  if (totalMinutes < 1) return '—';
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatReadingDuration(seconds: number): string {
  if (seconds < 60) return '—';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest > 0 ? `${h}h ${rest}m` : `${h}h`;
}

function formatWordCount(n: number): string {
  if (n < 1) return '—';
  return n >= 10000 ? `${(n / 10000).toFixed(1)}K words` : `${n.toLocaleString()} words`;
}

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
  const setLevel = useSetAtom(levelWriteAtom);
  const level = useAtomValue(levelAtom);

  useEffect(() => {
    if (localStorage.getItem('feedlingo-token')) {
      fetchLevel().then((res) => {
        if (res) {
          setLevel({
            levelScore: res.levelScore,
            band: res.band,
            label: res.label,
            testCount: res.testCount,
            feedbackCount: res.feedbackCount,
          });
        }
      });
      fetchProfile().then((p) => {
        if (p) {
          setProfilePrefs(p);
          setProfileDraft({
            keywords: p.interestKeywords.join(', '),
            levelBand: p.preferredLevelBand || '',
          });
        }
      });
    }
  }, [user?.id, setLevel]);

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

  const [activityRefresh, setActivityRefresh] = useState(0);
  const [profilePrefs, setProfilePrefs] = useState<UserProfilePreferences | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ keywords: '', levelBand: '' });
  useEffect(() => {
    const handler = () => setActivityRefresh((n) => n + 1);
    window.addEventListener('feedlingo-activity-updated', handler);
    return () => window.removeEventListener('feedlingo-activity-updated', handler);
  }, []);

  const todayActivity = useMemo(
    () => getActivityForDate(today),
    [today, activityRefresh]
  );
  const weekActivity = useMemo(
    () => getActivityForWeek(weekRange.start, weekRange.end),
    [weekRange.start, weekRange.end, activityRefresh]
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

      {/* Recommendation preferences (static profile) */}
      {user && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 mb-6">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Recommendation Preferences
          </h3>
          <p className="text-sm text-slate-500 mb-4">
            Set your interests and level to improve article recommendations. Your feedback (like/dislike, difficulty) also influences future suggestions.
          </p>
          {!profileEditing ? (
            <div>
              <div className="text-sm text-slate-600">
                <span className="text-slate-400">Interests:</span>{' '}
                {profilePrefs?.interestKeywords?.length ? profilePrefs.interestKeywords.join(', ') : 'Not set'}
              </div>
              {profilePrefs?.preferredLevelBand && (
                <div className="text-sm text-slate-600 mt-1">
                  <span className="text-slate-400">Preferred level:</span> {profilePrefs.preferredLevelBand}
                </div>
              )}
              <button
                onClick={() => setProfileEditing(true)}
                className="mt-3 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
              >
                Edit
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Interest topics (comma-separated)</label>
                <input
                  type="text"
                  value={profileDraft.keywords}
                  onChange={(e) => setProfileDraft((d) => ({ ...d, keywords: e.target.value }))}
                  placeholder="e.g. technology, business, science"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Preferred level (optional override)</label>
                <select
                  value={profileDraft.levelBand}
                  onChange={(e) => setProfileDraft((d) => ({ ...d, levelBand: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                >
                  <option value="">Auto (from tests + feedback)</option>
                  <option value="A1">A1 Beginner</option>
                  <option value="A2">A2 Elementary</option>
                  <option value="B1">B1 Intermediate</option>
                  <option value="B2">B2 Upper Intermediate</option>
                  <option value="C1">C1 Advanced</option>
                  <option value="C2">C2 Proficient</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const keywords = profileDraft.keywords.split(',').map((k) => k.trim()).filter(Boolean);
                    const band = profileDraft.levelBand.trim() || null;
                    const ok = await updateProfile({ interestKeywords: keywords, preferredLevelBand: band });
                    if (ok) {
                      setProfilePrefs({ interestKeywords: keywords, preferredLevelBand: band });
                      setProfileEditing(false);
                    }
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setProfileEditing(false);
                    setProfileDraft({
                      keywords: profilePrefs?.interestKeywords?.join(', ') || '',
                      levelBand: profilePrefs?.preferredLevelBand || '',
                    });
                  }}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* English level */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
          English Level
        </h3>
        <div className="flex items-center gap-4">
          <div className="text-4xl font-bold text-indigo-600">{level.band}</div>
          <div>
            <div className="text-lg font-semibold text-slate-800">{level.label}</div>
            <div className="text-sm text-slate-500">
              Based on {level.testCount} tests + {level.feedbackCount} reading feedbacks
            </div>
          </div>
        </div>
      </div>

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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="bg-indigo-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-indigo-600">{todayWords.length}</div>
            <div className="text-sm text-indigo-500">New words</div>
          </div>
          <div className="bg-emerald-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-emerald-600">{todayActivity.reviews}</div>
            <div className="text-sm text-emerald-500">Reviews</div>
          </div>
          <div className="bg-blue-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-blue-600">{todayActivity.reads}</div>
            <div className="text-sm text-blue-500">Articles read</div>
          </div>
          <div className="bg-cyan-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-cyan-600">
              {formatReadingDuration(todayActivity.readingSeconds)}
            </div>
            <div className="text-sm text-cyan-500">Reading time</div>
          </div>
          <div className="bg-teal-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-teal-600">
              {formatWordCount(todayActivity.readingWords)}
            </div>
            <div className="text-sm text-teal-500">Words read</div>
          </div>
          <div className="bg-violet-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-violet-600">
              {formatListening(Math.floor(todayActivity.listeningSeconds / 60))}
            </div>
            <div className="text-sm text-violet-500">Listening time</div>
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
          This week
        </h3>
        <p className="text-xs text-slate-300 mb-4">{weekRange.label}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="bg-indigo-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-indigo-600">{weekWords.length}</div>
            <div className="text-sm text-indigo-500">New words</div>
          </div>
          <div className="bg-emerald-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-emerald-600">{weekActivity.reviews}</div>
            <div className="text-sm text-emerald-500">Reviews</div>
          </div>
          <div className="bg-blue-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-blue-600">{weekActivity.reads}</div>
            <div className="text-sm text-blue-500">Articles read</div>
          </div>
          <div className="bg-cyan-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-cyan-600">
              {formatReadingDuration(weekActivity.readingSeconds)}
            </div>
            <div className="text-sm text-cyan-500">Reading time</div>
          </div>
          <div className="bg-teal-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-teal-600">
              {formatWordCount(weekActivity.readingWords)}
            </div>
            <div className="text-sm text-teal-500">Words read</div>
          </div>
          <div className="bg-violet-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-violet-600">
              {formatListening(Math.floor(weekActivity.listeningSeconds / 60))}
            </div>
            <div className="text-sm text-violet-500">Listening time</div>
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
