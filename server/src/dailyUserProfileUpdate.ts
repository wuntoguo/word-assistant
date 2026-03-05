import { getActiveUserIds } from './repositories/userRepo.js';
import { getUserEventsSince } from './repositories/eventRepo.js';
import { upsertUserProfileDaily } from './repositories/userProfileDailyRepo.js';

const MIN_VALID_READ_MS = 8000;

function addKeywordScore(map: Map<string, number>, rawKeywords: unknown, delta: number): void {
  if (!Array.isArray(rawKeywords)) return;
  for (const k of rawKeywords) {
    if (typeof k !== 'string') continue;
    const key = k.trim().toLowerCase();
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + delta);
  }
}

function topKeywordsByScore(map: Map<string, number>, positive: boolean, limit = 20): string[] {
  return [...map.entries()]
    .filter(([, v]) => (positive ? v > 0 : v < 0))
    .sort((a, b) => positive ? b[1] - a[1] : a[1] - b[1])
    .slice(0, limit)
    .map(([k]) => k);
}

export async function runDailyUserProfileUpdate(options?: { daysBack?: number; snapshotDate?: string }): Promise<{
  snapshotDate: string;
  usersProcessed: number;
  usersUpdated: number;
}> {
  const daysBack = options?.daysBack ?? 30;
  const snapshotDate = options?.snapshotDate || new Date().toISOString().split('T')[0];

  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceDate = since.toISOString().split('T')[0];

  const userIds = getActiveUserIds(daysBack);
  let usersUpdated = 0;

  for (const userId of userIds) {
    const events = getUserEventsSince(userId, sinceDate);
    if (!events.length) continue;

    const keywordScores = new Map<string, number>();
    let articleImpressions = 0;
    let articleClicks = 0;
    let audioPlays = 0;
    let audioCompletions = 0;
    let articleAction = 0;
    let audioAction = 0;
    let dwellTotal = 0;
    let dwellCount = 0;

    for (const e of events) {
      const metadata = (() => {
        try {
          return JSON.parse(e.metadata_json || '{}') as Record<string, unknown>;
        } catch {
          return {};
        }
      })();
      const keywords = metadata.keywords;

      if (e.event_type === 'impression' && e.scene === 'article') articleImpressions++;
      if (e.event_type === 'click' && e.scene === 'article') {
        articleClicks++;
        articleAction++;
        addKeywordScore(keywordScores, keywords, 2);
      }
      if (e.event_type === 'like') addKeywordScore(keywordScores, keywords, 3);
      if (e.event_type === 'dislike' || e.event_type === 'skip') addKeywordScore(keywordScores, keywords, -3);

      if (e.event_type === 'play_audio') {
        audioPlays++;
        audioAction++;
        addKeywordScore(keywordScores, keywords, 1);
      }
      if (e.event_type === 'complete_audio') {
        audioCompletions++;
        audioAction++;
        addKeywordScore(keywordScores, keywords, 2);
      }

      const dwellMs = typeof e.dwell_ms === 'number' ? e.dwell_ms : 0;
      const isValidArticleReadDwell = e.scene === 'article'
        && e.event_type === 'dwell_time'
        && dwellMs >= MIN_VALID_READ_MS;
      const isAudioDwell = e.scene === 'audio'
        && e.event_type === 'dwell_time'
        && dwellMs > 0;

      if (isValidArticleReadDwell || isAudioDwell) {
        dwellTotal += dwellMs;
        dwellCount += 1;
      }
    }

    const preferredScene = articleAction === 0 && audioAction === 0
      ? null
      : (audioAction > articleAction ? 'audio' : 'article');

    upsertUserProfileDaily({
      userId,
      snapshotDate,
      interestKeywords: topKeywordsByScore(keywordScores, true, 20),
      dislikeKeywords: topKeywordsByScore(keywordScores, false, 20),
      preferredScene,
      avgDwellMs: dwellCount > 0 ? Math.round(dwellTotal / dwellCount) : null,
      articleCtr: articleImpressions > 0 ? articleClicks / articleImpressions : null,
      audioCompletionRate: audioPlays > 0 ? audioCompletions / audioPlays : null,
    });
    usersUpdated++;
  }

  return {
    snapshotDate,
    usersProcessed: userIds.length,
    usersUpdated,
  };
}
