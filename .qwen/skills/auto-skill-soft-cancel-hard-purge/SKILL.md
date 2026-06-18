---
name: soft-cancel-hard-purge
description: Two-level deletion for batch/data items — soft cancel (status change) for active items, hard purge (DB removal) for completed/cancelled items. Prevents stale items from cluttering the UI while preserving in-progress data.
source: auto-skill
extracted_at: '2026-06-14T23:00:14.218Z'
---

# Soft Cancel + Hard Purge Pattern

When users need to delete batches or data items, use two levels of deletion based on the item's lifecycle state:

- **Active items** (pending, processing, drafted, scheduled) → **Soft cancel**: set status to `cancelled`, stop processing, but keep the data in DB for audit/history
- **Completed/cancelled items** → **Hard purge**: remove from DB entirely (batch, drafts, professors, sent_log), publish SSE event so frontend removes from UI

## Why Two Levels

- Soft cancel on active items is safe — processing agents need to see the cancelled status to stop work. Deleting the row while an agent is querying it causes "batch not found" errors mid-pipeline.
- Hard purge on completed/cancelled items removes stale clutter from the UI. These items have no active agents and no audit value — keeping them just fills the batch list with dead entries.
- A single "delete" action should automatically pick the right level based on status, so users don't need to understand the distinction.

## Implementation

### Backend — Two Endpoints

```js
// Soft cancel — for active batches
router.delete('/batch/:id', (req, res) => {
  db.prepare("UPDATE batches SET status='cancelled' WHERE id=?").run(req.params.id);
  db.prepare("UPDATE drafts SET status='cancelled' WHERE batch_id=? AND status NOT IN ('sent')").run(req.params.id);
  eventBus.publish({ type: 'batch_cancelled', mode: 'scheduled', batchId: parseInt(req.params.id) });
  res.json({ success: true });
});

// Hard purge — for completed/cancelled batches
router.delete('/batch/:id/purge', (req, res) => {
  const batchId = parseInt(req.params.id);
  const drafts = db.prepare('SELECT professor_id FROM drafts WHERE batch_id=?').all(batchId);
  const profIds = drafts.map(d => d.professor_id).filter(Boolean);

  db.prepare('DELETE FROM drafts WHERE batch_id=?').run(batchId);
  db.prepare('DELETE FROM sent_log WHERE batch_id=?').run(batchId);
  if (profIds.length) {
    db.prepare(`DELETE FROM professors WHERE id IN (${profIds.join(',')})`).run();
  }
  db.prepare('DELETE FROM batches WHERE id=?').run(batchId);
  eventBus.publish({ type: 'batch_cancelled', mode: 'scheduled', batchId });
  res.json({ success: true });
});
```

Key points:
- Purge collects professor IDs from drafts before deleting drafts (FK cleanup)
- Both endpoints publish the same SSE event type — frontend handles removal the same way
- Purge uses parameterized IN clause only when profIds exist (avoid empty IN syntax error)

### Frontend — Single Delete Button with Smart Dispatch

```jsx
// In the card header (always visible, not just when expanded)
<button onClick={(e) => {
  e.stopPropagation(); // prevent expanding the card when clicking delete
  setConfirmAction({
    type: ['completed','cancelled'].includes(batch.status) ? 'purge' : 'cancel'
  });
}}>
  <Trash2 className="w-3.5 h-3.5 text-red-500" />
</button>

// In the confirm handler
const doConfirmAction = async () => {
  if (confirmAction.type === 'cancel') await del(`/scheduled/batch/${batch.id}`);
  else if (confirmAction.type === 'purge') await del(`/scheduled/batch/${batch.id}/purge`);
  // ...
  onRefresh?.();
};
```

Key points:
- `e.stopPropagation()` prevents the card expand handler from firing when clicking delete
- The button is in the **card header** (always visible), not buried in an expanded action bar
- Confirmation dialog shows the batch number: "Cancel Batch #3?" vs "Permanently delete Batch #3?"
- `opacity-40 hover:opacity-100` styling keeps the trash icon subtle but discoverable

### SSE Handler — Same Event, Same UI Response

Both cancel and purge publish `scheduled_batch_cancelled`. The frontend SSE handler removes the batch from the list:

```jsx
if (data.type === 'scheduled_batch_cancelled') {
  setScheduledBatches(prev => prev.map(b =>
    b.id === data.batchId ? { ...b, status: 'cancelled' } : b
  ));
  if (expandedBatchId === data.batchId) setExpandedBatchId(null);
}
```

For purge, `onRefresh()` after the API call will reload batches from the server — the purged batch won't appear at all.

## Verification

1. Create an active batch → click header trash → confirm dialog shows "Cancel Batch #X" → batch status becomes `cancelled`
2. After batch completes → click header trash → confirm shows "Permanently delete Batch #X" → batch disappears from UI entirely
3. While batch is processing → click header trash → confirm shows "Cancel" → agent stops, batch marked cancelled
4. SSE event fires in both cases → other connected tabs update immediately
