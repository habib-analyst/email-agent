---
name: multi-mode-separation
description: Build completely isolated operational modes (e.g. instant vs scheduled) with separate DB tables, separate API endpoints, separate frontend state, and separate SSE routing — no cross-contamination
source: auto-skill
extracted_at: '2026-06-13T03:24:18.747Z'
---

# Multi-Mode Data Separation

When a system needs two independent operational modes (e.g. instant send vs scheduled send), they must be completely isolated at every layer. "Complete separation" means: different DB tables, different API responses, different frontend state, different SSE events. Switching modes doesn't affect the other mode's data or screen.

## Why Separate Tables (Not WHERE Filters)

Using a `mode` column on shared tables (queue, professors) with `WHERE mode='instant'` filters creates subtle contamination risks:
- Reset endpoint must carefully filter by mode — easy to accidentally clear both
- Bootstrap endpoint returns all rows and frontend filters client-side — data leaks
- SSE events don't carry mode consistently — instant events update scheduled state
- Same email can appear in both modes but with different data (different dossier, different draft)

**Instead**: Create dedicated tables per mode (`scheduled_batches`, `scheduled_professors`, `scheduled_drafts`, `scheduled_sent_log`, `scheduled_template`). This eliminates WHERE-filter bugs entirely.

## The 5-Layer Separation Checklist

### 1. DB Layer — Separate Tables
- Each mode has its own set of tables: `scheduled_batches`, `scheduled_professors`, `scheduled_drafts`, etc.
- FK references stay within the mode's tables (`scheduled_drafts.professor_id → scheduled_professors.id`, NOT `professors.id`)
- Indexes are mode-specific (no `WHERE mode=?` needed)
- Shared config (settings, learning_stats) can stay shared if truly global

### 2. API Layer — Mode-Specific Bootstrap & Reset
- `GET /bootstrap?mode=scheduled` returns `batches` + `drafts` + `stats` + `template` from scheduled tables, NOT `queue` + `professors`
- `POST /reset` with `mode=scheduled` clears only scheduled tables. `mode=instant` clears only shared/instant tables. Re-seed the mode's default data after clearing.
- Dedicated route prefix: `/api/scheduled/*` vs `/api/*` (instant)
- Template endpoint: `/api/scheduled/template` writes to `scheduled_template`, `/api/template` writes to `template WHERE mode='instant'`

### 3. Frontend State Layer — Separate Context Fields
SessionContext (or equivalent) holds both mode states independently:
```
// Instant mode state
queue, stats, template  (from shared tables)

// Scheduled mode state  
scheduledBatches, scheduledDrafts, scheduledStats, scheduledTemplate  (from dedicated tables)
```
- `loadSession(mode)` fetches from the correct bootstrap response fields
- Mode switch triggers a fresh data load from the correct endpoints
- Switching from instant to scheduled should NOT clear instant state (preserve for when user switches back)

### 4. SSE Layer — Event Routing by Mode
- Scheduled events have type prefix: `scheduled_batch_progress`, `scheduled_draft_ready`, `scheduled_batch_complete`
- Instant events: `state_change`, `progress`, `sent`, `skipped` (no prefix)
- Frontend SSE subscription filters: scheduled page only handles `scheduled_*` events; instant page only handles unprefixed events
- EventBus events carry `mode: 'scheduled'` or `mode: 'instant'` field for explicit routing
- **Never** let a scheduled event update the shared `queue` state, or an instant event update `scheduledBatches`

### 5. Frontend UI Layer — Mode-Specific Screens
- Each mode has its own page/component with its own step flow
- Scheduled page: Import+Schedule card (date/time picker + import tabs → creates batch), Batch Progress, Draft Review, Template Editor
- Instant page: Import, Roster, Processing Queue (shared), Template Editor
- No shared components that read from the wrong mode's state (e.g. AgentFlowBar reads from `queue` — don't use it on scheduled page)

## File Upload for Mode-Specific Endpoints

