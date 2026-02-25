# Offline Tasks

## Overview

**Offline** = batch/scheduled jobs, no user request. Run on cron or manually.

**Online** = request handlers in `routes/`, real-time services. Handle user requests.

---

## Offline Task List

| ID | Schedule | Deps | Description |
|----|----------|------|-------------|
| daily-crawl | 0 0 * * * (midnight UTC) | — | Crawl RSS feeds, GPT-preprocess, store articles |
| user-embedding-refresh | (in pipeline) | — | Refresh user interest embeddings for all active users |
| recommend-precompute | (in pipeline) | daily-crawl, user-embedding-refresh | Score new articles for all users |
| vocab-story | 0 1 * * * (1am UTC) | — | Generate personalized stories from users' words |
| article-audio | 0 2 * * * (2am UTC) | daily-crawl | Generate TTS audio (Google TTS via node-gtts, **free**) |

### Dependencies

| Task | Deps | 说明 |
|------|------|------|
| recommend-precompute | daily-crawl, user-embedding-refresh | 需新文章 + 新鲜 embedding |
| article-audio | daily-crawl | 需文章入库后可生成音频 |
| vocab-story | — | 无依赖 |

- **runTaskWithDeps(taskId)**：按拓扑顺序先跑依赖再跑本任务。CLI/HTTP 单任务触发默认使用。
- **skipDeps**：`warm-recommendations` 使用 `skipDeps`，直接用已有数据；`SKIP_DEPS=1 npm run offline -- recommend-precompute` 同理。

---

## Module Structure

```
server/src/
├── offline/           # 离线任务
│   ├── index.ts       # 统一入口
│   ├── registry.ts    # 任务定义
│   ├── runner.ts      # 执行器
│   └── scheduler.ts   # Cron 调度
├── routes/            # 在线路由 (request handlers)
├── dailyCrawler.ts    # daily-crawl 实现
├── recommendPrecompute.ts  # recommend-precompute 实现
├── dailyVocabStory.ts # vocab-story 实现
└── ...
```

---

## Running

### CLI (one-off)

```bash
# 所有任务
npm run offline -- daily-crawl
npm run offline -- user-embedding-refresh
npm run offline -- recommend-precompute
npm run offline -- vocab-story
npm run offline -- article-audio

# 可选参数 (环境变量)
DAYS_BACK=7 npm run offline -- recommend-precompute
USER_ID=xxx npm run offline -- vocab-story   # 不设则对所有符合条件用户生成

# 快捷脚本 (兼容旧用法)
npm run crawl              # = offline daily-crawl
npm run generate-vocab-story  # = offline vocab-story
```

### Built-in Cron

Server 启动时自动注册 cron。通过 env 配置：

- `CRON_SCHEDULE` — daily-crawl (默认 `0 0 * * *`)
- `VOCAB_CRON_SCHEDULE` — vocab-story (默认 `0 1 * * *`)
- `AUDIO_CRON_SCHEDULE` — article-audio (默认 `0 2 * * *`)

### HTTP Trigger (external cron)

```bash
curl -X POST https://feedlingo.fly.dev/api/cron/daily-crawl \
  -H "X-Cron-Secret: YOUR_CRON_SECRET"

curl -X POST https://feedlingo.fly.dev/api/cron/user-embedding-refresh \
  -H "X-Cron-Secret: YOUR_CRON_SECRET"

curl -X POST https://feedlingo.fly.dev/api/cron/warm-recommendations \
  -H "X-Cron-Secret: YOUR_CRON_SECRET"

# 完整 daily 流程（crawl + embedding + precompute，不含 article-audio）
curl -X POST https://feedlingo.fly.dev/api/cron/daily \
  -H "X-Cron-Secret: YOUR_CRON_SECRET"

# 文章音频生成（单独触发，使用免费 Google TTS）
curl -X POST https://feedlingo.fly.dev/api/cron/article-audio \
  -H "X-Cron-Secret: YOUR_CRON_SECRET"

curl -X POST "https://feedlingo.fly.dev/api/cron/generate-vocab-stories?userId=xxx" \
  -H "X-Cron-Secret: YOUR_CRON_SECRET"
```

---

## Pipeline

Daily pipeline 顺序：

1. `daily-crawl` — 抓取文章入库
2. `user-embedding-refresh` — 刷新所有活跃用户的兴趣 embedding
3. `recommend-precompute` (daysBack=0) — 用**今日**新文章 ID 为所有用户打分（使用更新后的 embedding），更新 user_top_articles

`scheduler` 中一次 cron 触发会顺序执行 `runDailyPipeline()`，保证依赖顺序。

**单独运行 recommend-precompute**（如 `POST /api/cron/warm-recommendations`）不依赖 crawl，使用 daysBack=14 对近期文章重新打分，适用于部署后预热。

**article-audio** 在 2am 单独运行，减少午夜负载。使用 node-gtts（Google TTS 免费），无需付费 API。
