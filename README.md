# FeedLingo

**Learn English vocabulary through reading—track words, read leveled content, and reinforce with AI-generated stories.**

---

## Vision & Concept

FeedLingo turns your reading into an active vocabulary-learning system. Look up words while you read, save them with one tap, and let the app:

- **Recommend articles** matched to your level and interests
- **Generate personalized stories** from your recent vocabulary
- **Schedule spaced-repetition reviews** so words stick

Read → Look up → Save → Review. No flashcards from strangers; your vocabulary comes from what you actually read.

---

## Key Features & Selling Points

### 1. **Read-to-Learn, Not Rote Memorization**

- Words come from real reading—tech news, finance, lifestyle. No random word lists.
- GPT simplifies articles to your level (A2/B1/B2), so you can understand context.
- Recommended articles show **why** they’re recommended: interest match and difficulty score.

### 2. **Smart Recommendations**

- **Interest + difficulty scoring**: 0.4×interest + 0.6×difficulty, with English explanations.
- Personalized feed based on your level (from tests & feedback) and interests.
- Articles from Finance, Tech, Lifestyle, Entertainment, Sports.

### 3. **Vocab Stories — Your Words, Your Story**

- AI generates short stories (200–400 words) from **your last 7 days of new words**.
- One story per day per user, surfaced in your feed.
- Stories are personalized and never shown to other users.
- Helps you see words in context instead of isolated flashcards.

### 4. **Spaced Repetition (Ebbinghaus)**

- Review schedule adapts to your memory curve.
- Progress syncs across devices when you sign in.

### 5. **Multi-Source Dictionary**

- Definitions from Free Dictionary API, Merriam-Webster Collegiate, Intermediate, Learner.
- IPA phonetics (American), audio pronunciation, example sentences.

### 6. **Chrome Extension — Quick Lookup**

- Right-click any word → “Look up in FeedLingo” → opens app with the word pre-filled.

### 7. **Weekly Reading Test**

- Comprehension quizzes generated from articles.
- Tracks your progress over time.

---

## Tech Stack

| Layer      | Stack                          |
|-----------|----------------------------------|
| Frontend  | React, Vite, Tailwind, Jotai, PWA |
| Backend   | Node.js, Express, SQLite        |
| AI        | OpenAI (GPT-4o-mini, embeddings) |
| Deploy    | Fly.io, Docker                  |

---

## Project Structure

```
├── src/                    # React frontend
│   ├── components/         # WordLookup, ReviewTest, Discovery, etc.
│   ├── api.ts
│   └── store.ts
├── server/                 # Backend
│   ├── src/
│   │   ├── offline/        # Batch jobs (crawl, precompute, vocab story)
│   │   ├── online/         # Request handlers (routes)
│   │   ├── routes/
│   │   └── ...
│   ├── OFFLINE_TASKS.md
│   ├── DAILY_CRAWLER.md
│   ├── VOCAB_STORY.md
│   └── ADMIN_MONITORING.md
├── chrome-extension/       # Quick lookup extension
├── docs/
│   └── DESIGN_NOTES.md
└── fly.toml                # Fly.io config
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- OpenAI API key

### Local Development

```bash
# Install
npm install
cd server && npm install

# Copy env
cp server/.env.example server/.env
# Edit server/.env: OPENAI_API_KEY, JWT_SECRET, etc.

# Run backend
cd server && npm run dev

# Run frontend (separate terminal)
npm run dev
```

Frontend: http://localhost:5173  
Backend: http://localhost:3001

### Production Build & Deploy

```bash
# Build
npm run build
cd server && npm run build

# Deploy to Fly.io
fly deploy --app feedlingo
```

---

## Documentation

| Doc                              | Description                          |
|----------------------------------|--------------------------------------|
| [server/README.md](server/README.md)           | Server API overview, env, scripts   |
| [server/OFFLINE_TASKS.md](server/OFFLINE_TASKS.md) | Offline vs online, task registry   |
| [server/DAILY_CRAWLER.md](server/DAILY_CRAWLER.md)   | Daily article crawl, RSS feeds, cron |
| [server/VOCAB_STORY.md](server/VOCAB_STORY.md)       | Vocab story generation               |
| [server/ADMIN_MONITORING.md](server/ADMIN_MONITORING.md) | Admin dashboard, metrics             |
| [server/src/GPT_PROMPTS.md](server/src/GPT_PROMPTS.md)   | All GPT prompts                      |
| [docs/DESIGN_NOTES.md](docs/DESIGN_NOTES.md)       | Original design notes                |

---

## License

Private.
