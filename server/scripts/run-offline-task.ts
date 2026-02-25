#!/usr/bin/env npx tsx
/**
 * Run offline tasks by id.
 * Usage:
 *   npm run offline -- daily-crawl
 *   npm run offline -- recommend-precompute [daysBack=14]
 *   npm run offline -- vocab-story [USER_ID=xxx]
 */
import 'dotenv/config';
import { runTaskWithDeps, runTask, runDailyPipeline, getAllTasks } from '../src/offline/index.js';

const VALID_IDS = ['daily', 'daily-crawl', 'user-embedding-refresh', 'recommend-precompute', 'vocab-story', 'article-audio'];

async function main() {
  const taskId = process.argv[2];
  if (!taskId || !VALID_IDS.includes(taskId)) {
    console.error(`Usage: npm run offline -- <task-id>`);
    console.error(`Valid tasks: ${VALID_IDS.join(', ')}`);
    console.error('\nTask list:');
    for (const t of getAllTasks()) {
      console.error(`  ${t.id}: ${t.description}`);
    }
    process.exit(1);
  }

  if (taskId === 'daily') {
    console.log('Running daily pipeline: crawl → embedding → precompute');
    console.log('(article-audio runs separately via cron at 2am or: npm run offline -- article-audio)');
    const { crawl, embeddingRefresh, precompute } = await runDailyPipeline();
    console.log('Crawl:', crawl.ok ? JSON.stringify(crawl.data, null, 2) : crawl.error);
    if (embeddingRefresh) console.log('Embedding refresh:', embeddingRefresh.ok ? JSON.stringify(embeddingRefresh.data, null, 2) : embeddingRefresh.error);
    if (precompute) console.log('Precompute:', precompute.ok ? JSON.stringify(precompute.data, null, 2) : precompute.error);
    if (!crawl.ok) process.exit(1);
    return;
  }

  const options: { userId?: string; daysBack?: number; skipDeps?: boolean } = {};
  if (taskId === 'vocab-story') {
    options.userId = process.env.USER_ID;
  }
  if (taskId === 'recommend-precompute') {
    options.daysBack = parseInt(process.env.DAYS_BACK || '14', 10);
    options.skipDeps = process.env.SKIP_DEPS === '1'; // warm: use existing data, no crawl
  }

  const run = options.skipDeps ? runTask : runTaskWithDeps;
  console.log(`Running offline task: ${taskId}${options.skipDeps ? ' (skip deps)' : ' (with deps)'}`);
  const result = await run(taskId, options);

  if (result.ok) {
    console.log('Done:', JSON.stringify(result.data, null, 2));
  } else {
    console.error('Failed:', result.error);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
