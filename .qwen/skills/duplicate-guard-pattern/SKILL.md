---
name: duplicate-guard-pattern
description: Prevent duplicate emails with user-controlled toggle, cross-mode sent_log dedup, and correct state semantics (skipped not sent)
source: auto-skill
extracted_at: '2026-06-13T23:46:18.911Z'
---

# Duplicate Guard Pattern for Queue-Based Email Systems

When users can add emails multiple times (paste, file upload, URL scrape), the system must prevent re-sending to professors who already received an email. Three complementary patterns are needed: a **state guard on re-insertion**, **correct state semantics**, and a **user-controlled dedup toggle**.

## Pattern 1: State Guard on Queue Re-Insertion

When a user adds an email that already has a queue entry, **check the current state before deciding to reset it**. Never reset terminal/active states back to `pending` or `awaiting_proceed` — that causes duplicate real emails.

### State Classification

| Category | States | Action on re-add |
|----------|--------|-----------------|
| **Terminal** | `sent` | Skip — don't re-queue |
| **Active/In-flight** | `researching`, `drafted`, `verified`, `sending` | Skip — already being processed |
| **Retryable** | `pending`, `failed`, `needs_review`, `skipped`, `awaiting_proceed` | Reset to appropriate initial state |

## Pattern 2: `skipped` Not `sent` for Duplicate Semantics

When the worker detects a professor was already emailed (via `sent_log` check), set the state to `skipped` — **not `sent`**. Using `sent` is misleading because the email was NOT sent again.

- `sent` = "an email was actually delivered" — users expect a real email exists
- `skipped` = "this item was deliberately not processed" — honest about what happened
- The `error` field (`duplicate_skipped`) provides the specific reason

## Pattern 3: User-Controlled Duplicate Guard Toggle (CRITICAL)

### The Bug (what happened without the toggle)

Scheduled mode had **zero dedup protection** at any point (batch creation, processing, sending). The scheduler would happily re-send to professors already emailed. Instant mode had `duplicate_review` state, but scheduled mode had no equivalent.

### The Fix — Full Stack Toggle

**Frontend**: Segmented toggle "Skip Duplicates" (default, green) vs "Allow All" (amber) in the import card, alongside Approval Mode toggle.

```jsx
const [skipDuplicates, setSkipDuplicates] = useState(true);
// Pass to API:
const res = await post('/scheduled/batch', { ..., skip_duplicates: skipDuplicates });
```

**Backend (POST /batch)**: When `skip_duplicates !== false`, filter emails against both `sent_log` AND `scheduled_sent_log` before storing:

```js
if (skip_duplicates !== false && processedEmails) {
  const filtered = [];
  for (const email of emailList) {
    const inInstant = db.prepare('SELECT 1 FROM sent_log WHERE professor_email=?').get(email.toLowerCase());
    const inScheduled = db.prepare('SELECT 1 FROM scheduled_sent_log WHERE professor_email=?').get(email.toLowerCase());
    if (inInstant || inScheduled) { skippedEmails.push(email); }
    else { filtered.push(email); }
  }
  processedEmails = filtered;
}
```

**Backend (scheduler.js — URL scraping path)**: After scraping professors from URL, dedup against both sent_log tables BEFORE research/drafting:

```js
professors = professors.filter(p => {
  const inInstant = db.prepare('SELECT 1 FROM sent_log WHERE professor_email=?').get(p.email.toLowerCase());
  const inScheduled = db.prepare('SELECT 1 FROM scheduled_sent_log WHERE professor_email=?').get(p.email.toLowerCase());
  return !inInstant && !inScheduled;
});
```

### Cross-Mode Dedup

Always check BOTH `sent_log` (instant mode) AND `scheduled_sent_log` (scheduled mode). A professor emailed in instant mode should also be deduped in scheduled mode, and vice versa.

## When to Apply

Any queue-based outreach system where:
- Users can add emails through multiple paths (paste, upload, scrape)
- The same email could be added more than once
- Items have lifecycle states (pending → researching → sent)
- A `sent_log` table tracks actually-delivered emails
- There are multiple operational modes (instant/scheduled) with separate tables

## Diagnostic Signals

- Professor receives two identical outreach emails → missing state guard or dedup toggle
- Queue UI shows "sent" for items that weren't actually emailed → wrong state semantics
- Stats count includes duplicates in "sent" total → `skipped` should be its own category
- Scheduled batch re-sends to already-emailed professors → missing scheduler dedup filter