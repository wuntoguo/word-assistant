/**
 * Offline task registry.
 * All batch/scheduled jobs are defined here.
 */

export interface OfflineTaskDef {
  id: string;
  name: string;
  description: string;
  schedule: string;        // Cron expression
  envSchedule?: string;    // Env var to override schedule
  deps?: string[];        // Task IDs that should run before this (for pipelines)
}

export const OFFLINE_TASKS: Record<string, OfflineTaskDef> = {
  'daily-crawl': {
    id: 'daily-crawl',
    name: 'Daily Article Crawl',
    description: 'Crawl RSS feeds, GPT-preprocess, store articles',
    schedule: '0 0 * * *',
    envSchedule: 'CRON_SCHEDULE',
  },
  'user-embedding-refresh': {
    id: 'user-embedding-refresh',
    name: 'User Embedding Refresh',
    description: 'Refresh user interest embeddings for all active users',
    schedule: '0 0 * * *',
    envSchedule: undefined,
    deps: [],
  },
  'recommend-precompute': {
    id: 'recommend-precompute',
    name: 'Recommendation Precompute',
    description: 'Score new articles for all users, update user_top_articles',
    schedule: '0 0 * * *',  // Runs after crawl (same hour, triggered by crawl)
    envSchedule: undefined,
    deps: ['daily-crawl', 'user-embedding-refresh'],
  },
  'vocab-story': {
    id: 'vocab-story',
    name: 'Vocab Story Generation',
    description: 'Generate personalized stories from users\' last 7 days words',
    schedule: '0 1 * * *',
    envSchedule: 'VOCAB_CRON_SCHEDULE',
  },
  'article-audio': {
    id: 'article-audio',
    name: 'Article TTS Audio',
    description: 'Generate TTS audio for articles (Google TTS via node-gtts, free)',
    schedule: '0 2 * * *',
    envSchedule: 'AUDIO_CRON_SCHEDULE',
    deps: ['daily-crawl'],
  },
};

export function getTask(id: string): OfflineTaskDef | undefined {
  return OFFLINE_TASKS[id];
}

export function getAllTasks(): OfflineTaskDef[] {
  return Object.values(OFFLINE_TASKS);
}

/**
 * Get execution order for a task: [dep1, dep2, ..., taskId] (topological).
 * Ensures dependencies run before dependents. No duplicates.
 */
export function getExecutionOrder(taskId: string): string[] {
  const task = getTask(taskId);
  if (!task) return [];

  const result: string[] = [];
  const seen = new Set<string>();

  function visit(id: string) {
    if (seen.has(id)) return;
    seen.add(id);
    const t = getTask(id);
    if (t?.deps?.length) {
      for (const d of t.deps) {
        visit(d);
      }
    }
    result.push(id);
  }

  visit(taskId);
  return result;
}
