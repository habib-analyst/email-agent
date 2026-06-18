---
name: oauth-token-mutex
description: Serialize concurrent OAuth token file writes with an in-process mutex to prevent race conditions that corrupt .tokens.json
source: auto-skill
extracted_at: '2026-06-12T06:24:35.064Z'
---

# OAuth Token File Write Mutex

When multiple concurrent API calls trigger OAuth token refresh events, each `getAuthedClient()` instance fires a `tokens` event handler that calls `saveTokens(merged)` — writing to `.tokens.json` simultaneously. This causes race conditions: concurrent `writeFileSync` calls can interleave, corrupting the JSON file and losing tokens.

## The Bug

```js
// In auth/index.js — each OAuth2 client instance has this handler
client.on('tokens', (newTokens) => {
  const merged = { ...tokens, ...newTokens };
  saveTokens(merged);        // writeFileSync — no serialization
  client.setCredentials(merged);
});
// If 3 concurrent calls all trigger refresh at the same time,
// 3 writeFileSync calls race → file corruption
```

## The Fix: In-Process Write Lock with Queue

```js
let writeLock = false;
let writeQueue = [];

function drainWriteQueue() {
  while (writeQueue.length > 0 && !writeLock) {
    const { tokens, resolve: res } = writeQueue.shift();
    writeLock = true;
    try { writeFileSync(TOKEN_PATH, encryptJson(tokens)); } finally { writeLock = false; }
    res();
  }
}

function saveTokens(tokens) {
  if (writeLock) {
    // Queue this write — it will execute after the current one finishes
    return new Promise(resolve => { writeQueue.push({ tokens, resolve }); });
  }
  // No lock held — write immediately, then drain any queued writes
  writeLock = true;
  try { writeFileSync(TOKEN_PATH, encryptJson(tokens)); } finally { writeLock = false; drainWriteQueue(); }
}
```

## Key Details

- **`writeLock` flag** prevents concurrent `writeFileSync` — only one write at a time
- **`writeQueue`** collects pending writes — they execute sequentially after the lock releases
- **Returns a Promise** when queued — callers can optionally `await` if they need to confirm write completion, but most callers fire-and-forget (event handlers)
- **`drainWriteQueue()`** runs after each write completes — processes all queued writes until empty
- **No async gap** between lock acquisition and file write — `writeFileSync` is synchronous, so the lock is held for the entire write operation
- **Tokens are always merged before writing** — `const merged = { ...tokens, ...newTokens }` ensures refresh tokens aren't lost

## When to Use

Any system where:
- OAuth token refresh events can fire concurrently (multiple Gmail API calls, SSE streams, reply checking)
- Tokens are persisted to a single file (`.tokens.json`, `credentials.json`, etc.)
- `writeFileSync` is used for persistence (no built-in concurrency control)
- Token corruption causes auth failures that waste all retry attempts

## What Not to Do

```js
// DON'T: write without serialization — concurrent writes corrupt the file
client.on('tokens', (newTokens) => {
  writeFileSync(TOKEN_PATH, JSON.stringify({ ...tokens, ...newTokens }));
});

// DON'T: use async writeFile without ordering — writes can still interleave
client.on('tokens', async (newTokens) => {
  await writeFile(TOKEN_PATH, JSON.stringify({ ...tokens, ...newTokens }));
  // Two async writes can still overlap before the first completes
});
```