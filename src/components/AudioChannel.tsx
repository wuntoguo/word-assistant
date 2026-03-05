import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import { recordActivity, levelWriteAtom } from '../store';
import { getTodayString, formatArticleDate } from '../utils';
import { tokenAtom } from '../store';
import { submitArticleFeedback } from '../api';
import { createRequestId, trackEvents } from '../events';

interface AudioItem {
  id?: string;
  title: string;
  link: string;
  audioUrl?: string;
  durationSeconds?: number;
  keywords?: string[];
  pubDate: string;
  postedAt?: string | null;
  crawledAt?: string | null;
  description: string;
  simplified?: string;
  source?: string;
  recommendationReason?: string;
  scores?: {
    interestScore: number;
    difficultyScore: number;
    totalScore: number;
    freshnessScore?: number;
  };
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${m}:00`;
}

function formatTextWithParagraphs(text: string): React.ReactNode {
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim());
  if (paragraphs.length <= 1) return <span className="whitespace-pre-wrap">{text}</span>;
  return (
    <div className="space-y-3">
      {paragraphs.map((p, i) => (
        <p key={i} className="text-slate-700 leading-relaxed">
          {p.trim()}
        </p>
      ))}
    </div>
  );
}


function articleKey(item: { link?: string; title?: string }): string {
  return item.link || item.title || '';
}

function itemId(item: AudioItem, idx: number): string {
  return item.id || item.link || `audio-${idx}`;
}

function audioTimeText(item: AudioItem): string {
  const posted = item.postedAt || item.pubDate;
  if (posted) return `Posted ${formatArticleDate(posted, { withTime: true })}`;
  if (item.crawledAt) return `Crawled ${formatArticleDate(item.crawledAt, { withTime: true })}`;
  return 'Posted —';
}

export default function AudioChannel() {
  const token = useAtomValue(tokenAtom);
  const setLevel = useSetAtom(levelWriteAtom);
  const [items, setItems] = useState<AudioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeDetailId, setActiveDetailId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, { liked?: boolean; difficulty?: 'appropriate' | 'too_hard' | 'too_easy' }>>({});
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const routeAudioKey = searchParams.get('audio');
  const detailPushedRef = useRef(false);

  const detailKey = (item: AudioItem, idx: number): string => item.id || item.link || `audio-${idx}`;

  const syncAudioRoute = (item: AudioItem, idx: number, replace = false) => {
    const params = new URLSearchParams(location.search);
    params.set('audio', detailKey(item, idx));
    navigate(
      {
        pathname: location.pathname,
        search: `?${params.toString()}`,
      },
      { replace }
    );
  };

  const clearAudioRoute = (replace = false) => {
    const params = new URLSearchParams(location.search);
    params.delete('audio');
    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace }
    );
  };

  const refetchAudio = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      const t = localStorage.getItem('feedlingo-token');
      if (t) headers['Authorization'] = `Bearer ${t}`;
      const res = await fetch('/api/audio/recommend?debug=true', { headers });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json() as { items: AudioItem[] };
      setItems(data.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load. Try refreshing.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function fetchAudio() {
      const fetchWithRetry = async (retries = 2): Promise<Response> => {
        let lastErr: unknown;
        for (let i = 0; i <= retries; i++) {
          try {
            const headers: Record<string, string> = {};
            const t = localStorage.getItem('feedlingo-token');
            if (t) headers['Authorization'] = `Bearer ${t}`;
            const res = await fetch('/api/audio/recommend?debug=true', { headers });
            if (res.ok) return res;
            lastErr = new Error(res.status === 500 ? 'Server error' : 'Failed to fetch');
          } catch (e) {
            lastErr = e;
          }
          if (i < retries) await new Promise((r) => setTimeout(r, 3000));
        }
        throw lastErr;
      };
      try {
        const res = await fetchWithRetry();
        const data = await res.json() as { items: AudioItem[] };
        if (!cancelled) {
          setItems(data.items || []);
          const requestId = createRequestId();
          requestIdRef.current = requestId;
          void trackEvents((data.items || []).map((item, idx) => ({
            eventType: 'impression' as const,
            scene: 'audio' as const,
            itemId: item.id || item.link,
            itemType: 'audio_recommend',
            position: idx + 1,
            score: item.scores?.totalScore,
            requestId,
            metadata: { keywords: item.keywords || [] },
          })));
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load. Try refreshing.');
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchAudio();
    return () => { cancelled = true; };
  }, [token]);

  const handleFeedback = (item: AudioItem, key: 'liked' | 'difficulty', value: boolean | 'appropriate' | 'too_hard' | 'too_easy') => {
    const id = item.id || item.link || '';
    setFeedback((prev) => {
      const merged = key === 'liked'
        ? { ...prev[id], liked: value as boolean }
        : { ...prev[id], difficulty: value as 'appropriate' | 'too_hard' | 'too_easy' };
      const full = { ...prev[id], ...merged };
      submitArticleFeedback(articleKey(item), full.liked, full.difficulty, item.id).then((res) => {
        if (res) setLevel({ levelScore: res.levelScore, band: res.band, label: res.label, testCount: res.testCount, feedbackCount: res.feedbackCount });
      });
      return { ...prev, [id]: merged };
    });
  };

  const openDetail = (item: AudioItem, idx: number, options?: { syncRoute?: boolean }) => {
    const shouldSyncRoute = options?.syncRoute !== false;
    const id = itemId(item, idx);
    if (shouldSyncRoute) {
      detailPushedRef.current = true;
      syncAudioRoute(item, idx);
    }
    setActiveDetailId(id);
    void trackEvents([{
      eventType: 'click',
      scene: 'audio',
      itemId: item.id || item.link,
      itemType: 'audio_recommend',
      position: idx + 1,
      requestId: requestIdRef.current || undefined,
      metadata: { keywords: item.keywords || [] },
    }]);
  };

  const closeDetail = (options?: { syncRoute?: boolean }) => {
    const shouldSyncRoute = options?.syncRoute !== false;
    if (audioRef.current) {
      const sec = Math.round(audioRef.current.currentTime || 0);
      if (sec > 0) recordActivity(getTodayString(), 'listeningSeconds', sec);
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
    setExpandedId(null);
    setActiveDetailId(null);
    if (shouldSyncRoute) {
      if (detailPushedRef.current && window.history.length > 1) {
        detailPushedRef.current = false;
        navigate(-1);
      } else {
        detailPushedRef.current = false;
        clearAudioRoute(true);
      }
    }
  };

  const activeDetail = activeDetailId
    ? items.find((item, idx) => itemId(item, idx) === activeDetailId)
    : null;

  useEffect(() => {
    if (!activeDetailId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDetail();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeDetailId]);

  useEffect(() => {
    if (!routeAudioKey) {
      if (activeDetailId !== null) {
        closeDetail({ syncRoute: false });
      }
      return;
    }
    if (!items.length) return;
    const idx = items.findIndex((item, i) => detailKey(item, i) === routeAudioKey);
    if (idx < 0) return;
    const id = itemId(items[idx], idx);
    if (activeDetailId === id) return;
    detailPushedRef.current = false;
    openDetail(items[idx], idx, { syncRoute: false });
  }, [routeAudioKey, items]);

  if (loading) {
    return (
      <div className="content-wrap loading-stage">
        <div className="panel hero-panel mb-6">
          <h1 className="page-title mb-1">Audio</h1>
          <p className="page-subtitle">Preparing your listening feed...</p>
        </div>
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton-card">
              <div className="skeleton-line h-6 w-3/4 mb-3" />
              <div className="skeleton-line h-4 w-1/3 mb-3" />
              <div className="skeleton-line h-10 w-40" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="content-wrap">
        <div className="panel bg-amber-50/70 border-amber-200 p-6 text-center">
          <p className="text-amber-700">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="content-wrap">
      <div className="panel hero-panel mb-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="page-title mb-1">Audio</h1>
            <p className="page-subtitle">Listening practice with curated short-form content and feedback loop.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="status-chip success">Personalized</span>
            <span className="status-chip">{items.length} Loaded</span>
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="panel p-12 text-center empty-stage">
          <p className="page-subtitle mb-2">No audio recommendations available</p>
          <p className="text-sm text-slate-500 mb-5">Audio generation may still be running or sources are temporarily unavailable.</p>
          <button
            type="button"
            onClick={refetchAudio}
            className="px-5 py-2.5 btn-primary rounded-xl font-semibold text-white"
          >
            Retry loading
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {items.map((item, idx) => {
            const id = itemId(item, idx);

            return (
              <div
                key={id}
                className="panel content-surface overflow-hidden cursor-pointer"
                role="button"
                tabIndex={0}
                onClick={() => openDetail(item, idx)}
                onKeyDown={(e) => e.key === 'Enter' && openDetail(item, idx)}
              >
                <div className="content-card">
                  <h3 className="article-title mb-2">{item.title}</h3>
                  <div className="flex flex-wrap items-center gap-2 meta-line">
                    {item.source && (
                      <span className="source-chip">{item.source}</span>
                    )}
                    <span>{audioTimeText(item)}</span>
                    {typeof item.durationSeconds === 'number' && item.durationSeconds > 0 && (
                      <span className="source-chip">
                        {formatDuration(item.durationSeconds)}
                      </span>
                    )}
                  </div>
                  {item.keywords && item.keywords.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.keywords.map((kw, i) => (
                        <span
                          key={i}
                          className="keyword-chip"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Recommendation reason */}
                  {item.recommendationReason && (
                    <p className="mt-2 reason-text">
                      {item.recommendationReason}
                    </p>
                  )}
                  <div className="mt-3 body-preview line-clamp-2 article-text">
                    {item.simplified || item.description}
                  </div>
                  <div className="mt-2 inline-action">Tap to open player and text</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeDetail && (
        <div className="fixed inset-0 z-[90] bg-slate-950/45 backdrop-blur-[1px]">
          <div className="h-full overflow-y-auto">
            <div className="max-w-3xl mx-auto p-3 md:p-6">
              <div className="panel p-4 md:p-6">
                <div className="flex items-center justify-between mb-4">
                  <button
                    type="button"
                    onClick={() => closeDetail()}
                    className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 text-sm font-semibold"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    Back to feed
                  </button>
                  {activeDetail.link?.startsWith('http') && (
                    <a
                      href={activeDetail.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-action text-slate-600 hover:text-indigo-700"
                    >
                      Open source
                    </a>
                  )}
                </div>

                <h3 className="article-title mb-2">{activeDetail.title}</h3>
                <div className="flex flex-wrap items-center gap-2 meta-line">
                  {activeDetail.source && <span className="source-chip">{activeDetail.source}</span>}
                  <span>{audioTimeText(activeDetail)}</span>
                  {typeof activeDetail.durationSeconds === 'number' && activeDetail.durationSeconds > 0 && (
                    <span className="source-chip">{formatDuration(activeDetail.durationSeconds)}</span>
                  )}
                </div>

                {activeDetail.audioUrl && (
                  <div className="mt-5 flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        const currentId = activeDetailId;
                        if (!currentId) return;
                        if (playingId && playingId === currentId) {
                          const a = audioRef.current;
                          if (a) {
                            const sec = Math.round(a.currentTime || 0);
                            if (sec > 0) recordActivity(getTodayString(), 'listeningSeconds', sec);
                            a.pause();
                            audioRef.current = null;
                          }
                          setPlayingId(null);
                          return;
                        }

                        if (audioRef.current) {
                          audioRef.current.pause();
                          const prevSec = Math.round(audioRef.current.currentTime || 0);
                          if (prevSec > 0) recordActivity(getTodayString(), 'listeningSeconds', prevSec);
                          audioRef.current = null;
                        }
                        const audioUrl = activeDetail.audioUrl;
                        if (!audioUrl) return;
                        setAudioError(null);
                        void trackEvents([{
                          eventType: 'play_audio',
                          scene: 'audio',
                          itemId: activeDetail.id || activeDetail.link,
                          itemType: 'audio_recommend',
                          requestId: requestIdRef.current || undefined,
                          metadata: { keywords: activeDetail.keywords || [] },
                        }]);
                        const url = audioUrl.startsWith('http') ? audioUrl : `${window.location.origin}${audioUrl}`;
                        const audio = new Audio(url);
                        audioRef.current = audio;
                        audio.onerror = () => setAudioError('Failed to load audio. Try again or refresh.');
                        audio.onended = () => {
                          const sec = Math.round(audio.currentTime || audio.duration || 0);
                          if (sec > 0) recordActivity(getTodayString(), 'listeningSeconds', sec);
                          void trackEvents([{
                            eventType: 'complete_audio',
                            scene: 'audio',
                            itemId: activeDetail.id || activeDetail.link,
                            itemType: 'audio_recommend',
                            requestId: requestIdRef.current || undefined,
                            metadata: { keywords: activeDetail.keywords || [] },
                          }]);
                          audioRef.current = null;
                          setPlayingId(null);
                        };
                        audio.play();
                        setPlayingId(currentId);
                      }}
                      className="inline-flex items-center gap-2 px-5 py-3 btn-primary text-white rounded-xl font-semibold transition-colors"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      {playingId === activeDetailId ? 'Pause' : 'Play'}
                    </button>
                    <span className="text-sm page-subtitle">
                      {typeof activeDetail.durationSeconds === 'number'
                        ? `${formatDuration(activeDetail.durationSeconds)} · Listen first, then read`
                        : 'Listen first, then read'}
                    </span>
                    {audioError && <span className="text-sm text-amber-600">{audioError}</span>}
                  </div>
                )}

                <div className="mt-5">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === activeDetailId ? null : activeDetailId)}
                    className="text-sm text-indigo-600 font-medium hover:text-indigo-700"
                  >
                    {expandedId === activeDetailId ? '▲ Hide text' : '▼ Show text'}
                  </button>
                  {expandedId === activeDetailId && (
                    <div className="mt-3 p-4 bg-slate-50 rounded-xl text-slate-700 text-sm article-text leading-relaxed">
                      {formatTextWithParagraphs(activeDetail.simplified || activeDetail.description || '')}
                    </div>
                  )}
                </div>

                <div className="section-divider" />
                <div className="text-xs text-slate-500 mb-2">Optional feedback after listening</div>
                <div className="feedback-row">
                  <div className="feedback-group feedback-group-2">
                    <span className="feedback-label">Preference</span>
                    <button
                      type="button"
                      onClick={() => handleFeedback(activeDetail, 'liked', true)}
                      className={`feedback-btn ${feedback[activeDetailId || '']?.liked === true ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'feedback-btn-neutral'}`}
                      aria-pressed={feedback[activeDetailId || '']?.liked === true}
                    >
                      {feedback[activeDetailId || '']?.liked === true ? '✓ Like' : 'Like'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFeedback(activeDetail, 'liked', false)}
                      className={`feedback-btn ${feedback[activeDetailId || '']?.liked === false ? 'bg-rose-100 text-rose-700 border border-rose-200' : 'feedback-btn-neutral'}`}
                      aria-pressed={feedback[activeDetailId || '']?.liked === false}
                    >
                      {feedback[activeDetailId || '']?.liked === false ? '✓ Dislike' : 'Dislike'}
                    </button>
                  </div>
                  <span className="feedback-divider" />
                  <div className="feedback-group feedback-group-3">
                    <span className="feedback-label">Difficulty</span>
                    <button
                      type="button"
                      onClick={() => handleFeedback(activeDetail, 'difficulty', 'appropriate')}
                      className={`feedback-btn ${feedback[activeDetailId || '']?.difficulty === 'appropriate' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'feedback-btn-neutral'}`}
                      aria-pressed={feedback[activeDetailId || '']?.difficulty === 'appropriate'}
                    >
                      {feedback[activeDetailId || '']?.difficulty === 'appropriate' ? '✓ On level' : 'On level'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFeedback(activeDetail, 'difficulty', 'too_hard')}
                      className={`feedback-btn ${feedback[activeDetailId || '']?.difficulty === 'too_hard' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'feedback-btn-neutral'}`}
                      aria-pressed={feedback[activeDetailId || '']?.difficulty === 'too_hard'}
                    >
                      {feedback[activeDetailId || '']?.difficulty === 'too_hard' ? '✓ Too hard' : 'Too hard'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFeedback(activeDetail, 'difficulty', 'too_easy')}
                      className={`feedback-btn ${feedback[activeDetailId || '']?.difficulty === 'too_easy' ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'feedback-btn-neutral'}`}
                      aria-pressed={feedback[activeDetailId || '']?.difficulty === 'too_easy'}
                    >
                      {feedback[activeDetailId || '']?.difficulty === 'too_easy' ? '✓ Too easy' : 'Too easy'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => closeDetail()}
            className="fixed right-4 md:right-6 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-[95] w-12 h-12 rounded-full btn-primary text-white shadow-lg inline-flex items-center justify-center"
            aria-label="Back to feed"
            title="Back to feed"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
