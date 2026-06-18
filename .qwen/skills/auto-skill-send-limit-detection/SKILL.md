---
name: send-limit-detection
description: Detect Gmail/API quota errors in async worker pipelines — stop the worker immediately (don't retry), publish SSE event, and show warning toast on frontend
source: auto-skill
extracted_at: '2026-06-18T00:11:08.852Z'
---

# Send Limit Detection in Async Worker Pipelines

When a worker loop processes queue items and hits an API quota/rate-limit error (e.g. Gmail "User-rate limit exceeded"), the generic retry path wastes time and may worsen the situation. Instead, detect send-limit errors specifically, stop the worker, and notify the user.

## The Problem

A worker loop like this treats all errors the same:
```js
try {
  await processQueueItem(item);
} catch (e) {
  // Generic retry with backoff — wrong for quota errors!
  updateState(item.id, 'pending', { error: e.message });
}
```

Gmail's "User-rate limit exceeded. Retry after 2026-06-17T23:34:35.427Z" will fail every retry attempt until the quota resets. The worker will burn through 3 retries (4min, 8min cooldowns) before marking it `failed`, with no clear user-facing message about what happened.

## The Pattern

### 1. Import the limit detection function into the worker
```js
import { sendEmail, isSendLimitError } from '../gmail/index.js';
```

The detection function checks for quota-related keywords (case-insensitive):
```js
function isSendLimitError(e) {
  const msg = String(e?.message || '').toLowerCase();
  return msg.includes('limit for sending mail')
    || msg.includes('sending limit')
    || msg.includes('quota')
    || msg.includes('too many requests')
    || msg.includes('rate limit')
    || msg.includes('daily limit');
}
```

### 2. Check for send limits BEFORE generic retry in the worker catch block
```js
try {
  await processQueueItem(item);
} catch (e) {
  if (isSendLimitError(e)) {
    updateState(item.id, 'failed', { error: e.message });
    publishStep('failed', item, { label: 'Gmail send limit reached', error: true });
    eventBus.publish({ type: 'send_limit_reached', id: item.id, mode: item.mode || 'instant', error: e.message });
    shouldRun = false;  // Stop the worker loop entirely
    eventBus.publish({ type: 'agent_stopped', mode: item.mode || 'instant', label: 'Send limit reached — retry later' });
  } else {
    // Normal retry path for transient errors
    const retries = (item.retry_count || 0) + 1;
    // ... exponential backoff
  }
}
```

Key: `shouldRun = false` stops the worker loop so no more items are attempted.

### 3. Frontend: Handle the SSE event with a warning toast
```js
if (data.type === 'send_limit_reached') {
  toast.warning('User-rate limit exceeded. Wait some time before sending again.');
  setAgentStopped(true);
  scheduleRefresh();
}
```

### 4. Show "Done" toast on batch completion
```js
if (data.type === 'batch_complete') {
  toast.success('Done');
  scheduleRefresh();
}
```

## Distinction from worker-retry-cooldown

- `worker-retry-cooldown` handles **transient errors** (network blips, temporary API issues) — retry with backoff makes sense
- `send-limit-detection` handles **quota errors** — retrying will always fail until the quota resets, so stop immediately and tell the user
- Both patterns coexist in the same worker catch block as an if/else

## When to Use

- Any queue worker that calls external APIs with quotas (Gmail, email services, AI APIs)
- The error message contains rate-limit/quota keywords
- Retrying will not help — the limit resets on a fixed schedule (daily, hourly)
