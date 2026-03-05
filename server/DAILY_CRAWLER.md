# Daily Article Crawler

## Overview

Crawls major US news RSS feeds daily by category:
- **Finance**: Yahoo Finance, CNN Business, NPR Business
- **Tech**: CNN Tech, TechCrunch, Ars Technica, NPR Technology  
- **Lifestyle**: CNN Health, CNN Travel, NPR Health
- **Entertainment**: CNN Entertainment, NPR Arts, Variety
- **Sports**: ESPN, CNN US, NPR Sports

Each category: up to 20 most recent articles. GPT preprocesses (keywords, difficulty, A2/B1/B2 simplified variants) and stores in the articles table.

## Language Choice

**TypeScript/Node.js** was chosen for:
- Same stack as the app (shared DB, GPT client, deployment)
- I/O-bound scraping—Node.js async is sufficient
- Easy integration with existing `articleIngest` logic
- Single deploy—no separate Python/Go service

For very high-volume (10k+ articles/day), Python + Scrapy would scale better.

## Paywalled Sites

WSJ, NYT, FT, Economist, Bloomberg, Barron's etc. require subscriptions for full text. These domains are **skipped** when an RSS item links to them (e.g. Yahoo Finance sometimes links to WSJ). Use free sources instead: BBC, NPR, CNN, Yahoo Finance.

## Anti-Blocking & Rate Limiting

- **User-Agent rotation**: 5 varied UA strings
- **Delays**: 2–4.5s between feed fetches, 2–4.5s between article fetches
- **Retry**: Exponential backoff (2s, 4s, 8s), max 3 retries
- **Jitter**: Random delay variation to avoid fixed patterns

## Running

### 1. Built-in Cron (midnight UTC)

When the server runs, `node-cron` schedules the crawl. Configure via env:

```bash
CRON_SCHEDULE="0 0 * * *"   # Midnight UTC (default)
CRON_SCHEDULE="0 5 * * *"   # 5am UTC = midnight Eastern
```

**Note**: On Fly.io with `min_machines_running = 0`, the server can scale to zero and the cron won't run. Either:
- Keep `min_machines_running = 1`, or
- Use an external cron to hit `POST /api/cron/daily-crawl` (see below)

### 2. Manual Script

```bash
cd server && npm run crawl
# or
cd server && npm run offline -- daily-crawl
```

### 3. API Trigger (External Cron)

```bash
curl -X POST https://feedlingo.fly.dev/api/cron/daily-crawl \
  -H "X-Cron-Secret: YOUR_CRON_SECRET"
```

Set `CRON_SECRET` in env and use it in the request header or query `?secret=YOUR_CRON_SECRET`.

## Daily Report

After each crawl, a report is:
1. **Saved to DB** (`daily_crawl_reports` table)
2. **Returned in API response** when using POST `/api/cron/daily-crawl` (includes `dailyReport` in Markdown)
3. **Viewable via admin** at GET `/api/admin/reports` and GET `/api/admin/reports/:date` (Markdown)

## Env Variables

- `OPENAI_API_KEY` (required for GPT preprocessing)
- `CRON_SCHEDULE` (optional, default: `0 0 * * *`)
- `CRON_SECRET` (optional, for API trigger auth)
- `CRAWLER_FEED_TIMEOUT_MS` (optional, default: `10000`)
- `CRAWLER_FEED_DELAY_MS` (optional, default: `30000`, for anti-rate-limit)
- `CRAWLER_ARTICLE_DELAY_MS` (optional, default: `3000`)
- `CRAWLER_MAX_SOURCE_FAILURES` (optional, default: `2`, consecutive failures before cooldown)
- `CRAWLER_SOURCE_COOLDOWN_MS` (optional, default: `86400000` = 24h)

## Related

- **Vocab story generation** runs separately (1am UTC). See [VOCAB_STORY.md](VOCAB_STORY.md).
