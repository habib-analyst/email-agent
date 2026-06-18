---
name: null-state-crash-guard
description: Prevent React crashes from null state when switching modes or after page refresh — initialize with EMPTY constant objects instead of null, and use optional chaining for all property reads
source: auto-skill
extracted_at: '2026-06-14T23:16:21.869Z'
---

# Null State Crash Guard — React Mode Switching

Prevent "Cannot read properties of null (reading 'X')" crashes that occur when React components render with null state during mode transitions or after page refresh.

## Root Cause Pattern

When a React context manages separate state objects for different modes (e.g., `stats` for instant mode, `scheduledStats` for scheduled mode):

1. User is on **mode A** — `modeAStats` loads async, `modeBStats` stays `null`
2. User refreshes page — `sessionReady` becomes `true` after bootstrap for **mode A**
3. User switches to **mode B** — component passes the `sessionReady` loading guard, but `modeBStats` is still `null` (async load hasn't completed yet)
4. Component accesses `modeBStats.todaySent` → **crash**

The `sessionReady` guard doesn't protect because it's set to `true` once and never reset on mode change. The null state object persists until the async load for the new mode completes.

## Fix: Initialize with EMPTY Constants, Not Null

```jsx
// WRONG — null state causes crashes on mode switch
const [stats, setStats] = useState(null);
const [scheduledStats, setScheduledStats] = useState(null);

// RIGHT — EMPTY objects prevent null-access crashes
const EMPTY_STATS = { total: 0, sent: 0, pending: 0, todaySent: 0, ... };
const EMPTY_SCHEDULED_STATS = { total: 0, sent: 0, batches: {}, todaySent: 0, ... };

const [stats, setStats] = useState(EMPTY_STATS);
const [scheduledStats, setScheduledStats] = useState(EMPTY_SCHEDULED_STATS);
```

This ensures every property read returns a sensible default (0, empty array, etc.) instead of throwing "Cannot read properties of null".

## Belt-and-Suspenders: Use Optional Chaining

Even with EMPTY initializations, add `?.` for safety in property reads:

```jsx
// WRONG
<span>Today: {stats.todaySent || 0} sent</span>

// RIGHT
<span>Today: {stats?.todaySent || 0} sent</span>
```

This protects against:
- State being reset to `null` somewhere else in the codebase
- A future developer changing the initial value back to `null`
- Race conditions during state transitions

## Why the Loading Guard Doesn't Help

```jsx
if (!sessionReady) return <LoadingSpinner />;
// ↓ After this guard, stats might STILL be null for a different mode
```

`sessionReady` is typically set to `true` once during initial bootstrap and never reset. When the user switches modes, the component passes the guard immediately but the new mode's state hasn't loaded yet. The guard protects the initial page load, not mode transitions.

## Diagnostic Signals

- "Cannot read properties of null (reading 'todaySent')" or similar → state initialized as null
- Crash happens only after page refresh + mode switch, not on first load → sessionReady guard passes before state loads
- One mode works, the other crashes → the working mode's state loaded, the other is still null

## When to Apply

- Any React context with multiple mode-specific state objects (instant/scheduled, admin/user, etc.)
- When adding a new mode to an existing app that uses null initialization
- When a component reads properties from context state without `?.` or null guards
- After changing `useState(null)` to `useState(EMPTY_OBJECT)` in SessionContext or similar
