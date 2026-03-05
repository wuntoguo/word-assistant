import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useSetAtom, useAtomValue } from 'jotai';
import { levelWriteAtom, recordActivity, tokenAtom } from '../store';
import { getTodayString, formatArticleDate } from '../utils';
import { submitArticleFeedback, fetchRecommend } from '../api';
import type { RecommendArticle } from '../api';
import { createRequestId, trackEvents } from '../events';

function articleKey(article: { title: string; link: string }): string {
  return article.link || article.title || '';
}

interface Article {
  id?: string;
  title: string;
  link: string;
  pubDate: string;
  postedAt?: string | null;
  crawledAt?: string | null;
  description: string;
  simplified: string;
  source?: string;
  keywords?: string[];
  recommendationReason?: string;
  scores?: {
    interestScore: number;
    difficultyScore: number;
    totalScore: number;
    interestReason: string;
    difficultyReason: string;
    freshnessScore?: number;
    showCount?: number;
    adjustedTotal?: number;
  };
}

interface ArticleContent {
  title: string;
  content: string;
  simplified: string;
  siteName?: string;
}

const MIN_VALID_READ_SECONDS = 8;


export default function Discovery() {
  const [articles, setArticles] = useState<Article[]>([]);
  const setLevel = useSetAtom(levelWriteAtom);
  const token = useAtomValue(tokenAtom);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRecommendFeed, setIsRecommendFeed] = useState(false);
  const [debugInfo, setDebugInfo] = useState<{ status: string; error?: string; hasToken: boolean; articleCount: number; firstArticleHasScores?: boolean; firstArticleReason?: string } | null>(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const showDebugPanel = searchParams.get('debug') === '1';
  const routeArticleKey = searchParams.get('article');
  const [expandedOriginal, setExpandedOriginal] = useState<Record<number, boolean>>({});
  const [fullContent, setFullContent] = useState<Record<number, ArticleContent | 'loading' | null>>({});
  const [feedback, setFeedback] = useState<Record<number, { liked?: boolean; difficulty?: 'appropriate' | 'too_hard' | 'too_easy' }>>({});
  const [activeReaderIdx, setActiveReaderIdx] = useState<number | null>(null);
  const detailPushedRef = useRef(false);
  const recordedReadKeys = useRef<Set<string>>(new Set());
  const lastRequestIdRef = useRef<string | null>(null);
  const activeReadSessions = useRef<Map<string, {
    startedAt: number;
    wordCount: number;
    idx: number;
    article: Article;
    itemType: 'recommend' | 'discovery' | 'vocab_story';
    requestId?: string;
  }>>(new Map());

  const refetchCurrent = () => {
    if (token) return fetchRecommendArticles();
    return fetchArticles();
  };

  const articleTimeText = (article: Article): string => {
    const posted = article.postedAt || article.pubDate;
    if (posted) return `Posted ${formatArticleDate(posted, { withTime: true })}`;
    if (article.crawledAt) return `Crawled ${formatArticleDate(article.crawledAt, { withTime: true })}`;
    return 'Posted —';
  };

  const getItemType = (article: Article): 'recommend' | 'discovery' | 'vocab_story' =>
    article.link?.startsWith('feedlingo://') ? 'vocab_story' : (isRecommendFeed ? 'recommend' : 'discovery');

  const articleDetailKey = (article: Article): string => article.id || article.link || article.title;

  const syncArticleRoute = (article: Article, replace = false) => {
    const params = new URLSearchParams(location.search);
    params.set('article', articleDetailKey(article));
    navigate(
      {
        pathname: location.pathname,
        search: `?${params.toString()}`,
      },
      { replace }
    );
  };

  const clearArticleRoute = (replace = false) => {
    const params = new URLSearchParams(location.search);
    params.delete('article');
    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace }
    );
  };

  const startReadSession = (idx: number, article: Article, content: ArticleContent) => {
    const key = articleKey(article);
    if (!key || activeReadSessions.current.has(key)) return;
    const wordCount = (content.simplified.match(/\S+/g) || []).length;
    activeReadSessions.current.set(key, {
      startedAt: Date.now(),
      wordCount,
      idx,
      article,
      itemType: getItemType(article),
      requestId: lastRequestIdRef.current || undefined,
    });
  };

  const flushReadSession = (article: Article) => {
    const key = articleKey(article);
    const session = key ? activeReadSessions.current.get(key) : undefined;
    if (!session) return;
    activeReadSessions.current.delete(key);

    const durationSec = Math.round((Date.now() - session.startedAt) / 1000);
    if (durationSec <= 0) return;
    if (durationSec < MIN_VALID_READ_SECONDS) return;

    const today = getTodayString();
    recordActivity(today, 'readingSeconds', durationSec);

    if (!recordedReadKeys.current.has(key)) {
      recordedReadKeys.current.add(key);
      recordActivity(today, 'reads', 1);
      recordActivity(today, 'readingWords', session.wordCount);
    }

    void trackEvents([{
      eventType: 'dwell_time',
      scene: 'article',
      itemId: session.article.id || session.article.link,
      itemType: session.itemType,
      position: session.idx + 1,
      dwellMs: Math.max(0, durationSec * 1000),
      requestId: session.requestId,
      metadata: {
        keywords: session.article.keywords || [],
        wordCount: session.wordCount,
      },
    }]);
  };

  const fetchWithRetry = async (url: string, opts?: RequestInit, retries = 2): Promise<Response> => {
    let lastErr: unknown;
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await fetch(url, opts);
        if (res.ok || res.status < 500) return res;
        lastErr = new Error(`Server error: ${res.status}`);
      } catch (e) {
        lastErr = e;
      }
      if (i < retries) await new Promise((r) => setTimeout(r, 3000));
    }
    throw lastErr;
  };

  const fetchArticles = async (append = false) => {
    const offset = append ? articles.length : 0;
    try {
      if (!append) {
        for (const s of Array.from(activeReadSessions.current.values())) flushReadSession(s.article);
      }
      if (!append) setLoading(true);
      else setLoadingMore(true);
      const res = await fetchWithRetry(`/api/discovery/articles?offset=${offset}&limit=10`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json() as { articles: Article[]; hasMore: boolean };
      if (append) {
        setArticles((prev) => [...prev, ...(data.articles || [])]);
      } else {
        setArticles(data.articles || []);
      }
      const requestId = createRequestId();
      lastRequestIdRef.current = requestId;
      void trackEvents((data.articles || []).map((a, idx) => ({
        eventType: 'impression' as const,
        scene: 'article' as const,
        itemId: a.id || a.link,
        itemType: 'discovery',
        position: offset + idx + 1,
        requestId,
        metadata: { keywords: a.keywords || [] },
      })));
      setHasMore(data.hasMore ?? false);
      setIsRecommendFeed(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load articles. Try refreshing.');
      if (!append) setArticles([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const fetchRecommendArticles = async (append = false) => {
    const hasToken = !!localStorage.getItem('feedlingo-token');
    try {
      if (!append) {
        for (const s of Array.from(activeReadSessions.current.values())) flushReadSession(s.article);
      }
      if (!append) setLoading(true);
      else setLoadingMore(true);
      const offset = append ? articles.length : 0;
      const limit = append ? 10 : 10;
      const data = await fetchRecommend(limit, offset, showDebugPanel);
      if (data?.articles?.length) {
        const mapped: Article[] = data.articles.map((a) => ({
          id: a.id,
          title: a.title,
          link: a.link,
          pubDate: a.pubDate,
          postedAt: a.postedAt,
          crawledAt: a.crawledAt,
          description: a.description,
          simplified: a.simplified,
          source: a.source,
          keywords: a.keywords,
          recommendationReason: a.recommendationReason,
          scores: a.scores,
        }));
        if (append) {
          setArticles((prev) => [...prev, ...mapped]);
        } else {
          setArticles(mapped);
        }
        const requestId = createRequestId();
        lastRequestIdRef.current = requestId;
        void trackEvents(data.articles.map((a, idx) => ({
          eventType: 'impression' as const,
          scene: 'article' as const,
          itemId: a.id || a.link,
          itemType: a.link?.startsWith('feedlingo://') ? 'vocab_story' : 'recommend',
          position: offset + idx + 1,
          score: a.scores?.totalScore,
          requestId,
          metadata: { keywords: a.keywords || [] },
        })));
        // Never mix discovery with recommend: show only personalized, "No more" when exhausted
        setHasMore(data.hasMore ?? false);
        setIsRecommendFeed(true);
        if (showDebugPanel) {
          const first = data.articles[0];
          setDebugInfo({
            status: 'success',
            hasToken,
            articleCount: data.articles.length,
            firstArticleHasScores: !!first?.scores,
            firstArticleReason: first?.recommendationReason?.slice(0, 80) ?? (first ? 'missing' : 'n/a'),
          });
        }
      } else if (!append) {
        setIsRecommendFeed(false);
        if (showDebugPanel) setDebugInfo({ status: 'fallback-empty', hasToken, articleCount: 0, error: data ? 'articles array empty' : 'data is null' });
        await fetchArticles();
        return;
      } else if (append && (!data?.articles?.length || data.articles.length === 0)) {
        // Recommend exhausted, try discovery as fallback
        await fetchArticles(true);
        return;
      } else {
        setHasMore(false);
      }
      setError(null);
    } catch (e) {
      setIsRecommendFeed(false);
      if (showDebugPanel) setDebugInfo({ status: 'error', hasToken, articleCount: 0, error: e instanceof Error ? e.message : String(e) });
      if (!append) await fetchArticles();
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchRecommendArticles();
    } else {
      if (showDebugPanel) setDebugInfo({ status: 'no-token', hasToken: false, articleCount: 0 });
      fetchArticles();
    }
  }, [token]);

  const loadFullContent = async (idx: number, article: Article, options?: { syncRoute?: boolean }) => {
    const shouldSyncRoute = options?.syncRoute !== false;
    if (shouldSyncRoute) {
      detailPushedRef.current = true;
      syncArticleRoute(article);
    }
    setActiveReaderIdx(idx);
    if (fullContent[idx]) {
      if (fullContent[idx] !== 'loading' && fullContent[idx] !== null) {
        startReadSession(idx, article, fullContent[idx] as ArticleContent);
      }
      return;
    }
    void trackEvents([{
      eventType: 'click',
      scene: 'article',
      itemId: article.id || article.link,
      itemType: article.link?.startsWith('feedlingo://') ? 'vocab_story' : (isRecommendFeed ? 'recommend' : 'discovery'),
      position: idx + 1,
      requestId: lastRequestIdRef.current || undefined,
      metadata: { keywords: article.keywords || [] },
    }]);
    setFullContent((prev) => ({ ...prev, [idx]: 'loading' }));
    try {
      let data: ArticleContent;
      if (article.id) {
        const res = await fetch(`/api/discovery/article-by-id/${article.id}`);
        if (!res.ok) throw new Error('Failed');
        data = await res.json() as ArticleContent;
      } else {
        const params = new URLSearchParams({ url: article.link });
        if (article.description) params.set('fallback', article.description);
        const res = await fetch(`/api/discovery/article-content?${params.toString()}`);
        if (!res.ok) throw new Error('Failed');
        data = await res.json() as ArticleContent;
      }
      setFullContent((prev) => ({ ...prev, [idx]: data }));
      startReadSession(idx, article, data);
    } catch {
      setFullContent((prev) => ({ ...prev, [idx]: null }));
    }
  };

  const toggleOriginal = (idx: number) => {
    setExpandedOriginal((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const dismissFullContent = (idx: number, options?: { syncRoute?: boolean }) => {
    const article = articles[idx];
    if (article) flushReadSession(article);
    setActiveReaderIdx(null);
    if (options?.syncRoute !== false) {
      if (detailPushedRef.current && window.history.length > 1) {
        detailPushedRef.current = false;
        navigate(-1);
      } else {
        detailPushedRef.current = false;
        clearArticleRoute(true);
      }
    }
  };

  const setArticleFeedback = (idx: number, key: 'liked' | 'difficulty', value: boolean | 'appropriate' | 'too_hard' | 'too_easy') => {
    const article = articles[idx];
    setFeedback((prev) => {
      const merged = key === 'liked'
        ? { ...prev[idx], liked: value as boolean }
        : { ...prev[idx], difficulty: value as 'appropriate' | 'too_hard' | 'too_easy' };
      Promise.resolve().then(() => {
        const feedbackEventType = merged.liked === true ? 'like' : merged.liked === false ? 'dislike' : null;
        if (feedbackEventType) {
          void trackEvents([{
            eventType: feedbackEventType,
            scene: 'article',
            itemId: article.id || article.link,
            itemType: article.link?.startsWith('feedlingo://') ? 'vocab_story' : (isRecommendFeed ? 'recommend' : 'discovery'),
            position: idx + 1,
            requestId: lastRequestIdRef.current || undefined,
            metadata: { difficulty: merged.difficulty || null, keywords: article.keywords || [] },
          }]);
        }
        submitArticleFeedback(articleKey(article), merged.liked, merged.difficulty, article.id).then((res) => {
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
      });
      return { ...prev, [idx]: merged };
    });
  };

  useEffect(() => {
    const flushAll = () => {
      for (const s of Array.from(activeReadSessions.current.values())) flushReadSession(s.article);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushAll();
    };
    window.addEventListener('beforeunload', flushAll);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      flushAll();
      window.removeEventListener('beforeunload', flushAll);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (activeReaderIdx === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissFullContent(activeReaderIdx);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeReaderIdx]);

  useEffect(() => {
    if (!routeArticleKey) {
      if (activeReaderIdx !== null) {
        dismissFullContent(activeReaderIdx, { syncRoute: false });
      }
      return;
    }
    if (!articles.length) return;
    const idx = articles.findIndex((a) => articleDetailKey(a) === routeArticleKey);
    if (idx < 0) return;
    if (activeReaderIdx === idx) return;
    detailPushedRef.current = false;
    void loadFullContent(idx, articles[idx], { syncRoute: false });
  }, [routeArticleKey, articles]);

  if (loading) {
    return (
      <div className="content-wrap loading-stage">
        <div className="panel hero-panel mb-6">
          <h1 className="page-title mb-1">Discover</h1>
          <p className="page-subtitle">Preparing your reading feed...</p>
        </div>
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton-card">
              <div className="skeleton-line h-6 w-4/5 mb-3" />
              <div className="skeleton-line h-4 w-2/5 mb-2" />
              <div className="skeleton-line h-4 w-full mb-2" />
              <div className="skeleton-line h-4 w-11/12" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="content-wrap">
        <div className="panel p-6 text-center bg-amber-50/70">
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
            <h1 className="page-title mb-1">Discover</h1>
            <p className="page-subtitle">
              {isRecommendFeed ? 'Personalized reading feed tuned by your level and interests.' : token ? 'Personalized feed unavailable. Showing high-quality general articles.' : 'General feed. Sign in for personalized ranking and feedback loops.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`status-chip ${isRecommendFeed ? 'success' : token ? 'warning' : ''}`}>
              {isRecommendFeed ? 'Personalized' : 'General Feed'}
            </span>
            <span className="status-chip">{articles.length} Loaded</span>
          </div>
        </div>
        {showDebugPanel && debugInfo && (
          <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-left text-sm font-mono max-w-xl mx-auto">
            <div className="font-semibold text-amber-800 mb-2">Debug (?debug=1)</div>
            <div>status: {debugInfo.status}</div>
            <div>hasToken: {String(debugInfo.hasToken)}</div>
            <div>token (from atom): {token ? 'yes' : 'no'}</div>
            <div>articleCount: {debugInfo.articleCount}</div>
            {debugInfo.firstArticleHasScores !== undefined && <div>firstArticleHasScores: {String(debugInfo.firstArticleHasScores)}</div>}
            {debugInfo.firstArticleReason !== undefined && <div>firstArticleReason: {debugInfo.firstArticleReason}</div>}
            {debugInfo.error && <div className="text-red-600">error: {debugInfo.error}</div>}
            <div className="mt-2 text-amber-600 text-xs">Remove ?debug=1 from URL to hide</div>
          </div>
        )}
      </div>

      {articles.length === 0 ? (
        <div className="panel p-12 text-center empty-stage">
          <p className="page-subtitle mb-2">No articles available right now.</p>
          <p className="text-sm text-slate-500 mb-5">This can happen when sources are temporarily unavailable or still refreshing.</p>
          <button
            type="button"
            onClick={refetchCurrent}
            className="px-5 py-2.5 btn-primary rounded-xl font-semibold text-white"
          >
            Refresh feed
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-6">
            {articles.map((article, idx) => (
              <article
                key={idx}
                className="panel content-surface overflow-hidden"
              >
                <div className="content-card">
                  {/* Clickable title block - use div to avoid invalid <a> inside <button> */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => loadFullContent(idx, article)}
                    onKeyDown={(e) => e.key === 'Enter' && loadFullContent(idx, article)}
                    className="w-full text-left cursor-pointer outline-none focus:ring-2 focus:ring-indigo-300 focus:ring-inset rounded-lg"
                    aria-label={`Open article: ${article.title}`}
                  >
                    <h2 className="article-title transition-colors">
                      {article.title}
                    </h2>
                    {(article.recommendationReason || article.scores || (article.keywords && article.keywords.length > 0)) && (
                      <div className="mt-2.5">
                        <p className="reason-text">
                          {article.recommendationReason || (article.scores ? `Interest: ${article.scores.interestScore}. Difficulty: ${article.scores.difficultyScore}. Total: ${article.scores.totalScore.toFixed(0)} (0.4×interest + 0.6×difficulty)` : article.link?.startsWith('feedlingo://') ? 'Interest: 90. Difficulty: 100. Total: 96 (0.4×interest + 0.6×difficulty)' : 'Interest: 50. Difficulty: 50. Total: 50 (0.4×interest + 0.6×difficulty)')}
                        </p>
                        {article.keywords && article.keywords.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {article.keywords.map((kw, i) => (
                              <span
                                key={i}
                                className="keyword-chip"
                              >
                                {kw}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 meta-line mt-2.5">
                      {article.source && (
                        <span className="source-chip">{article.source}</span>
                      )}
                      <span>{articleTimeText(article)}</span>
                    </div>
                    <div className="body-preview line-clamp-3 article-text">
                      {article.simplified}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {(article.link || article.id) && (
                        <span className="inline-action">
                          Read full article
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </span>
                      )}
                      {article.link?.startsWith('http') && (
                        <a
                          href={article.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-action text-slate-600 hover:text-indigo-700"
                        >
                          Open in new tab
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {/* Read more button - always visible at bottom */}
          <div id="read-more" className="mt-10 mb-12 py-10 px-6 panel text-center">
            {hasMore ? (
              <button
                type="button"
                onClick={() => (token ? fetchRecommendArticles(true) : fetchArticles(true))}
                disabled={loadingMore}
                className="px-8 py-3 btn-primary rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
              >
                {loadingMore ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Loading&hellip;
                  </>
                ) : (
                  'Read more'
                )}
              </button>
            ) : (
              <p className="text-sm page-subtitle">No more articles for now. Check back later for new recommendations.</p>
            )}
          </div>
        </>
      )}

      {activeReaderIdx !== null && articles[activeReaderIdx] && (
        <div className="fixed inset-0 z-[90] bg-slate-950/45 backdrop-blur-[1px]">
          <div className="h-full overflow-y-auto">
            <div className="max-w-3xl mx-auto p-3 md:p-6">
              <div className="panel p-4 md:p-6">
                <div className="flex items-center justify-between mb-4">
                  <button
                    type="button"
                    onClick={() => dismissFullContent(activeReaderIdx)}
                    className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 text-sm font-semibold"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    Back to feed
                  </button>
                  {articles[activeReaderIdx].link?.startsWith('http') && (
                    <a
                      href={articles[activeReaderIdx].link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-action text-slate-600 hover:text-indigo-700"
                    >
                      Open source
                    </a>
                  )}
                </div>

                <h2 className="article-title">{articles[activeReaderIdx].title}</h2>
                <div className="flex flex-wrap items-center gap-2 meta-line mt-2.5">
                  {articles[activeReaderIdx].source && <span className="source-chip">{articles[activeReaderIdx].source}</span>}
                  <span>{articleTimeText(articles[activeReaderIdx])}</span>
                </div>

                {fullContent[activeReaderIdx] === 'loading' && (
                  <div className="mt-8 flex items-center gap-2 text-slate-500">
                    <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    Loading full article&hellip;
                  </div>
                )}

                {fullContent[activeReaderIdx] === null && (
                  <div className="mt-6 p-4 bg-amber-50 rounded-xl">
                    <p className="text-amber-700 text-sm">Could not load full article for in-app reading.</p>
                  </div>
                )}

                {fullContent[activeReaderIdx] && fullContent[activeReaderIdx] !== 'loading' && fullContent[activeReaderIdx] !== null && (
                  <div className="mt-6">
                    <div className="text-sm font-medium text-slate-500 mb-3">Simplified for reading</div>
                    <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed whitespace-pre-wrap article-text">
                      {(fullContent[activeReaderIdx] as ArticleContent).simplified}
                    </div>
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => toggleOriginal(activeReaderIdx)}
                        className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                      >
                        {expandedOriginal[activeReaderIdx] ? 'Hide' : 'Show'} original text
                      </button>
                      {expandedOriginal[activeReaderIdx] && (
                        <div className="mt-2 p-4 bg-slate-50 rounded-xl text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                          {(fullContent[activeReaderIdx] as ArticleContent).content}
                        </div>
                      )}
                    </div>

                    <div className="section-divider" />
                    <div className="text-xs text-slate-500 mb-2">Optional feedback after reading</div>
                    <div className="feedback-row">
                      <div className="feedback-group feedback-group-2">
                        <span className="feedback-label">Preference</span>
                        <button
                          type="button"
                          onClick={() => setArticleFeedback(activeReaderIdx, 'liked', true)}
                          className={`feedback-btn ${feedback[activeReaderIdx]?.liked === true ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'feedback-btn-neutral'}`}
                          aria-pressed={feedback[activeReaderIdx]?.liked === true}
                        >
                          {feedback[activeReaderIdx]?.liked === true ? '✓ Like' : 'Like'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setArticleFeedback(activeReaderIdx, 'liked', false)}
                          className={`feedback-btn ${feedback[activeReaderIdx]?.liked === false ? 'bg-rose-100 text-rose-700 border border-rose-200' : 'feedback-btn-neutral'}`}
                          aria-pressed={feedback[activeReaderIdx]?.liked === false}
                        >
                          {feedback[activeReaderIdx]?.liked === false ? '✓ Dislike' : 'Dislike'}
                        </button>
                      </div>
                      <span className="feedback-divider" />
                      <div className="feedback-group feedback-group-3">
                        <span className="feedback-label">Difficulty</span>
                        <button
                          type="button"
                          onClick={() => setArticleFeedback(activeReaderIdx, 'difficulty', 'appropriate')}
                          className={`feedback-btn ${feedback[activeReaderIdx]?.difficulty === 'appropriate' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'feedback-btn-neutral'}`}
                          aria-pressed={feedback[activeReaderIdx]?.difficulty === 'appropriate'}
                        >
                          {feedback[activeReaderIdx]?.difficulty === 'appropriate' ? '✓ On level' : 'On level'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setArticleFeedback(activeReaderIdx, 'difficulty', 'too_hard')}
                          className={`feedback-btn ${feedback[activeReaderIdx]?.difficulty === 'too_hard' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'feedback-btn-neutral'}`}
                          aria-pressed={feedback[activeReaderIdx]?.difficulty === 'too_hard'}
                        >
                          {feedback[activeReaderIdx]?.difficulty === 'too_hard' ? '✓ Too hard' : 'Too hard'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setArticleFeedback(activeReaderIdx, 'difficulty', 'too_easy')}
                          className={`feedback-btn ${feedback[activeReaderIdx]?.difficulty === 'too_easy' ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'feedback-btn-neutral'}`}
                          aria-pressed={feedback[activeReaderIdx]?.difficulty === 'too_easy'}
                        >
                          {feedback[activeReaderIdx]?.difficulty === 'too_easy' ? '✓ Too easy' : 'Too easy'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => dismissFullContent(activeReaderIdx)}
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
