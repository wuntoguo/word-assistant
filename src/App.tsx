import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import {
  allDueReviewWordsAtom,
  userAtom,
  syncStatusAtom,
  isOnlineAtom,
} from './store';
import { useSyncEngine } from './sync';
import WordLookup from './components/WordLookup';
import ReviewTest from './components/ReviewTest';
import WordHistory from './components/WordHistory';
import ProfileStats from './components/ProfileStats';
import LoginPage from './components/LoginPage';
import AuthCallback from './components/AuthCallback';

function SyncStatusIndicator() {
  const syncStatus = useAtomValue(syncStatusAtom);
  const isOnline = useAtomValue(isOnlineAtom);

  if (!isOnline) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-amber-600">
        <span className="w-2 h-2 rounded-full bg-amber-400" />
        Offline
      </span>
    );
  }

  switch (syncStatus) {
    case 'syncing':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-indigo-500">
          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
          Syncing...
        </span>
      );
    case 'synced':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          Synced
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-red-500">
          <span className="w-2 h-2 rounded-full bg-red-400" />
          Sync error
        </span>
      );
    default:
      return null;
  }
}

function AppContent() {
  const allDueWords = useAtomValue(allDueReviewWordsAtom);
  const reviewCount = allDueWords.length;
  const user = useAtomValue(userAtom);
  const { triggerSync, fullSync } = useSyncEngine();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50">
      {/* Navigation */}
      <nav className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-2">
              <span className="text-xl">&#128214;</span>
              <span className="font-bold text-slate-800 hidden sm:inline">Word Assistant</span>
            </div>
            <div className="flex gap-1">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                Lookup
              </NavLink>
              <NavLink
                to="/review"
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors relative ${
                    isActive
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                Review
                {reviewCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                    {reviewCount > 9 ? '9+' : reviewCount}
                  </span>
                )}
              </NavLink>
              <NavLink
                to="/history"
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                History
              </NavLink>
              <NavLink
                to="/me"
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                Me
              </NavLink>
            </div>
            <div className="flex items-center gap-3">
              {user && <SyncStatusIndicator />}
              {user ? (
                <button
                  onClick={fullSync}
                  className="text-slate-400 hover:text-indigo-600 transition-colors"
                  title="Sync now"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              ) : (
                <NavLink
                  to="/login"
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  Sign in
                </NavLink>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="max-w-3xl mx-auto px-4 py-8">
        <Routes>
          <Route path="/" element={<WordLookup onWordAdded={triggerSync} />} />
          <Route path="/review" element={<ReviewTest onReviewComplete={triggerSync} />} />
          <Route path="/history" element={<WordHistory />} />
          <Route path="/me" element={<ProfileStats />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth-callback" element={<AuthCallback />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}

export default App;
