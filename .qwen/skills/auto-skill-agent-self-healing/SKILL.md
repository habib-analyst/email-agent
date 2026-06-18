---
name: agent-self-healing
description: Detect and recover stuck batch processing by periodically checking for stale 'processing' status, resetting to 'pending' with a heal_count cap to prevent infinite re-queuing
source: auto-skill
extracted_at: '2026-06-14T00:00:00.000Z'
---

# Agent Self-Healing — Stuck Batch Recovery

When async batch processing crashes, hangs, or the server restarts mid-batch, batches can get stuck in 'processing' status permanently. A periodic health check resets these back to 'pending' and re-enqueues them, with a maximum heal cap to prevent infinite loops.

## The Pattern

### 1. Add `heal_count` column to the batch table
```sql
ALTER TABLE scheduled_batches ADD COLUMN heal_count INTEGER DEFAULT 0;
```

### 2. Periodic health check — scheduled in `startScheduler`
```js
const HEAL_THRESHOLD_MIN = 30;  // Consider stuck after 30 minutes
const HEAL_MAX_COUNT = 3;       // Max 3 heals before marking as failed

let healInterval = null;

function healStuckScheduledBatches() {
  const stuck = db.prepare(`
    SELECT id, heal_count FROM scheduled_batches
    WHERE status = 'processing'
      AND created_at < datetime('now', '-${HEAL_THRESHOLD_MIN} minutes')
  `).all();

  for (const batch of stuck) {
    const healCount = (batch.heal_count || 0) + 1;
    if (healCount >= HEAL_MAX_COUNT) {
      // Cap exceeded — permanent failure
      db.prepare("UPDATE scheduled_batches SET status='failed', heal_count=? WHERE id=?").run(healCount, batch.id);
      // Remove from processing queue, clear currentlyProcessing if this batch
    } else {
      // Reset to pending and re-enqueue
      db.prepare("UPDATE scheduled_batches SET status='pending', heal_count=? WHERE id=?").run(healCount, batch.id);
      enqueueBatch(batch.id);  // Re-queue for sequential processing
    }
  }
}

// In startScheduler:
healInterval = setInterval(healStuckScheduledBatches, 60000);  // Check every 60s
// In stopScheduler:
if (healInterval) { clearInterval(healInterval); healInterval = null; }
```

### 3. Reset token usage on scheduler start
```js
import { resetTokenUsage } from '../ai/index.js';

export function startScheduler() {
  resetTokenUsage();  // Fresh quota each restart — avoids false exhaustion
  ...
}
```

### 4. Research retry — single retry on failure before marking failed
```js
try {
  dossier = await threeAgentResearch(email, sourceUrl, profileUrl);
} catch (e) {
  // Retry once before giving up
  try {
    dossier = await threeAgentResearch(email, sourceUrl, profileUrl);
  } catch (e2) {
    // Both attempts failed — mark as research failure
  }
}
```

### 5. Pass profile_url from scrapeFacultyPage to threeAgentResearch
```js
// In scheduler.js — scrapeFacultyPage now returns professors with profile_url
// from Step 10 deep scraping. Pass it so Phase 0 can try profile-first research.
dossier = await threeAgentResearch(p.email, p.source_url || '', p.profile_url || '');
```

Without this, threeAgentResearch gets no profileUrl and always falls through to AI web search, wasting the deep-scraped profile data that Step 10 already collected.

## Why It Works

- **30-min threshold**: Normal batch processing takes 2-15 minutes for 10 professors. 30 minutes is clearly stuck.
- **3-heal cap**: Prevents infinite re-queuing of batches that always fail (e.g., bad URL, invalid template). After 3 attempts, mark as `failed` permanently.
- **DB-driven heal_count**: Survives server restarts — unlike in-memory retry counters.
- **Sequential queue coordination**: If the healed batch was `currentlyProcessing`, clearing it allows the queue to advance. Otherwise just re-enqueued.

## Distinction from Worker-Retry-Cooldown

- `worker-retry-cooldown` handles **individual queue item** retry with exponential backoff — transient failures
- `agent-self-healing` handles **batch-level** stuck detection — batches left in 'processing' after crashes/hangs
- These are complementary, not overlapping

## When to Use

- Any system with long-running batch processing that can crash mid-way
- Server restart scenarios where batches are left in 'processing' state
- Sequential queue systems where a stuck batch blocks all subsequent batches

## Diagnostic Signals

- `[Scheduler] Healing stuck batch #5 (heal #1, stuck >30min)` — batch recovered
- `[Scheduler] Batch #5 exceeded 3 heals — marking failed` — permanent failure after 3 attempts
- Batches staying in 'processing' for >30min with no SSE events — stuck
- After server restart, batches still 'processing' but no worker active — stuck
