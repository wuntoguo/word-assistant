# FeedLingo Server

Express backend for FeedLingo: auth, sync, discovery, recommendations, vocab stories.

---

## API Overview

| Area       | Routes                        | Description                          |
|------------|-------------------------------|--------------------------------------|
| Auth       | /api/auth/*                   | Register, login, OAuth, JWT          |
| Sync       | POST /api/sync                | Sync words, level data               |
| Dictionary | /api/define*, /api/define-learner, /api/define-intermediate | Word lookups         |
| Discovery  | /api/discovery/*              | Articles, content, weekly test       |
| Recommend  | GET /api/recommend            | Personalized feed                    |
| Vocab Story| POST /api/vocab-story/generate| Generate story from user's words     |
| Profile    | /api/profile                  | Interests, level preferences         |
| Level      | /api/level/*                  | Level estimation, feedback           |
| Cron       | POST /api/cron/*              | daily-crawl, generate-vocab-stories   |
| Admin      | GET /api/admin/*              | Metrics, reports (requires ADMIN_SECRET) |

---

## Documentation

- [OFFLINE_TASKS.md](OFFLINE_TASKS.md) — Offline task registry, runner, scheduler
- [DAILY_CRAWLER.md](DAILY_CRAWLER.md) — Daily article crawl
- [VOCAB_STORY.md](VOCAB_STORY.md) — Vocab story generation
- [ADMIN_MONITORING.md](ADMIN_MONITORING.md) — Admin panel
- [src/GPT_PROMPTS.md](src/GPT_PROMPTS.md) — AI prompts

---

## Env Variables

| Variable       | Required | Description                              |
|----------------|----------|------------------------------------------|
| PORT           |          | Server port (default 3001)                |
| JWT_SECRET     | ✓        | JWT signing secret                       |
| OPENAI_API_KEY | ✓        | For GPT, embeddings                      |
| APP_URL        |          | Frontend URL (CORS)                      |
| DATABASE_PATH  |          | SQLite path (default ./data.db)          |
| GOOGLE_*       |          | Google OAuth                             |
| GITHUB_*       |          | GitHub OAuth                             |
| MW_*           |          | Merriam-Webster API keys                 |
| CRON_SECRET    |          | For /api/cron/*                          |
| ADMIN_SECRET   |          | For /api/admin/*                         |

See [.env.example](.env.example) for the full list.

---

## Scripts

```bash
npm run dev          # tsx watch
npm run build        # tsc
npm run crawl        # Run daily crawl once
npm run generate-vocab-story  # Generate vocab stories once
```
