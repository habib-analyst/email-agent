# Email Agent — Agent Flow Guide

Read this before operating the system. The agent runs 24/7 in the background once started.

## One-Line Goal

Paste a faculty URL with 100+ professors → agent scrapes each profile → loads your latest sent Gmail as template → sends personalized emails one by one with resume attached.

## Setup (Once)

1. Copy `.env.example` to `.env` and fill in Google OAuth + Gemini keys.
2. Put resume PDF in `Resume/` folder.
3. Start backend: `cd backend && npm start`
4. Start frontend: `cd frontend && npm run dev`
5. Connect Gmail in Settings.

**Secrets:** Never commit `.env`, `.tokens.json`, or `API-Keys.txt`. OAuth tokens are encrypted at rest.

## Standard Workflow

### Step 1 — Import Faculty URL

```
POST /api/professors  { "url": "https://cs.university.edu/faculty" }
```

- Returns immediately: `{ "started": true }`
- Background job runs — watch progress via SSE `/api/queue/stream`
- Events: `scrape_progress`, `scrape_skipped`, `scrape_complete`, `template_loaded`

**What happens:**
1. Discover all professor emails on the page (pagination + Puppeteer if needed)
2. Match each email to a profile URL
3. Scrape each profile **one by one** (200ms between requests)
4. Build dossier (papers, research areas, Scholar lookup)
5. **Skip** professors with no online research data
6. Queue professors with useful data as `pending`
7. Auto-load latest sent Gmail email as HTML template

### Step 2 — Template (Automatic)

After import completes, the system loads your **latest manually sent Gmail email** as the template.

Pre-defined instructions (only 3 changes per email):
- Subject: `[Keyword] Seeking an MS/PhD Position in Your Lab`
- Greeting: `Dear Prof [LastName]`
- Interest line citing real research from dossier

Resume is auto-attached from `Resume/` on every send.

Manual override: `POST /api/template/load-latest`

### Step 3 — Send Pipeline (Automatic, One by One)

Worker loop (`backend/src/pipeline/index.js`):

```
pending → researching → drafted → verified → sent
                              ↓ (no data)
                           skipped
```

- **One professor at a time** — no parallel sends
- Uses cached dossier from import (skips re-research if data exists)
- AI generates topic + interest line from dossier + instructions
- AI verifies draft (no hallucinated papers)
- Random delay between sends (configurable, default 3–10 min)
- `auto_send=1` (default): sends automatically after verify
- `auto_send=0`: stops at `verified` — use `POST /api/queue/:id/send` to approve

### Skip Logic

Professor is **skipped** (not emailed) when:
- No papers, research areas, or verified data found online
- Verification fails twice → `needs_review`
- Already in `sent_log` → duplicate skip

## Reset for New Batch

```
POST /api/reset
```

Clears: queue, professors, sent_log, replies, learning_stats, template HTML.
Keeps: Gmail connection, default instructions, resume path, settings.

Dashboard Reset button does the same + clears all UI sections.

## API Quick Reference

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Worker + scrape status |
| `GET /api/scrape/status` | Current import job progress |
| `GET /api/queue/stream` | SSE live events |
| `GET /api/stats` | Counts by state |
| `POST /api/professors` | Import URL or paste emails |
| `POST /api/template/load-latest` | Pull latest sent Gmail |
| `POST /api/reset` | Clear all task data |
| `GET /api/digest` | Weekly stats |
| `POST /api/digest/run` | Trigger digest now |

## SSE Event Types

| Event | Meaning |
|-------|---------|
| `scrape_progress` | Import running — check `current/total`, `phase`, `email` |
| `scrape_complete` | Import done — `added`, `skipped`, `templateLoaded` |
| `scrape_skipped` | One professor skipped (no data) |
| `template_loaded` | Latest Gmail email saved as template |
| `progress` | Worker stage change for one professor |
| `sent` | Email sent successfully |
| `skipped` | Worker skipped professor |
| `reset` | All data cleared |

## Settings That Matter

| Setting | Default | Notes |
|---------|---------|-------|
| `daily_cap` | 0 (unlimited) | Max sends per day |
| `min_delay_min` | 0 | Min wait between emails |
| `max_delay_min` | 0 | Max wait between emails |
| `auto_send` | 1 | 0 = manual approval at verified |

## Not Implemented (By Design)

- Follow-up emails
- Per-recipient timezone scheduling
- Multi-threaded sending

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Import stuck | Check `/api/scrape/status`, Chrome installed for Puppeteer |
| No template loaded | Connect Gmail, send at least one email manually first |
| All professors skipped | Faculty page may not expose research data — try individual profile URLs |
| Send fails | Check template saved (`GET /api/template`), resume in `Resume/` |
| Worker idle | Check `/api/health`, ensure queue has pending items |

## File Map

```
backend/src/pipeline/scrapeJob.js   — Background faculty import
backend/src/pipeline/index.js       — Send worker loop
backend/src/research/index.js       — Scraping + dossier building
backend/src/gmail/templateLoader.js — Latest sent email → template
backend/src/utils/secrets.js        — Token encryption
frontend/src/pages/Dashboard.jsx    — Command center UI
```
