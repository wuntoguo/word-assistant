# Vocab Story

## Overview

AI-generated short stories (200–400 words) built from **your last 7 days of new vocabulary**. One story per user per day. Surfaces in the Discovery feed to reinforce words in context.

- **Personalized**: Uses only your words; never shown to other users.
- **Daily**: One story per user per day.
- **GPT**: gpt-4o-mini, ~800 tokens.

---

## Flow

1. **Daily cron** (1am UTC) or **manual trigger**: For each active user with ≥3 words in the last 7 days, generate a story.
2. Stories are stored in `articles` with `is_vocab_story = 1`, `vocab_story_user_id = userId`.
3. Recommendation logic mixes 1–2 vocab stories into the user's feed (positions 2, 6).
4. Vocab stories are **excluded** from the shared article pool; they never appear for other users.

---

## Running

### Built-in Cron (default 1am UTC)

Configure via env:

```bash
VOCAB_CRON_SCHEDULE=0 1 * * *
```

### API Trigger (manual / external cron)

```bash
curl -X POST https://feedlingo.fly.dev/api/cron/generate-vocab-stories \
  -H "X-Cron-Secret: YOUR_CRON_SECRET"
```

Optional: `?userId=xxx` to generate for a single user.

### Script (one-off)

```bash
# All eligible users
npm run offline -- vocab-story
# or
npm run generate-vocab-story

# Specific user
USER_ID=your-user-id npm run offline -- vocab-story
```

---

## Endpoints

| Method | Path                     | Auth | Description                            |
|--------|--------------------------|------|----------------------------------------|
| POST   | /api/vocab-story/generate | JWT  | Generate a vocab story for the user    |

---

## Env Variables

- `OPENAI_API_KEY` — required for generation
- `CRON_SECRET` — for cron API
- `VOCAB_CRON_SCHEDULE` — cron expression (default `0 1 * * *`)
