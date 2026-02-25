# FeedLingo 项目程序文档

## 1. 项目概述

FeedLingo 是一款通过阅读学习英语词汇的应用。用户在日常阅读中查词、收藏，系统基于艾宾浩斯记忆曲线安排复习，并结合 AI 生成个性化生词故事，帮助在情境中巩固记忆。

**核心理念**：Read → Look up → Save → Review。词汇来自真实阅读，而非随机单词表。

---

## 2. 技术架构

| 层级 | 技术栈 | 说明 |
|------|--------|------|
| 前端 | React 18, Vite, Tailwind CSS, Jotai, PWA | SPA，支持离线 |
| 后端 | Node.js, Express | REST API |
| 数据库 | SQLite (better-sqlite3) | 单文件，WAL 模式 |
| AI | OpenAI (gpt-4o-mini, text-embedding-3-small) | 文章简化、推荐、生词故事 |
| 部署 | Fly.io, Docker | 单容器部署 |

---

## 3. 项目结构

```
word-asistant/
├── src/                          # 前端源码
│   ├── components/               # React 组件
│   │   ├── WordLookup.tsx        # 查词
│   │   ├── ReviewTest.tsx        # 复习测试
│   │   ├── WordHistory.tsx       # 生词历史
│   │   ├── WeeklyTest.tsx        # 周测
│   │   ├── Discovery.tsx         # 文章推荐流
│   │   ├── AudioChannel.tsx      # 听力
│   │   ├── ProfileStats.tsx      # 个人统计
│   │   ├── LoginPage.tsx
│   │   ├── AuthCallback.tsx      # OAuth 回调
│   │   ├── WordCard.tsx, WordImage.tsx
│   │   └── PhonemeBreakdown.tsx
│   ├── api.ts                    # API 封装
│   ├── store.ts                  # Jotai 状态
│   ├── sync.ts                   # 同步逻辑
│   ├── types.ts
│   └── utils.ts
│
├── server/                       # 后端
│   ├── src/
│   │   ├── index.ts              # 入口
│   │   ├── db.ts                 # 数据库
│   │   ├── online/               # 在线路由注册
│   │   │   └── index.ts
│   │   ├── offline/              # 离线任务
│   │   │   ├── registry.ts       # 任务定义
│   │   │   ├── runner.ts         # 执行器
│   │   │   ├── scheduler.ts      # Cron 调度
│   │   │   └── index.ts
│   │   ├── routes/               # API 路由
│   │   │   ├── auth.ts           # 登录注册 OAuth
│   │   │   ├── sync.ts           # 单词同步
│   │   │   ├── dictionary.ts     # 查词
│   │   │   ├── discovery.ts      # 文章、周测
│   │   │   ├── recommend.ts      # 推荐流
│   │   │   ├── vocabStory.ts     # 生词故事
│   │   │   ├── profile.ts
│   │   │   ├── level.ts
│   │   │   ├── audio.ts
│   │   │   ├── sentences.ts
│   │   │   ├── cron.ts           # 离线任务 HTTP 触发
│   │   │   └── admin.ts
│   │   ├── recommendation.ts    # 推荐算法
│   │   ├── recommendPrecompute.ts
│   │   ├── dailyCrawler.ts       # 文章爬虫
│   │   ├── dailyVocabStory.ts    # 生词故事生成
│   │   ├── articleIngest.ts
│   │   └── middleware/metrics.ts
│   ├── scripts/
│   │   └── run-offline-task.ts   # 离线任务 CLI
│   └── docs (DAILY_CRAWLER, VOCAB_STORY, etc.)
│
├── chrome-extension/             # 右键查词扩展
│   ├── manifest.json
│   └── background.js
│
├── docs/
├── Dockerfile
└── fly.toml
```

---

## 4. 功能模块

### 4.1 单词学习

| 功能 | 说明 |
|------|------|
| 查词 | 多词典源：Free Dictionary、Merriam-Webster Collegiate/Intermediate/Learner。支持 IPA 音标、音频、例句 |
| 收藏 | 一键加入生词本 |
| 复习 | 艾宾浩斯间隔复习 |
| 历史 | 查看生词列表，导出 |
| 周测 | 阅读理解选择题，GPT 出题 |

### 4.2 阅读推荐

| 功能 | 说明 |
|------|------|
| 推荐流 | 基于用户等级、兴趣与文章难度/兴趣匹配的个性化文章 |
| 评分公式 | Total = 0.4×interest + 0.6×difficulty |
| 来源 | Finance, Tech, Lifestyle, Entertainment, Sports RSS |
| 生词故事 | 用最近 7 天生词生成短故事，混入推荐流 1–2 篇，仅对本人可见 |

### 4.3 用户系统

| 功能 | 说明 |
|------|------|
| 登录 | 邮箱密码、Google OAuth、GitHub OAuth |
| 同步 | 单词、等级数据跨设备同步 |
| 个人资料 | 兴趣关键词、难度偏好 |

### 4.4 其他

