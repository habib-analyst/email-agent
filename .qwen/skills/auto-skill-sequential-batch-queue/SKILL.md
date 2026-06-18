---
name: sequential-batch-queue
description: Prevent parallel batch processing — sequential queue where new batches wait for previous batch to finish drafting, then auto-start. Includes manual approval toggle, View/Edit popup per draft, and edge-case batch transitions (all-deleted → cancelled).
source: auto-skill
extracted_at: '2026-06-14T19:38:14.847Z'
---

# Sequential Batch Queue + Manual Approval for Scheduled Mode

When multiple batches can be created in quick succession, they must NOT all process in parallel (competes for AI tokens, overwhelms free-tier quotas). Use a sequential processing queue: one batch at a time, next batch starts only after previous finishes draft generation.

## Architecture

### 1. Processing Queue (in-memory, backend)

```js
const processingQueue = [];   // Batch IDs waiting to process
let currentlyProcessing = null; // Batch ID currently being processed

export function enqueueBatch(batchId) {
  if (!processingQueue.includes(batchId) && currentlyProcessing !== batchId) {
    processingQueue.push(batchId);
  }
  if (currentlyProcessing === null) processNextInQueue();
}

function processNextInQueue() {
  if (processingQueue.length === 0) { currentlyProcessing = null; return; }
  const batchId = processingQueue.shift();
  currentlyProcessing = batchId;
  // Update DB status + emit SSE so frontend knows batch started
  db.prepare("UPDATE scheduled_batches SET status='processing' WHERE id=? AND status IN ('pending')").run(batchId);
  eventBus.publish({ type: 'scheduled_batch_processing_started', mode: 'scheduled', batchId });
  startScheduledBatchProcessing(batchId);  // fire async
}

function advanceQueue() {
  currentlyProcessing = null;
  processNextInQueue();  // always advances, even on error
}
```

### 2. Always Advance Queue on Completion/Error

The queue must never stall. If a batch fails, advance anyway:

```js
export async function startScheduledBatchProcessing(batchId, opts) {
  try {
    // ... research + draft generation ...
  } catch (e) {
    // mark batch failed
  }
  advanceQueue();  // ALWAYS call — next batch starts regardless
}
```

**Key:** "Completion" = draft generation finished (not full lifecycle including email sending). When a batch finishes drafting and enters 'drafted' (manual review), the next batch starts immediately. The user reviews the previous batch's drafts independently while the next batch processes.

### 3. Store Source Data in DB for Queue Processing

When `POST /batch` creates a batch, store emails/URL in the DB row so the queue can re-process later:

```js
// scheduled_batches table: add source_emails column
alterTableSilent("ALTER TABLE scheduled_batches ADD COLUMN source_emails TEXT");

// Route handler: serialize emails as JSON
const emailsJson = emails ? JSON.stringify(Array.isArray(emails) ? emails : ...) : null;
db.prepare('INSERT INTO scheduled_batches (..., source_emails) VALUES (...,?)').run(..., emailsJson);

// Scheduler loads from DB when processing from queue:
if (!url && !emails) {
  const batch = db.prepare('SELECT source_url, source_emails FROM scheduled_batches WHERE id=?').get(batchId);
  url = batch?.source_url || null;
  emails = batch?.source_emails ? JSON.parse(batch.source_emails) : null;
}
```

### 4. Startup Re-Queuing

On server start, re-queue any existing pending/processing batches:

```js
export function startScheduler() {
  resumeCrashedBatches();
  const pending = db.prepare("SELECT id FROM scheduled_batches WHERE status IN ('pending','processing') ORDER BY id").all();
  for (const b of pending) {
    if (!processingQueue.includes(b.id)) processingQueue.push(b.id);
  }
  if (currentlyProcessing === null) processNextInQueue();
}
```

### 5. Manual/Auto Approval Toggle

Two modes per batch, stored as `auto_approve` column (INTEGER, default 1):

- **Auto (auto_approve=1):** All drafts auto-approved → batch → 'scheduled' → scheduler sends at scheduled time
- **Manual (auto_approve=0):** Batch → 'drafted' → user reviews each draft → approve individually → when all approved, batch → 'scheduled'

