import db from '../db/client.js';

export type DailyStepStatus = 'success' | 'failed' | 'skipped';

export interface DailyPipelineRun {
  run_date: string;
  status: 'running' | 'success' | 'failed';
  last_step: string | null;
  steps_json: string;
  error: string | null;
  started_at: string;
  updated_at: string;
}

export interface DailyStepSnapshot {
  status: DailyStepStatus;
  updatedAt: string;
  note?: string;
}

export type DailyStepsMap = Record<string, DailyStepSnapshot>;

function nowIso(): string {
  return new Date().toISOString();
}

function ensureTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_pipeline_runs (
      run_date TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'running',
      last_step TEXT,
      steps_json TEXT DEFAULT '{}',
      error TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_daily_pipeline_runs_status ON daily_pipeline_runs(status, updated_at)`);
}

export function getDailyPipelineRun(runDate: string): DailyPipelineRun | undefined {
  ensureTable();
  return db.prepare('SELECT * FROM daily_pipeline_runs WHERE run_date = ?').get(runDate) as DailyPipelineRun | undefined;
}

export function resetDailyPipelineRun(runDate: string): void {
  ensureTable();
  db.prepare('DELETE FROM daily_pipeline_runs WHERE run_date = ?').run(runDate);
}

export function startDailyPipelineRun(runDate: string, resume: boolean): DailyPipelineRun {
  ensureTable();
  const existing = getDailyPipelineRun(runDate);
  const now = nowIso();
  if (resume && existing) {
    db.prepare(`
      UPDATE daily_pipeline_runs
      SET status = 'running', updated_at = ?, error = NULL
      WHERE run_date = ?
    `).run(now, runDate);
    return getDailyPipelineRun(runDate)!;
  }

  db.prepare(`
    INSERT INTO daily_pipeline_runs (run_date, status, last_step, steps_json, error, started_at, updated_at)
    VALUES (?, 'running', NULL, '{}', NULL, ?, ?)
    ON CONFLICT(run_date) DO UPDATE SET
      status = 'running',
      last_step = NULL,
      steps_json = '{}',
      error = NULL,
      started_at = excluded.started_at,
      updated_at = excluded.updated_at
  `).run(runDate, now, now);
  return getDailyPipelineRun(runDate)!;
}

export function parseDailySteps(stepsJson: string | null | undefined): DailyStepsMap {
  if (!stepsJson) return {};
  try {
    const parsed = JSON.parse(stepsJson) as DailyStepsMap;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    //
  }
  return {};
}

export function markDailyStep(
  runDate: string,
  stepId: string,
  status: DailyStepStatus,
  note?: string
): void {
  ensureTable();
  const existing = getDailyPipelineRun(runDate);
  const steps = parseDailySteps(existing?.steps_json);
  const updatedAt = nowIso();
  steps[stepId] = note ? { status, updatedAt, note } : { status, updatedAt };
  const error = status === 'failed' ? (note || 'step failed') : null;
  db.prepare(`
    INSERT INTO daily_pipeline_runs (run_date, status, last_step, steps_json, error, started_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_date) DO UPDATE SET
      status = excluded.status,
      last_step = excluded.last_step,
      steps_json = excluded.steps_json,
      error = excluded.error,
      updated_at = excluded.updated_at
  `).run(
    runDate,
    status === 'failed' ? 'failed' : 'running',
    stepId,
    JSON.stringify(steps),
    error,
    existing?.started_at || updatedAt,
    updatedAt
  );
}

export function finishDailyPipelineRun(runDate: string): void {
  ensureTable();
  const now = nowIso();
  db.prepare(`
    UPDATE daily_pipeline_runs
    SET status = 'success', error = NULL, updated_at = ?
    WHERE run_date = ?
  `).run(now, runDate);
}
