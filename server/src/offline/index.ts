/**
 * Offline tasks module.
 *
 * Offline = batch/scheduled jobs, no user request.
 * - Daily crawl, recommendation precompute, vocab story generation
 *
 * Online = request handlers in routes/, real-time services.
 */

export { OFFLINE_TASKS, getTask, getAllTasks, getExecutionOrder } from './registry.js';
export { runTask, runTaskWithDeps, runDailyPipeline } from './runner.js';
export type { TaskResult } from './runner.js';
export type { OfflineTaskDef } from './registry.js';
export { setupScheduler } from './scheduler.js';
