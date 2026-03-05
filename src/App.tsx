import { HashRouter, Routes, Route, NavLink, Outlet } from 'react-router-dom';
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
import Discovery from './components/Discovery';
import AudioChannel from './components/AudioChannel';
import WeeklyTest from './components/WeeklyTest';
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

function LearnLayout() {
  return (
    <div className="content-wrap">
      <div className="panel p-2 mb-6 flex gap-2 overflow-x-auto">
        <NavLink
          to="/learn"
          end
          className={({ isActive }) =>
            `nav-pill px-4 py-2 text-sm whitespace-nowrap transition-colors ${
              isActive ? 'active' : 'hover:bg-white'
            }`
          }
        >
          Lookup
        </NavLink>
        <NavLink
          to="/learn/review"
          className={({ isActive }) =>
            `nav-pill px-4 py-2 text-sm whitespace-nowrap transition-colors relative ${
              isActive ? 'active' : 'hover:bg-white'
            }`
          }
        >
          Review
        </NavLink>
        <NavLink
          to="/learn/history"
          className={({ isActive }) =>
            `nav-pill px-4 py-2 text-sm whitespace-nowrap transition-colors ${
              isActive ? 'active' : 'hover:bg-white'
            }`
          }
        >
          History
        </NavLink>
        <NavLink
          to="/learn/weekly-test"
          className={({ isActive }) =>
            `nav-pill px-4 py-2 text-sm whitespace-nowrap transition-colors ${
              isActive ? 'active' : 'hover:bg-white'
            }`
          }
        >
          Weekly Test
        </NavLink>
      </div>
      <Outlet />
    </div>
  );
}

function MobileBottomNav({ reviewCount, hasUser }: { reviewCount: number; hasUser: boolean }) {
  return (
    <nav className="mobile-bottom-nav md:hidden" aria-label="Primary">
      <NavLink to="/" end className={({ isActive }) => `mobile-tab ${isActive ? 'active' : ''}`}>
        <span className="tab-icon" aria-hidden="true">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 5h9v9M14 10l5-5M5 7h4M5 12h8M5 17h6" />
          </svg>
        </span>
        <span>Discover</span>
      </NavLink>
      <NavLink to="/audio" className={({ isActive }) => `mobile-tab ${isActive ? 'active' : ''}`}>
        <span className="tab-icon" aria-hidden="true">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 13v-2m4 5V8m4 8V6m4 6V8m4 4v-2" />
          </svg>
        </span>
        <span>Audio</span>
      </NavLink>
      <NavLink to="/learn" className={({ isActive }) => `mobile-tab ${isActive ? 'active' : ''}`}>
        {reviewCount > 0 && (
          <span className="mobile-tab-badge">{reviewCount > 9 ? '9+' : reviewCount}</span>
        )}
        <span className="tab-icon" aria-hidden="true">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6.5A2.5 2.5 0 016.5 4H20v14h-13.5A2.5 2.5 0 014 15.5v-9z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 8h8M8 12h6" />
          </svg>
        </span>
        <span>Learn</span>
      </NavLink>
      <NavLink to={hasUser ? "/me" : "/login"} className={({ isActive }) => `mobile-tab ${isActive ? 'active' : ''}`}>
        <span className="tab-icon" aria-hidden="true">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 12a4 4 0 100-8 4 4 0 000 8z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 20a7 7 0 0114 0" />
          </svg>
        </span>
        <span>Profile</span>
      </NavLink>
    </nav>
  );
}

function AppContent() {
  const allDueWords = useAtomValue(allDueReviewWordsAtom);
  const reviewCount = allDueWords.length;
  const user = useAtomValue(userAtom);
  const { triggerSync, fullSync } = useSyncEngine();

  return (
    <div className="app-shell">
      {/* Navigation: 3 main tabs */}
      <nav className="glass-nav sticky top-0 z-50">
        <div className="page-wrap">
          <div className="flex items-center justify-between h-14">
            <div className="brand">
              <span className="brand-mark" />
              <span className="brand-text">FeedLingo</span>
            </div>
            <div className="nav-links hidden md:flex">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `nav-pill px-3 py-1.5 text-sm transition-colors ${
                    isActive ? 'active' : 'hover:bg-white'
                  }`
                }
              >
                Discover
              </NavLink>
              <NavLink
                to="/audio"
                className={({ isActive }) =>
                  `nav-pill px-3 py-1.5 text-sm transition-colors ${
                    isActive ? 'active' : 'hover:bg-white'
                  }`
                }
              >
                Audio
              </NavLink>
              <NavLink
                to="/learn"
                className={({ isActive }) =>
                  `nav-pill px-3 py-1.5 text-sm transition-colors relative ${
                    isActive ? 'active' : 'hover:bg-white'
                  }`
                }
              >
                Learn
                {reviewCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                    {reviewCount > 9 ? '9+' : reviewCount}
                  </span>
                )}
              </NavLink>
              <NavLink
                to="/me"
                className={({ isActive }) =>
                  `nav-pill px-3 py-1.5 text-sm transition-colors ${
                    isActive ? 'active' : 'hover:bg-white'
                  }`
                }
              >
                Profile
              </NavLink>
            </div>
            <div className="flex items-center gap-3">
              {user && <span className="hidden md:inline"><SyncStatusIndicator /></span>}
              {user ? (
                <>
                  <NavLink
                    to="/me"
                    className="btn-ghost rounded-full w-9 h-9 inline-flex items-center justify-center transition-colors shrink-0 md:hidden"
                    title="Profile"
                    aria-label="Open profile"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.121 17.804A9 9 0 1118.88 17.8M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </NavLink>
                  <button
                    onClick={fullSync}
                    className="btn-ghost rounded-full w-9 h-9 hidden md:inline-flex items-center justify-center transition-colors shrink-0"
                    title="Sync now"
                    aria-label="Sync now"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </>
              ) : (
                <NavLink
                  to="/login"
                  className="btn-ghost px-3 rounded-lg text-xs font-semibold shrink-0"
                >
                  Sign in
                </NavLink>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="page-wrap main-stage py-6 md:py-8 pb-24 md:pb-8">
        <Routes>
          <Route path="/" element={<Discovery />} />
          <Route path="/discover" element={<Discovery />} />
          <Route path="/audio" element={<AudioChannel />} />
          <Route path="/learn" element={<LearnLayout />}>
            <Route index element={<WordLookup onWordAdded={triggerSync} />} />
            <Route path="review" element={<ReviewTest onReviewComplete={triggerSync} />} />
            <Route path="history" element={<WordHistory />} />
            <Route path="weekly-test" element={<WeeklyTest />} />
          </Route>
          <Route path="/me" element={<ProfileStats />} />
          <Route path="/profile" element={<ProfileStats />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth-callback" element={<AuthCallback />} />
          <Route path="*" element={<Discovery />} />
        </Routes>
      </main>
      <MobileBottomNav reviewCount={reviewCount} hasUser={!!user} />
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
