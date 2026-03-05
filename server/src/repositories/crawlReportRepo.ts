import db from '../db/client.js';
import { v4 as uuidv4 } from 'uuid';

export function insertCrawlReport(result: {
  reportDate: string;
  ingested: number;
  skipped: number;
  errors: number;
  byCategory: Record<string, { ingested: number; skipped: number }>;
  durationMs: number;
}): void {
  const id = uuidv4();
  const byCategory = JSON.stringify(result.byCategory);
  db.prepare(`
    INSERT INTO daily_crawl_reports (id, report_date, ingested, skipped, errors, by_category, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    result.reportDate,
    result.ingested,
    result.skipped,
    result.errors,
    byCategory,
    result.durationMs
  );
}

export function getCrawlReports(limit = 30): Array<{
  id: string;
  report_date: string;
  ingested: number;
  skipped: number;
  errors: number;
  by_category: string;
  duration_ms: number;
  created_at: string;
}> {
  return db.prepare(`
    SELECT * FROM daily_crawl_reports ORDER BY report_date DESC LIMIT ?
  `).all(limit) as Array<{
    id: string;
    report_date: string;
    ingested: number;
    skipped: number;
    errors: number;
    by_category: string;
    duration_ms: number;
    created_at: string;
  }>;
}
