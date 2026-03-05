import { aggregateEventsForDate } from './repositories/eventRepo.js';

export async function runDailyEventAggregation(options?: { date?: string }): Promise<{
  date: string;
  summaryRows: number;
  itemRows: number;
}> {
  const date = options?.date || new Date(Date.now() - 864e5).toISOString().split('T')[0];
  const result = aggregateEventsForDate(date);
  return {
    date,
    summaryRows: result.summaryRows,
    itemRows: result.itemRows,
  };
}
