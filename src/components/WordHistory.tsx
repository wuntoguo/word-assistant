import { useState, useMemo } from 'react';
import { useAtom } from 'jotai';
import { wordsAtom } from '../store';
import { getWeekRange, getWordsInDateRange, exportToCSV } from '../utils';

export default function WordHistory() {
  const [words, setWords] = useAtom(wordsAtom);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showArchived, setShowArchived] = useState(false);

  const activeWords = useMemo(() => words.filter((w) => !w.archived), [words]);
  const archivedWords = useMemo(() => words.filter((w) => w.archived), [words]);

  const weekRange = useMemo(() => getWeekRange(weekOffset), [weekOffset]);
  const weekWords = useMemo(
    () => getWordsInDateRange(activeWords, weekRange.start, weekRange.end),
    [activeWords, weekRange]
  );

  const toggleArchive = (wordId: string, archive: boolean) => {
    setWords((prev) =>
      prev.map((w) =>
        w.id === wordId
          ? { ...w, archived: archive, updatedAt: new Date().toISOString() }
          : w
      )
    );
  };

  // Group words by date
  const groupedByDate = useMemo(() => {
    const groups: Record<string, typeof weekWords> = {};
    for (const w of weekWords) {
      if (!groups[w.dateAdded]) groups[w.dateAdded] = [];
      groups[w.dateAdded].push(w);
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [weekWords]);

  const stageLabels = ['New', 'Learning', 'Familiar', 'Good', 'Strong', 'Mastered'];
  const stageColors = [
    'bg-slate-100 text-slate-600',
    'bg-orange-100 text-orange-600',
    'bg-yellow-100 text-yellow-600',
    'bg-blue-100 text-blue-600',
    'bg-indigo-100 text-indigo-600',
    'bg-emerald-100 text-emerald-600',
  ];

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">Word History</h1>
        <p className="text-slate-500">Review your vocabulary progress week by week</p>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between mb-6 bg-white rounded-xl shadow-sm border border-slate-100 p-4">
        <button
          onClick={() => setWeekOffset((prev) => prev - 1)}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="text-center">
          <div className="font-semibold text-slate-800">{weekRange.label}</div>
          <div className="text-sm text-slate-400">
            {weekWords.length} word{weekWords.length !== 1 ? 's' : ''} this week
          </div>
        </div>

        <button
          onClick={() => setWeekOffset((prev) => Math.min(prev + 1, 0))}
          disabled={weekOffset >= 0}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Export button */}
      {weekWords.length > 0 && (
        <div className="flex justify-end mb-4">
          <button
            onClick={() => exportToCSV(weekWords)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </button>
        </div>
      )}

      {/* Word list grouped by date */}
      {groupedByDate.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center">
          <div className="text-5xl mb-4">&#128214;</div>
          <p className="text-slate-500">No words recorded this week.</p>
          <p className="text-sm text-slate-400 mt-1">Start looking up words to build your vocabulary!</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedByDate.map(([date, dateWords]) => (
            <div key={date}>
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <span>{formatDate(date)}</span>
                <span className="text-xs font-normal bg-slate-100 px-2 py-0.5 rounded-full">
                  {dateWords.length} word{dateWords.length !== 1 ? 's' : ''}
                </span>
              </h3>
              <div className="space-y-2">
                {dateWords.map((w) => (
                  <div
                    key={w.id}
                    className="bg-white rounded-xl border border-slate-100 p-4 hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <span className="text-lg font-semibold text-slate-800">{w.word}</span>
                          <span className="text-sm text-slate-400 font-mono">{w.phonetic}</span>
                          {w.partOfSpeech && (
                            <span className="text-xs text-slate-400 italic">{w.partOfSpeech}</span>
                          )}
                        </div>
                        <p className="text-sm text-slate-600 truncate">
                          {w.definitions[0]}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${stageColors[w.memoryStage]}`}>
                          {stageLabels[w.memoryStage]}
                        </span>
                        <button
                          onClick={() => toggleArchive(w.id, true)}
                          className="p-1.5 text-slate-300 hover:text-red-400 transition-colors rounded-lg hover:bg-red-50"
                          title="Archive (stop reviewing)"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* All words stats */}
      {activeWords.length > 0 && (
        <div className="mt-8 bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Overall Statistics</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-slate-800">{activeWords.length}</div>
              <div className="text-sm text-slate-500">Active Words</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-emerald-600">
                {activeWords.filter((w) => w.memoryStage >= 4).length}
              </div>
              <div className="text-sm text-slate-500">Mastered</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-indigo-600">
                {activeWords.filter((w) => !w.archived && w.nextReviewDate <= new Date().toISOString().split('T')[0]).length}
              </div>
              <div className="text-sm text-slate-500">Due Today</div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100 text-center">
            <button
              onClick={() => exportToCSV(activeWords)}
              className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              Export all {activeWords.length} words as CSV
            </button>
          </div>
        </div>
      )}

      {/* Archived words section */}
      {archivedWords.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="flex items-center gap-2 text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3"
          >
            <svg
              className={`w-4 h-4 transition-transform ${showArchived ? 'rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            Archived ({archivedWords.length})
          </button>

          {showArchived && (
            <div className="space-y-2">
              {archivedWords.map((w) => (
                <div
                  key={w.id}
                  className="bg-slate-50 rounded-xl border border-slate-100 p-4 opacity-70"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-semibold text-slate-500">{w.word}</span>
                        <span className="text-sm text-slate-400 font-mono">{w.phonetic}</span>
                      </div>
                      <p className="text-sm text-slate-400 truncate">{w.definitions[0]}</p>
                    </div>
                    <button
                      onClick={() => toggleArchive(w.id, false)}
                      className="flex-shrink-0 ml-3 px-3 py-1.5 text-xs text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors border border-indigo-200"
                    >
                      Restore
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
