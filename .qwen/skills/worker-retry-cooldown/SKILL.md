---
name: worker-retry-cooldown
description: Prevent tight retry loops in async workers by adding a retry_after column with exponential backoff — stops failed items from being picked up instantly
source: auto-skill
extracted_at: '2026-06-10T20:50:39.565Z'
---

# Worker Retry Cooldown with Exponential Backoff

When an async worker loop processes queue items and retries failures, a naive approach (reset state to `pending`) creates a tight-loop: the worker picks up the same item instantly, re-fails, re-resets, infinitely.

## The Pattern

### 1. Add `retry_after` column to the queue table
```sql
ALTER TABLE queue ADD COLUMN retry_after DATETIME;
```

### 2. Skip items in the fetch query
The worker's "get next" query must skip items whose cooldown hasn't expired:
```sql
SELECT ... FROM queue WHERE state='pending'
  AND (retry_after IS NULL OR retry_after <= datetime('now'))
ORDER BY id LIMIT 1
```

### 3. Set cooldown on failure — exponential backoff
```js
const retries = item.retry_count + 1;
const cooldownMin = 2 ** retries * 2; // 2min, 4min, 8min, ...
db.prepare(`
  UPDATE queue SET retry_count=?, retry_after=datetime('now', ? || ' minutes')
  WHERE id=?
`).run(retries, String(cooldownMin), item.id);
```

### 4. Apply consistently — both in the catch handler AND in auto-fix/skip logic
Both the general error handler and any verification-failure handler (like `autoFixOrSkip`) must use `retry_after`. If only one path uses it, the loop persists through the other path.

## Why It Works

- First retry waits 2 minutes — enough for transient issues (rate limits, network blips) to resolve
- Exponential growth means persistent failures back off gracefully instead of hammering
- `retry_after IS NULL` handles legacy items and first attempts (no artificial delay)
- Database-driven cooldown survives worker restarts — no in-memory state lost

## When to Use

Any queue-based worker loop where:
- A failure should be retried, but not immediately
- The failure might be transient (API rate limits, network timeouts)
- The worker runs in a `while(true)` loop polling the queue

## What to Avoid

- Don't use in-memory timers (`setTimeout`) — they're lost on restart
- Don't skip the `retry_after IS NULL` check — it breaks first attempts
- Don't set the same cooldown for all retry counts — defeats the purpose of backoff