When a mode-specific endpoint (like `POST /scheduled/batch`) needs to accept file imports:
- **Don't add multipart handling** to every mode endpoint
- **Handle client-side**: Use a shared upload preview endpoint (`POST /upload/preview`) that parses the file and returns extracted emails
- Frontend then passes `{emails: [...], scheduled_at, url}` in the POST body to the mode endpoint
- This keeps mode endpoints clean — they accept structured data, not files

## Scheduler/Worker Architecture

For scheduled mode, the agent processes items immediately (scrape→research→draft) but delays sending:
- `POST /scheduled/batch` triggers `startScheduledBatchProcessing` right away (scrape/research/draft pipeline)
- After drafting, if `auto_approve=1` (default), drafts auto-approve → batch status → 'scheduled' (awaiting send time)
- If `auto_approve=0`, batch stays in 'drafted' status → user reviews/approves → batch → 'scheduled'
- A scheduler cron (e.g. `setInterval(checkScheduledBatches, 30000)`) finds batches where `scheduled_at <= now AND status='scheduled'` and calls `sendScheduledBatch`
- `sendScheduledBatch` only sends drafts with `status='approved'`
- Multiple batches work in parallel: agent processes new batches while old batches send at their scheduled times

## Diagnostic: Cross-Contamination Symptoms

- Switching to scheduled mode shows instant-mode queue items
- Resetting scheduled mode clears instant-mode data
- SSE event from instant mode updates scheduled batches table
- Scheduled page imports create items in shared `queue` table instead of `scheduled_professors`
- Template edits in scheduled mode affect instant-mode template
- **CRITICAL: Shared functions querying wrong table** — `sendEmail(professor_id)` looked up `professors` (instant) table regardless of mode, so scheduled mode IDs resolved to wrong people

## Shared Function Table Resolution Rule

Any function that receives a mode-crossing ID (like `professor_id`) MUST resolve it against the **mode-specific table**, not a shared one. This is the most dangerous cross-contamination bug because it's invisible in the code structure — the function works "correctly" for instant mode, but silently sends data to the wrong person in scheduled mode.

**Concrete example**: `sendEmail({ professor_id: 5, mode: 'scheduled' })` must query `scheduled_professors WHERE id=5`, NOT `professors WHERE id=5`. The `professors.id=5` could be a completely different person from a previous instant-mode batch.

**Implementation pattern**:
```js
// Before (BUG — always uses instant table):
const prof = db.prepare('SELECT email, last_name FROM professors WHERE id=?').get(item.professor_id);

// After (FIX — mode-aware table resolution):
let prof;
if (itemMode === 'scheduled') {
  prof = db.prepare('SELECT email, last_name FROM scheduled_professors WHERE id=?').get(item.professor_id);
} else {
  prof = db.prepare('SELECT email, last_name FROM professors WHERE id=?').get(item.professor_id);
}
```

This applies to **every shared function** that accesses mode-specific data:
- `sendEmail` → professor lookup, template lookup
- Any validation or logging function that uses `professor_id`
- Stats/reporting queries that join on professor tables

**Always pass `mode` explicitly** when calling shared functions from mode-specific pipelines. Don't rely on defaults (`mode = 'instant'`) — the default masks the bug.

## Verification Checklist

After implementing multi-mode separation:
1. `GET /bootstrap?mode=scheduled` — no `queue` field, has `batches` + `drafts`
2. `GET /bootstrap?mode=instant` — has `queue` + `stats`, no `batches` field
3. `POST /reset {mode: 'scheduled'}` — instant queue untouched, scheduled tables cleared
4. `POST /reset {mode: 'instant'}` — scheduled batches untouched, instant tables cleared
5. Scheduled page DOM — no references to shared `queue` state
6. Instant page — no references to `scheduledBatches` state
7. SSE: scheduled event arrives → instant queue unchanged; instant event → scheduled batches unchanged
8. Switch mode → correct data loads, previous mode's data preserved (not cleared)