- **Chrome 扩展**：右键选中单词 → Look up in FeedLingo
- **管理后台**：`/admin`，需 ADMIN_SECRET

---

## 5. 数据模型

### 5.1 核心表

| 表 | 用途 |
|----|------|
| users | 用户（id, email, name, provider, provider_id） |
| words | 生词（user_id, word, phonetic, definitions, date_added, next_review_date, memory_stage 等） |
| articles | 文章（含 source_url, title, content, simplified_content, keywords, difficulty, is_vocab_story） |
| article_feedback | 文章反馈（liked, hard） |
| user_profiles | 兴趣、等级偏好 |
| weekly_test_results | 周测分数 |
| user_shown_articles | 最近 3 天已展示文章 |

### 5.2 推荐缓存

| 表 | 用途 |
|----|------|
| article_embeddings | 文章向量 |
| user_embeddings | 用户兴趣向量 |
| user_top_articles | 用户 top 文章及打分 |

### 5.3 运营

| 表 | 用途 |
|----|------|
| daily_crawl_reports | 每日爬取报告 |
| metrics_daily | 按日统计（define_requests, recommend_requests 等） |

---

## 6. API 概览

| 模块 | 路径 | 说明 |
|------|------|------|
| 认证 | POST /api/auth/register, login | 注册、登录 |
| 认证 | GET /api/auth/me | 当前用户 |
| 认证 | GET /api/auth/google, callback | Google OAuth |
| 同步 | POST /api/sync | 单词与等级同步 |
| 查词 | GET /api/define, define-learner, define-intermediate | 查词 |
| 文章 | GET /api/discovery/articles | RSS 文章列表 |
| 文章 | GET /api/discovery/article-content, article-by-id/:id | 文章全文 |
| 文章 | GET /api/discovery/weekly-test | 周测 |
| 推荐 | GET /api/recommend | 个性化推荐流 |
| 生词故事 | POST /api/vocab-story/generate | 手动生成故事 |
| 个人 | GET/PUT /api/profile | 兴趣、等级 |
| 等级 | GET /api/level/estimate, POST /api/level/feedback | 等级评估、反馈 |
| 音频 | GET /api/audio/* | 发音 |
| 离线 | POST /api/cron/daily-crawl | 触发爬虫 |
| 离线 | POST /api/cron/warm-recommendations | 触发预计算 |
| 离线 | POST /api/cron/generate-vocab-stories | 触发生词故事 |
| 管理 | GET /api/admin/* | 指标、报告 |

---

## 7. 离线任务

### 7.1 任务列表

| ID | 调度 | 依赖 | 说明 |
|----|------|------|------|
| daily-crawl | 0 0 * * * | — | RSS 抓取，GPT 预处理入库 |
| recommend-precompute | 在 pipeline 内 | daily-crawl | 对新文章为用户打分 |
| vocab-story | 0 1 * * * | — | 用用户近 7 天生词生成故事 |

### 7.2 运行方式

- **内置 Cron**：服务启动时注册，由 CRON_SCHEDULE、VOCAB_CRON_SCHEDULE 配置
- **HTTP**：POST /api/cron/*，需 CRON_SECRET
- **CLI**：`npm run offline -- <task-id>`

---

## 8. 前端页面与路由

| 路径 | 组件 | 说明 |
|------|------|------|
| / | Discovery | 推荐流 / 发现 |
| /audio | AudioChannel | 听力 |
| /learn | WordLookup | 查词 |
| /learn/review | ReviewTest | 复习 |
| /learn/history | WordHistory | 生词历史 |
| /learn/weekly-test | WeeklyTest | 周测 |
| /me | ProfileStats | 个人统计 |
| /login | LoginPage | 登录 |
| /auth-callback | AuthCallback | OAuth 回调 |

---

## 9. 部署与运行

### 9.1 本地开发

```bash
npm install && cd server && npm install
cp server/.env.example server/.env  # 配置 OPENAI_API_KEY, JWT_SECRET 等
cd server && npm run dev   # 后端 :3001
npm run dev                # 前端 :5173
```

### 9.2 构建与部署

```bash
npm run build
cd server && npm run build
fly deploy --app feedlingo
```

### 9.3 环境变量

必填：`JWT_SECRET`、`OPENAI_API_KEY`  
可选：`APP_URL`、`CRON_SECRET`、`ADMIN_SECRET`、OAuth、Merriam-Webster 等。详见 `server/.env.example`。

---

## 10. 相关文档

| 文档 | 内容 |
|------|------|
| [README.md](../README.md) | 项目简介、卖点 |
| [server/OFFLINE_TASKS.md](../server/OFFLINE_TASKS.md) | 离线任务 |
| [server/DAILY_CRAWLER.md](../server/DAILY_CRAWLER.md) | 爬虫 |
| [server/VOCAB_STORY.md](../server/VOCAB_STORY.md) | 生词故事 |
| [server/ADMIN_MONITORING.md](../server/ADMIN_MONITORING.md) | 管理后台 |
| [server/src/GPT_PROMPTS.md](../server/src/GPT_PROMPTS.md) | GPT 提示词 |
