import React, { useState, useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { recordActivity } from '../store';
import { getTodayString } from '../utils';
import { tokenAtom } from '../store';

interface AudioItem {
  id?: string;
  title: string;
  link: string;
  audioUrl?: string;
  durationSeconds?: number;
  keywords?: string[];
  pubDate: string;
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

function formatDate(pubDate: string): string {
  try {
    const d = new Date(pubDate);
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return pubDate;
  }
}

export default function AudioChannel() {
  const token = useAtomValue(tokenAtom);
  const [items, setItems] = useState<AudioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, { liked?: boolean; hard?: boolean }>>({});
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  const handleFeedback = (id: string, key: 'liked' | 'hard', value: boolean) => {
    setFeedback((prev) => ({
      ...prev,
      [id]: { ...prev[id], [key]: value },
    }));
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <div className="inline-block w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-500">Loading audio recommendations…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <p className="text-amber-700">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">Audio</h1>
        <p className="text-slate-500">Listening practice with personalized recommendations</p>
      </div>

      {items.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center">
          <div className="text-5xl mb-4">&#128266;</div>
          <p className="text-slate-500 mb-2">No audio recommendations available</p>
          <p className="text-sm text-slate-400">Audio is generated automatically. Try refreshing in a minute.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {items.map((item, idx) => {
            const id = item.id || item.link || `audio-${idx}`;
            const isPlaying = playingId === id;
            const isExpanded = expandedId === id;
            const fb = feedback[id];
            const content = item.simplified || item.description || '';

            return (
              <div
                key={id}
                className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden"
              >
                <div className="p-6">
                  {/* Title + meta */}
                  <h3 className="font-bold text-slate-800 mb-2">{item.title}</h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    {item.source && (
                      <span className="px-2 py-1 bg-slate-100 rounded-full">{item.source}</span>
                    )}
                    <span>{formatDate(item.pubDate)}</span>
                    {typeof item.durationSeconds === 'number' && item.durationSeconds > 0 && (
                      <span className="px-2 py-1 bg-indigo-50 text-indigo-600 rounded-full">
                        {formatDuration(item.durationSeconds)}
                      </span>
                    )}
                  </div>
                  {item.keywords && item.keywords.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.keywords.map((kw, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 text-xs bg-slate-100 text-slate-600 rounded-md"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Recommendation reason */}
                  {item.recommendationReason && (
                    <p className="mt-2 text-sm text-indigo-600 font-medium">
                      {item.recommendationReason}
                    </p>
                  )}

                  {/* Audio player - primary, always visible */}
                  {item.audioUrl && (
                    <div className="mt-4 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (isPlaying && playingId === id) {
                            const a = audioRef.current;
                            if (a) {
                              const sec = Math.round(a.currentTime || 0);
                              if (sec > 0) recordActivity(getTodayString(), 'listeningSeconds', sec);
                              a.pause();
                              audioRef.current = null;
                            }
                            setPlayingId(null);
                          } else {
                            if (audioRef.current) {
                              audioRef.current.pause();
                              const prevSec = Math.round(audioRef.current.currentTime || 0);
                              if (prevSec > 0) recordActivity(getTodayString(), 'listeningSeconds', prevSec);
                              audioRef.current = null;
                            }
                            const audioUrl = item.audioUrl;
                            if (!audioUrl) return;
                            setAudioError(null);
                            const url = audioUrl.startsWith('http') ? audioUrl : `${window.location.origin}${audioUrl}`;
                            const audio = new Audio(url);
                            audioRef.current = audio;
                            audio.onerror = () => {
                              setAudioError('Failed to load audio. Try again or refresh.');
                            };
                            audio.onended = () => {
                              const sec = Math.round(audio.currentTime || audio.duration || 0);
                              if (sec > 0) recordActivity(getTodayString(), 'listeningSeconds', sec);
                              audioRef.current = null;
                              setPlayingId(null);
                            };
                            audio.play();
                            setPlayingId(id);
                          }
                        }}
                        className="inline-flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors"
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                        {isPlaying ? 'Pause' : 'Play'}
                      </button>
                      <span className="text-sm text-slate-500">
                        {typeof item.durationSeconds === 'number'
                          ? `${formatDuration(item.durationSeconds)} · Listen first, then expand to read`
                          : 'Listen first, then expand to read'}
                      </span>
                      {audioError && (
                        <span className="text-sm text-amber-600">{audioError}</span>
                      )}
                    </div>
                  )}

                  {/* Collapsible text */}
                  {content && (
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : id)}
                        className="text-sm text-indigo-600 font-medium hover:text-indigo-700"
                      >
                        {isExpanded ? '▲ Hide text' : '▼ Show text'}
                      </button>
                      {isExpanded && (
                        <div className="mt-2 p-4 bg-slate-50 rounded-xl text-slate-700 text-sm">
                          {formatTextWithParagraphs(content)}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    {item.link?.startsWith('http') && (
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-indigo-600"
                      >
                        Read full article
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    )}
                    <div className="flex gap-2 ml-auto">
                      <button
                        type="button"
                        onClick={() => handleFeedback(id, 'liked', fb?.liked !== true)}
                        className={`px-3 py-1.5 rounded-lg text-sm ${fb?.liked ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                      >
                        {fb?.liked ? '✓ Like' : 'Like'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFeedback(id, 'hard', fb?.hard !== true)}
                        className={`px-3 py-1.5 rounded-lg text-sm ${fb?.hard ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                      >
                        {fb?.hard ? '✓ Too hard' : 'Too hard'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
