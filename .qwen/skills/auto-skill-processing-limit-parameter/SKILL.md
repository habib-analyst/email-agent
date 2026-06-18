---
name: processing-limit-parameter
description: Add a user-controlled max count/limit parameter across the full stack — frontend input, API passthrough, DB storage, array slicing in processing — with the critical gotcha of replacing ALL .length references, plus upload route and scheduled batch handling
source: auto-skill
extracted_at: '2026-06-14T22:38:11.839Z'
---

# Adding a Processing Limit Parameter

Use this when the user wants an input field controlling how many items to process (e.g. "max 10 professors", "limit to 5 emails"). The limit applies to all import methods (URL scraping, paste, file upload) and must flow from frontend through API → DB → processing.

## Procedure

### Step 1 — Frontend: add input + pass to API calls
- Add a `useState` for the limit value (default `''` — empty means "all")
- Add a number input field with min/max bounds (e.g. 1–500), placeholder "All"
- On each API call that creates/imports items, pass `max_professors: limitValue ? parseInt(limitValue) : undefined`
- Apply to **all import paths** in the mode (URL scrape, paste emails, file upload confirm)

### Step 2 — Backend routes: accept + slice or store
For each route that handles import:

**Email/paste routes** — slice the array immediately:
```js
const { emails, mode, max_professors } = req.body;
const limitedEmails = max_professors ? emails.slice(0, max_professors) : emails;
// Use limitedEmails for all downstream processing and totals
```

**URL scrape routes** — pass as options to the scrape job:
```js
const { max_professors } = req.body;
startFacultyImport(url, publish, { max_professors });
```

**Scheduled batch routes** — store the limit in DB so it's applied when the batch is processed later:
```js
db.prepare('INSERT INTO batches (..., max_professors) VALUES (..., ?)').run(max_professors || null);
```

### Step 3 — DB: add column migration
```js
alterTableSilent("ALTER TABLE <table> ADD COLUMN max_professors INTEGER");
```
Use `INTEGER` (no DEFAULT) — NULL means "process all", a number means "slice to that count".

### Step 4 — Processing: apply the limit after generating the full list
In the processing function (scrape job, scheduler, etc.), apply the limit **after** scraping/generating the full list, **before** any iteration:

```js
const limitedProfessors = job.max_professors ? professors.slice(0, job.max_professors) : professors;
console.log(`Found ${professors.length} professors, processing ${limitedProfessors.length} (max: ${job.max_professors || 'all'})`);
```

For scheduled batches, load `max_professors` from DB when processing queued items:
```js
const batch = db.prepare('SELECT source_url, source_emails, max_professors FROM batches WHERE id=?').get(batchId);
max_professors = batch?.max_professors || null;
if (max_professors && professors.length > max_professors) {
  professors = professors.slice(0, max_professors);
}
```

### Step 5 — ⚠️ CRITICAL GOTCHA: Replace ALL `.length` references

When you introduce `limitedX = X.slice(0, limit)`, you must replace **every** subsequent reference to `X.length` with `limitedX.length`. This is the most common mistake:

**Keep `X.length` ONLY in the initial discovery log** ("Found X, processing Y").
**Replace `X.length` with `limitedX.length` EVERYWHERE else:**
- Progress event totals: `total: limitedProfessors.length`
- Loop bounds: `for (let b = 0; b < limitedProfessors.length; b += BATCH)`
- Batch iteration: `batch = limitedProfessors.slice(b, b + BATCH_SIZE)`
- Completion totals: `total: limitedProfessors.length`
- DB updates: `db.prepare('UPDATE ... SET total=?').run(limitedProfessors.length, ...)`

**Why:** If you leave `professors.length` in progress events, the frontend shows the wrong total (e.g. "Processing 50 professors" when only 10 are actually being processed). Users see progress jump from 10/50 to complete, which is confusing.

### Step 6 — Verify
- `npm run build` (frontend) — must pass
- `node -e "import('./src/routes/<route>.js')"` for each modified backend module — must load without errors
- `node -e "import('./src/pipeline/<processor>.js')"` for modified processing modules — must load without errors

## Key Rules

- **NULL means "all"** — don't default to 0 or some arbitrary number. `max_professors || null` in DB, `max_professors ? slice : original` in code.
- **Slice once, use everywhere** — create the `limitedX` variable at one point, then use it for all subsequent operations. Don't slice again in nested loops.
- **Check all import methods** — URL scrape, paste emails, and file upload all need the limit applied. Don't miss any path.
- **Both modes separately** — instant and scheduled modes have separate routes, separate DB tables, separate processing. Apply the limit in both independently.
