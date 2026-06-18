---
name: atomic-queue-claim
description: Prevent race conditions in queue workers by claiming items atomically (SELECT+UPDATE in a transaction) so no two workers can process the same item
source: auto-skill
extracted_at: '2026-06-12T05:56:10.927Z'
---

# Atomic Queue Claim for Worker Loops

When a worker loop fetches the next item from a queue and then updates its state, the SELECT and UPDATE are two separate operations. If another worker (or concurrent API call) runs between them, both can claim the same item — causing double-processing or double-sends.

## The Bug

```js
// NON-ATOMIC: two operations, race window between them
function getNext() {
  const item = db.prepare("SELECT * FROM queue WHERE state='pending' LIMIT 1").get();
  // ← another worker could SELECT the same item here
  return item;
}
// ... later in the loop:
updateState(item.id, 'researching');
```

If two workers call `getNext()` simultaneously, both get the same row. Both then process it. Result: duplicate emails, duplicate API calls, wasted tokens.

## The Fix: Claim in a Transaction

Wrap SELECT + state UPDATE in a single `db.transaction()`. The UPDATE's WHERE clause checks the original state, so if another worker already claimed it, `changes === 0` and we skip it.

```js
function getNext() {
  const claimItem = db.transaction((selectSql) => {
    const item = db.prepare(selectSql).get();
    if (!item) return null;
    // Atomically claim: only succeeds if state is still 'pending'/'needs_review'
    const updated = db.prepare(
      "UPDATE queue SET state='researching' WHERE id=? AND state IN ('pending','needs_review')"
    ).run(item.id);
    if (updated.changes === 0) return null; // another worker claimed it first
    return item;
  });

  // Try preferred item first, then fast-track, then regular
  if (preferredQueueId) {
    const preferred = db.transaction((id) => {
      const item = db.prepare("SELECT * FROM queue WHERE state IN ('pending','needs_review') AND id=?").get(id);
      if (!item) return null;
      const updated = db.prepare("UPDATE queue SET state='researching' WHERE id=? AND state IN ('pending','needs_review')").run(item.id);
      if (updated.changes === 0) return null;
      return item;
    })(preferredQueueId);
    preferredQueueId = null;
    if (preferred) return preferred;
  }

  const fast = claimItem("SELECT * FROM queue WHERE state IN ('pending','needs_review') AND fast_track=1 ORDER BY id LIMIT 1");
  if (fast) return fast;

  return claimItem("SELECT * FROM queue WHERE state IN ('pending','needs_review') ORDER BY id LIMIT 1");
}
```

## Key Details

- **`updated.changes === 0`** is the guard: if another worker already moved this item to `researching`, the UPDATE's WHERE clause won't match, and we return null (skip it)
- **better-sqlite3 transactions** are synchronous and atomic — no async gap between SELECT and UPDATE
- **The state check in WHERE** (`AND state IN ('pending','needs_review')`) is critical — without it, the UPDATE would succeed on any state including `researching`, defeating the guard
- **For async DB drivers** (pg, mysql2), use `SELECT FOR UPDATE` or advisory locks instead

## When to Use

Any worker/queue system where:
- Multiple workers or concurrent API calls could fetch the same item
- Processing an item twice has real consequences (double-sends, duplicate API calls)
- The DB driver supports transactions (better-sqlite3, PostgreSQL, etc.)

## What Not to Do

```js
// DON'T: separate select and update without transaction
const item = selectNext();
if (item) updateState(item.id, 'researching');
// Race window between these two lines

// DON'T: update without state guard in WHERE
db.prepare("UPDATE queue SET state='researching' WHERE id=?").run(item.id);
// This succeeds even if another worker already moved it to 'researching'
```