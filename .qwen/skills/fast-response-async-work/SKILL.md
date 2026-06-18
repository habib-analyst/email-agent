---
name: fast-response-async-work
description: Prevent frontend timeout aborts by making backend endpoints respond immediately and doing slow async work (API calls, template loading) in background — communicate results via SSE or event bus
source: auto-skill
extracted_at: '2026-06-11T22:55:14.892Z'
---

# Fast Response + Async Background Work

When a backend endpoint needs to do slow work (external API calls, file processing, template loading) **as a side effect** of a user action, never block the HTTP response waiting for that work to finish. The frontend's request timeout (`AbortController`) will abort the fetch, causing confusing errors like "signal is aborted without reason".

## The Pattern

### 1. Do the critical DB change first, respond immediately
```js
router.post('/queue/:id/proceed', async (req, res) => {
  // Critical state change — this is what the user actually needs
  PipelineService.proceed(req.params.id);
  
  // Respond RIGHT NOW — frontend gets success instantly
  res.json({ success: true, message: 'Agent processing now' });
  
  // Slow work happens AFTER response is sent
  GmailService.tryAutoLoadTemplate('proceed_now')
    .then(result => {
      if (result.success) eventBus.publish({ type: 'template_loaded', source: 'proceed_now' });
    })
    .catch(e => console.error('[Proceed] Template load failed:', e.message));
});
```

### 2. Communicate async results via SSE / event bus
The frontend should listen for SSE events (`template_loaded`, `state_change`) instead of expecting the result in the HTTP response. This way:
- The user gets immediate feedback ("Agent processing now")
- Slow results arrive later as push events and update the UI reactively

### 3. Frontend handler should not wait for side-effect results
```js
// BEFORE (broken — waits for templateLoaded in response):
const res = await post(`/queue/${id}/proceed`);
setImportMsg(res.templateLoaded ? 'Template loaded!' : 'No template');

// AFTER (fixed — accepts fast response, SSE delivers the rest):
const res = await post(`/queue/${id}/proceed`);
setImportMsg('Agent started — processing now');
// Template status arrives later via SSE → state change updates UI
```

## Multiple-Email Batch Import — Same Problem, Different Path

The `/professors` POST route for multiple emails calls `autoStartBatchQueue()` which in turn calls `GmailService.tryAutoLoadTemplate()` before responding. This is the same blocking pattern — the batch import can also timeout if Gmail is slow. The fix: make `autoStartBatchQueue` respond first, then load template async.

This pattern applies to **any route that does "insert + auto-start"** — the auto-start side effects (template loading, notification emails) should not block the insert response.

## When to Apply

Any endpoint where:
- A fast DB/state change is the **primary** user intent
- Slow side effects (Gmail API, AI generation, scraping) are **secondary**
- The frontend has a request timeout (AbortController, fetch timeout)
- Batch import routes that insert items AND auto-start processing

## Why It Works

- Frontend timeout (typically 30s) never fires because response comes in <1s
- The critical user action (state change, queue reset) is committed before response
- Async work failures don't roll back the committed action — they're handled separately
- SSE/push events keep the UI updated without requiring the user to refresh

## What to Avoid

- Don't put `await slowApiCall()` before `res.json()` — that's the whole problem
- Don't make the frontend timeout longer (e.g., 60s) — it just shifts the failure window, doesn't fix it
- Don't forget error handling on the async work — `.catch()` prevents unhandled promise rejections after the response is sent
- Don't skip the state change before responding — if the async call fails, the user's intent should still be committed

## Diagnostic Signal

If you see "signal is aborted without reason" or `AbortError` in the frontend, check the endpoint handler: is there an `await` on a slow operation before `res.json()` / `res.send()`? That's the root cause.