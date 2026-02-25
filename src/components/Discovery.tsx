import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSetAtom, useAtomValue } from 'jotai';
import { levelWriteAtom, recordActivity, tokenAtom } from '../store';
import { getTodayString, formatArticleDate } from '../utils';
import { submitArticleFeedback, fetchRecommend } from '../api';
import type { RecommendArticle } from '../api';

function articleKey(article: { title: string; link: string }): string {
  return article.link || article.title || '';
}

interface Article {
  id?: string;
  title: string;
  link: string;
  pubDate: string;
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
  const showDebugPanel = searchParams.get('debug') === '1';
  const [expandedOriginal, setExpandedOriginal] = useState<Record<number, boolean>>({});
  const [fullContent, setFullContent] = useState<Record<number, ArticleContent | 'loading' | null>>({});
  const [fullContentLoadTime, setFullContentLoadTime] = useState<Record<number, number>>({});
  const [feedback, setFeedback] = useState<Record<number, { liked?: boolean; difficulty?: 'appropriate' | 'too_hard' | 'too_easy' }>>({});
  const recordedReadKeys = useRef<Set<string>>(new Set());

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
      if (!append) setLoading(true);
      else setLoadingMore(true);
      const offset = append ? articles.length : 0;
      const limit = append ? 10 : 10;
      const data = await fetchRecommend(limit, offset);
      if (data?.articles?.length) {
        const mapped: Article[] = data.articles.map((a) => ({
          id: a.id,
          title: a.title,
          link: a.link,
          pubDate: a.pubDate,
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

  const loadFullContent = async (idx: number, article: Article) => {
    if (fullContent[idx]) return;
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
      setFullContentLoadTime((prev) => ({ ...prev, [idx]: Date.now() }));
    } catch {
      setFullContent((prev) => ({ ...prev, [idx]: null }));
    }
  };

  const toggleOriginal = (idx: number) => {
    setExpandedOriginal((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const dismissFullContent = (idx: number) => {
    setFullContent((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  };

  const setArticleFeedback = (idx: number, key: 'liked' | 'difficulty', value: boolean | 'appropriate' | 'too_hard' | 'too_easy') => {
    const article = articles[idx];
    const loadTime = fullContentLoadTime[idx];
    const content = fullContent[idx];
    setFeedback((prev) => {
      const merged = key === 'liked'
        ? { ...prev[idx], liked: value as boolean }
        : { ...prev[idx], difficulty: value as 'appropriate' | 'too_hard' | 'too_easy' };
      Promise.resolve().then(() => {
        const key = articleKey(article);
        if (!recordedReadKeys.current.has(key) && typeof content === 'object' && content?.simplified && loadTime) {
          recordedReadKeys.current.add(key);
          const today = getTodayString();
          const durationSec = Math.round((Date.now() - loadTime) / 1000);
          const wordCount = (content.simplified.match(/\S+/g) || []).length;
          recordActivity(today, 'reads', 1);
          recordActivity(today, 'readingSeconds', durationSec);
          recordActivity(today, 'readingWords', wordCount);
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

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <div className="inline-block w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-500">Loading today&apos;s tech news&hellip;</p>
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
        <h1 className="text-3xl font-bold text-slate-800 mb-2">Discover</h1>
        <p className="text-slate-500">
          {isRecommendFeed ? 'Recommended for you · with scores' : token ? 'Could not load recommendations · showing general feed' : 'General feed · Log in for personalized recommendations with scores'}
        </p>
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
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center">
          <div className="text-5xl mb-4">&#128214;</div>
          <p className="text-slate-500">No articles available today.</p>
        </div>
      ) : (
        <>
          <div className="space-y-6">
            {articles.map((article, idx) => (
              <article
                key={idx}
                className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden"
              >
                <div className="p-6">
                  {/* Clickable title block - use div to avoid invalid <a> inside <button> */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => loadFullContent(idx, article)}
                    onKeyDown={(e) => e.key === 'Enter' && loadFullContent(idx, article)}
                    className="w-full text-left cursor-pointer outline-none focus:ring-2 focus:ring-indigo-300 focus:ring-inset rounded-lg"
                  >
                    <h2 className="text-xl font-bold text-slate-800 leading-snug hover:text-indigo-600 transition-colors">
                      {article.title}
                    </h2>
                    {(article.recommendationReason || article.scores || (article.keywords && article.keywords.length > 0)) && (
                      <div className="mt-2">
                        <p className="text-sm text-indigo-600 font-medium">
                          {article.recommendationReason || (article.scores ? `Interest: ${article.scores.interestScore}. Difficulty: ${article.scores.difficultyScore}. Total: ${article.scores.totalScore.toFixed(0)} (0.4×interest + 0.6×difficulty)` : article.link?.startsWith('feedlingo://') ? 'Interest: 90. Difficulty: 100. Total: 96 (0.4×interest + 0.6×difficulty)' : 'Interest: 50. Difficulty: 50. Total: 50 (0.4×interest + 0.6×difficulty)')}
                        </p>
                        {article.keywords && article.keywords.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {article.keywords.map((kw, i) => (
                              <span
                                key={i}
                                className="px-2 py-0.5 text-xs bg-indigo-50 text-indigo-600 rounded-full"
                              >
                                {kw}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 text-xs text-slate-400 mt-2">
                      {article.source && (
                        <span className="px-2 py-1 bg-slate-100 rounded-full">{article.source}</span>
                      )}
                      <span>{formatArticleDate(article.pubDate, { withTime: true })}</span>
                    </div>
                    <div className="mt-3 text-slate-600 leading-relaxed line-clamp-2">
                      {article.simplified}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {(article.link || article.id) && (
                        <span className="inline-flex items-center gap-1 text-sm text-indigo-600 font-medium">
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
                          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-indigo-600 font-medium"
                        >
                          Open in new tab
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                    </div>
                  </div>
                  {/* Feedback: always visible so user can Like/Dislike without expanding */}
                  <div
                    className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-2 items-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setArticleFeedback(idx, 'liked', true); }}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium ${feedback[idx]?.liked === true ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                      {feedback[idx]?.liked === true ? '✓ Like' : 'Like'}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setArticleFeedback(idx, 'liked', false); }}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium ${feedback[idx]?.liked === false ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                      {feedback[idx]?.liked === false ? '✓ Dislike' : 'Dislike'}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setArticleFeedback(idx, 'difficulty', 'too_hard'); }}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium ${feedback[idx]?.difficulty === 'too_hard' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                      {feedback[idx]?.difficulty === 'too_hard' ? '✓ Too hard' : 'Too hard'}
                    </button>
                  </div>

                  {/* Full content (loaded on click) */}
                  {fullContent[idx] === 'loading' && (
                    <div className="mt-6 pt-6 border-t border-slate-100 flex items-center gap-2 text-slate-500">
                      <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      Loading full article&hellip;
                    </div>
                  )}
                  {fullContent[idx] === null && (
                    <div className="mt-6 pt-6 border-t border-slate-100 p-4 bg-amber-50 rounded-xl">
                      <p className="text-amber-700 text-sm mb-2">Could not load full article (site may block extraction).</p>
                      <div className="flex flex-wrap gap-3">
                        <a
                          href={article.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-indigo-600 font-medium hover:text-indigo-700"
                        >
                          Open in new tab
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                        <button
                          type="button"
                          onClick={() => dismissFullContent(idx)}
                          className="text-slate-500 hover:text-slate-700 text-sm"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}
                  {article.scores && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <div className="text-xs text-slate-500 font-medium mb-1.5">Score breakdown</div>
                      <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1.5 text-slate-600">
                        <div><span className="text-slate-400">Interest:</span> {article.scores.interestScore} — {article.scores.interestReason}</div>
                        <div><span className="text-slate-400">Difficulty:</span> {article.scores.difficultyScore} — {article.scores.difficultyReason}</div>
                        <div><span className="text-slate-400">Base total:</span> {article.scores.totalScore.toFixed(1)} (0.4×interest + 0.6×difficulty)</div>
                        {article.scores.freshnessScore !== undefined && (
                          <div><span className="text-slate-400">Freshness:</span> {article.scores.freshnessScore} — newer articles keep full score, ~14d decay to 0</div>
                        )}
                        {article.scores.showCount !== undefined && article.scores.showCount > 0 && (
                          <div><span className="text-slate-400">Shown:</span> {article.scores.showCount}× — demotion 1/(1+0.2×n)</div>
                        )}
                        {article.scores.adjustedTotal !== undefined && (
                          <div><span className="text-slate-400">Adjusted (for ranking):</span> {article.scores.adjustedTotal} — after freshness & demotion</div>
                        )}
                      </div>
                    </div>
                  )}
                  {fullContent[idx] && fullContent[idx] !== 'loading' && fullContent[idx] !== null && (
                    <div className="mt-6 pt-6 border-t border-slate-100">
                      <div className="flex justify-between items-center mb-4">
                        <span className="text-sm font-medium text-slate-500">Simplified for reading</span>
                        <button
                          type="button"
                          onClick={() => dismissFullContent(idx)}
                          className="text-sm text-slate-400 hover:text-slate-600"
                        >
                          Collapse
                        </button>
                      </div>
                      <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed whitespace-pre-wrap">
                        {(fullContent[idx] as ArticleContent).simplified}
                      </div>
                      <div className="mt-4 pt-4 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => toggleOriginal(idx)}
                          className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                        >
                          {expandedOriginal[idx] ? 'Hide' : 'Show'} original
                        </button>
                        {expandedOriginal[idx] && (
                          <div className="mt-2 p-4 bg-slate-50 rounded-xl text-sm text-slate-600 leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
                            {(fullContent[idx] as ArticleContent).content}
                          </div>
                        )}
                      </div>
                      {/* Feedback: Like/Dislike and difficulty - stopPropagation so parent title div doesn't capture */}
                      <div
                        className="mt-6 pt-4 border-t border-slate-100 flex flex-wrap gap-3 items-center relative z-10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-sm text-slate-500">Finished reading?</span>
                        <button
                          type="button"
                          onClick={() => setArticleFeedback(idx, 'liked', true)}
                          className={`px-4 py-2 rounded-xl text-sm font-medium ${feedback[idx]?.liked === true ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                          {feedback[idx]?.liked === true ? '✓ Like' : 'Like'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setArticleFeedback(idx, 'liked', false)}
                          className={`px-4 py-2 rounded-xl text-sm font-medium ${feedback[idx]?.liked === false ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                          {feedback[idx]?.liked === false ? '✓ Dislike' : 'Dislike'}
                        </button>
                        <span className="text-slate-300">|</span>
                        <span className="text-sm text-slate-500">Difficulty:</span>
                        <button
                          type="button"
                          onClick={() => setArticleFeedback(idx, 'difficulty', 'appropriate')}
                          className={`px-4 py-2 rounded-xl text-sm font-medium ${feedback[idx]?.difficulty === 'appropriate' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                          {feedback[idx]?.difficulty === 'appropriate' ? '✓ Just right' : 'Just right'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setArticleFeedback(idx, 'difficulty', 'too_hard')}
                          className={`px-4 py-2 rounded-xl text-sm font-medium ${feedback[idx]?.difficulty === 'too_hard' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                          {feedback[idx]?.difficulty === 'too_hard' ? '✓ Too hard' : 'Too hard'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setArticleFeedback(idx, 'difficulty', 'too_easy')}
                          className={`px-4 py-2 rounded-xl text-sm font-medium ${feedback[idx]?.difficulty === 'too_easy' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                          {feedback[idx]?.difficulty === 'too_easy' ? '✓ Too easy' : 'Too easy'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>

          {/* Read more button - always visible at bottom */}
          <div id="read-more" className="mt-10 mb-12 py-10 px-6 bg-slate-50 rounded-2xl border border-slate-100 text-center">
            {hasMore ? (
              <button
                type="button"
                onClick={() => (token ? fetchRecommendArticles(true) : fetchArticles(true))}
                disabled={loadingMore}
                className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
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
              <p className="text-sm text-slate-500">No more articles for now. Check back later for new recommendations.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