Frontend toggle in import card:
```jsx
const [autoApprove, setAutoApprove] = useState(true);
// POST /batch passes auto_approve: autoApprove ? 1 : 0
```

### 6. Batch State Transitions on Draft Approve/Delete

When individual drafts are approved or deleted, check if remaining drafts are all approved:

```js
// POST /draft/:id/approve
router.post('/draft/:id/approve', (req, res) => {
  db.prepare("UPDATE scheduled_drafts SET status='approved' WHERE id=? AND status='draft'").run(id);
  const draft = db.prepare('SELECT batch_id FROM scheduled_drafts WHERE id=?').get(id);
  const remainingDrafts = db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts WHERE batch_id=? AND status='draft'").get(draft.batch_id).count;
  if (remainingDrafts === 0) {
    db.prepare("UPDATE scheduled_batches SET status='scheduled' WHERE id=? AND status='drafted'").run(draft.batch_id);
    eventBus.publish({ type: 'scheduled_batch_approved', ... });
  }
});

// DELETE /draft/:id — same check, plus edge case
router.delete('/draft/:id', (req, res) => {
  db.prepare('DELETE FROM scheduled_drafts WHERE id=?').run(id);
  const remainingCount = db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts WHERE batch_id=?").get(batch_id).count;
  if (remainingCount === 0) {
    // ALL drafts deleted → cancel batch (not 'scheduled' with zero drafts)
    db.prepare("UPDATE scheduled_batches SET status='cancelled' WHERE id=?").run(batch_id);
  } else {
    // Check if remaining are all approved
    const remainingDrafts = db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts WHERE batch_id=? AND status='draft'").get(batch_id).count;
    if (remainingDrafts === 0) {
      db.prepare("UPDATE scheduled_batches SET status='scheduled' WHERE id=? AND status='drafted'").run(batch_id);
    }
  }
});
```

**Edge case:** If all drafts in a batch are deleted, the batch must become 'cancelled' (NOT 'scheduled'). An empty set satisfies "all approved" trivially — a batch with 0 drafts would enter sending phase and crash.

### 7. View/Edit Popup per Draft (contentEditable pattern)

Reuse the `custom-html-edit-override` skill pattern:
- View mode: `<iframe srcDoc={popupHtml} sandbox="allow-same-origin" />`
- Edit mode: `<div ref={editableRef} contentEditable suppressContentEditableWarning />` with same Roboto/14px/1.6 styling
- Toggle View/Edit with button
- Save writes `custom_html` via `PUT /draft/:id` with `{ custom_html: html }`
- Approve, Delete, Close buttons in popup footer
- `custom_html` stored in separate DB column (NOT replacing `html_preview`)
- Sending uses `custom_html` if present, else `html_preview`

### 8. Queue Badge on Frontend

When a batch is in queue but not yet processing, show "Queued" badge:

```jsx
{batch.status === 'pending' && <span className="badge">Queued</span>}
```

SSE event `scheduled_batch_processing_started` updates batch status from 'pending' → 'processing' in real-time.

### 9. Batch States (Full Lifecycle)

```
pending → processing → drafted → scheduled → sending → completed
                                    ↗ failed
                                    ↗ cancelled
```

- `pending`: In queue, waiting to be processed
- `processing`: Agent scraping/researching/drafting
- `drafted`: All drafts generated, awaiting manual approval
- `scheduled`: All drafts approved, awaiting send time
- `sending`: Gmail sending in progress
- `completed`: All sends done
- `failed`: Processing or sending error
- `cancelled`: User cancelled, or all drafts deleted

## When to Use

- Scheduled/batch mode where multiple batches can be created sequentially
- Free-tier AI APIs with limited quotas (parallel processing exhausts tokens faster)
- Manual approval workflows where users review each draft before sending
- Systems needing individual draft View/Edit/Approve/Delete actions

## Counter Patterns

- DON'T process multiple batches in parallel on free-tier APIs — token exhaustion
- DON'T let a failed batch block the queue — always advanceQueue() on error
- DON'T transition a batch to 'scheduled' when all drafts are deleted — cancel it instead
- DON'T push custom_html through SSE — it's large, already in DB
