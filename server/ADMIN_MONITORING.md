# Admin Monitoring

## Overview

Backend monitoring for downloads, translations, user requests, and reading activity. See also [README.md](README.md) for server API overview.

## Monitoring Panel (Web UI)

**URL:** `https://feedlingo.fly.dev/admin`

A standalone dashboard page. On first visit:
1. Enter your `ADMIN_SECRET` (or append `?secret=YOUR_SECRET` to the URL for quick access)
2. View metrics, overview, and recent crawl reports
3. Click a report date to view the full Markdown report in a new tab

## Authentication

All admin endpoints require `ADMIN_SECRET` in env. Pass via:

- Header: `Authorization: Bearer YOUR_ADMIN_SECRET` or `X-Admin-Secret: YOUR_ADMIN_SECRET`
- Query: `?secret=YOUR_ADMIN_SECRET`

## Endpoints

### GET /api/admin/dashboard

Summary dashboard:
- **overview**: total users, words, articles, article reads
- **today**: metrics for today + unique readers (from article_feedback)
- **yesterday**: metrics for yesterday
- **recentCrawlReports**: last 7 crawl reports

### GET /api/admin/metrics

- `?date=2025-02-17` — metrics for that date
- `?start=2025-02-01&end=2025-02-17` — metrics range
- No params — today's metrics

### GET /api/admin/reports

List crawl reports (default 30, max 50 via `?limit=`).

### GET /api/admin/reports/:date

Daily crawl report as Markdown (e.g. `GET /api/admin/reports/2025-02-17`).

## Tracked Metrics

| Metric | Source |
|--------|--------|
| `define_requests` | /api/define, /api/define-learner, /api/define-intermediate |
| `article_content_requests` | /api/discovery/article-content, article-by-id |
| `recommend_requests` | /api/recommend |
| `article_reads` | /api/level/feedback (user finished reading + gave feedback) |
| `sync_requests` | POST /api/sync |
| `weekly_test_requests` | /api/discovery/weekly-test |
| `unique_users` | Reserved for future use |

## Env Variable

- `ADMIN_SECRET` — required for admin access
