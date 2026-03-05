import db from '../db/client.js';

const METRIC_COLUMNS = [
  'define_requests',
  'article_content_requests',
  'recommend_requests',
  'article_reads',
  'sync_requests',
  'weekly_test_requests',
  'unique_users',
] as const;

export type MetricType = typeof METRIC_COLUMNS[number];

const updStmts: Record<string, ReturnType<typeof db.prepare>> = {};
const insStmt = db.prepare(
  `INSERT OR IGNORE INTO metrics_daily (date, define_requests, article_content_requests, recommend_requests, article_reads, sync_requests, weekly_test_requests, unique_users, created_at, updated_at) VALUES (?, 0, 0, 0, 0, 0, 0, 0, ?, ?)`
);

function getUpdStmt(col: string): ReturnType<typeof db.prepare> {
  if (!updStmts[col]) {
    updStmts[col] = db.prepare(`UPDATE metrics_daily SET ${col} = ${col} + ?, updated_at = ? WHERE date = ?`);
  }
  return updStmts[col];
}

export function incrementMetric(date: string, metric: MetricType, delta = 1): void {
  if (!METRIC_COLUMNS.includes(metric)) return;
  const now = new Date().toISOString();
  insStmt.run(date, now, now);
  (getUpdStmt(metric) as { run: (...args: unknown[]) => unknown }).run(delta, now, date);
}

export function getMetricsForDate(date: string): Record<string, number> | null {
  const row = db.prepare('SELECT * FROM metrics_daily WHERE date = ?').get(date) as Record<string, unknown> | undefined;
  if (!row) return null;
  const out: Record<string, number> = {};
  for (const c of METRIC_COLUMNS) {
    out[c] = Number(row[c] ?? 0);
  }
  return out;
}

export function getMetricsRange(startDate: string, endDate: string): Array<Record<string, unknown>> {
  return db.prepare(`
    SELECT * FROM metrics_daily WHERE date >= ? AND date <= ? ORDER BY date DESC
  `).all(startDate, endDate) as Array<Record<string, unknown>>;
}
