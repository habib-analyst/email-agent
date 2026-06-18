---
name: sse-data-consistency
description: Prevent SSE-patched data from being overwritten by stale full-refreshes, and fix stale closures where effect callbacks read outdated state values
source: auto-skill
extracted_at: '2026-06-12T22:54:38.024Z'
---

# SSE Data Consistency in React

When SSE events arrive with partial data (state changes, progress updates), two bugs can silently corrupt the UI:

1. **Stale refresh overwrite**: An optimistic in-place patch updates the UI immediately, then a delayed full server refresh overwrites it with older data
2. **Stale closure read**: An SSE effect callback reads state values that were captured when the effect was created, not the current values

## Bug 1: Stale Refresh Overwrite

### The Problem

```jsx
// SSE handler — updates queue optimistically
if (data.type === 'state_change') {
  patchQueueFromEvent(data);      // ✓ in-place update: setQueue(prev => prev.map(...))
  scheduleRefresh();              // ✗ schedules full loadSession() in 600ms
}

// 600ms later — loadSession() replaces ENTIRE queue with server data
// If server response is stale (DB hasn't committed yet), the optimistic patch is erased
applyServerData = (s, q, t, an) => {
  setQueue(Array.isArray(q) ? q : []);  // wholesale replacement
};
```

The user sees: state flashes to updated → reverts to old → eventually catches up on next SSE/poll cycle.

### The Fix: Only refresh for events that genuinely need new data

Events that **already have all the data** (state_change, progress, sent, skipped) should NOT trigger a full refresh. The optimistic patch is sufficient. Only trigger `loadSession()` for events where **new items appear** (scrape_complete adds queue items, batch_auto_start changes the entire batch state, template_loaded changes template data):

```jsx
if (data.type === 'state_change') {
  patchQueueFromEvent(data);
  showAgentStep(data);
  // NO scheduleRefresh() — patch already updated the UI
}
if (data.type === 'progress') {
  patchQueueFromEvent(data);
  showAgentStep(data);
  // NO scheduleRefresh() — progress data is in the event
}
if (data.type === 'sent') {
  patchQueueFromEvent(data);
  // Targeted refresh: only update analytics, not entire queue
  get('/analytics?mode=instant').then(a => { if (a?.overview) setAnalytics(a); });
  // NO scheduleRefresh() — sent data is in the event
}
if (data.type === 'scrape_complete') {
  // Full refresh IS needed — new queue items appeared that don't exist in current state
  loadSession();
}
if (data.type === 'template_loaded') {
  // Full refresh IS needed — template data changed
  scheduleRefresh();
}
```

### Decision Rule

Ask: **"Does the SSE event payload contain all the data the UI needs?"**
- Yes → patch in-place, NO full refresh
- No → full refresh (new items, changed collections, or data not in the event)

## Bug 2: Stale Closure Read

### The Problem

```jsx
const [pendingProceedId, setPendingProceedId] = useState(null);

useEffect(() => {
  return subscribe((data) => {
    if (data.type === 'sent') {
      // Reads pendingProceedId from CLOSURE — captured when effect was created
      if (pendingProceedId) {              // ✗ always reads initial null
        setPendingProceedId(null);         // ✗ never fires because condition is always false
      }
    }
  });
}, [subscribe]); // pendingProceedId NOT in deps — stale closure!
```

After `setPendingProceedId(queueId)` fires, the SSE callback still sees the old `null` value. The auto-clear on sent event never triggers — the "Proceed Now" UI stays stuck even after the email was sent.

Adding `pendingProceedId` to the dependency array would "fix" the closure but cause the SSE effect to re-run on every proceed state change — reconnecting the SSE stream, causing event loss. This is the classic React effect dilemma: stale closure vs unstable dependency.

### The Fix: Ref + State dual tracking

Use a **ref** alongside state so the SSE callback reads the ref (always current) while React renders read the state (triggers re-renders):

```jsx
const pendingProceedIdRef = useRef(null);
const [pendingProceedId, setPendingProceedId] = useState(null);

// Every setter call also updates the ref
const setPendingProceedIdBoth = (val) => {
  setPendingProceedId(val);
  pendingProceedIdRef.current = val;
};

// SSE callback reads the REF (current value, not stale closure)
if (data.type === 'sent') {
  if (pendingProceedIdRef.current) {
    setPendingProceedId(null); pendingProceedIdRef.current = null;
  }
}

// React components read the STATE (triggers re-render)
const proceedTarget = queue.find(q => q.id === pendingProceedId);
```

**Key insight**: The ref is a mutable box that always holds the current value. The SSE callback reads from the box, not from the frozen closure. The state is for React's rendering system. Both must be updated together.

### Apply to all values read in SSE/effect callbacks

Any state value that's:
- Read inside an SSE `subscribe` callback
- Read inside a `useEffect` callback
- NOT in that effect's dependency array (because adding it would cause instability)

Needs a ref mirror. Typical candidates:
- `pendingProceedId`, `proceedingId` (action tracking IDs)
- `sessionEpoch` (epoch validation)
- `editingItem` (current edit target)

## Diagnostic Signals

**Stale refresh overwrite**: UI flashes to updated state then reverts to old state within ~600ms. The revert timing matches the `scheduleRefresh` delay.

**Stale closure read**: An action that should auto-complete (like clearing a "proceed" state after a sent event) never fires. The UI stays stuck showing the action even after the triggering event arrives.

## What Not to Do

```jsx
// DON'T: add action-state values to SSE effect dependency array
// This causes the effect to re-run → unsubscribe/resubscribe → event loss
}, [subscribe, pendingProceedId, proceedingId]);

// DON'T: schedule full refresh after every SSE event
// Overwrites optimistic patches with stale server data
scheduleRefresh();  // after every patchQueueFromEvent

// DON'T: use only state inside SSE callbacks
// Closure captures the value when effect was created, not current value
if (pendingProceedId) { ... }  // always null in closure

// DON'T: use only refs for values that need re-render
// Refs don't trigger re-renders — UI won't update
if (pendingProceedIdRef.current) { setPendingProceedId(null); }
// The proceedTarget useMemo won't recalculate because state didn't change
```

## When to Use

Any React app where:
- SSE/WebSocket events update UI state via optimistic patches
- Full server data fetches are scheduled after events (debounced `loadSession`)
- Effect callbacks read state values that change after the effect was created
- The dependency array deliberately excludes fast-changing values to avoid re-running the effect
