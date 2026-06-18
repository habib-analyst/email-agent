---
name: stable-sse-subscribe
description: Keep SSE subscribe reference identity stable across renders to prevent the main SSE effect from unsubscribing/re-subscribing on every render (causing event loss)
source: auto-skill
extracted_at: '2026-06-12T06:24:35.064Z'
---

# Stable SSE Subscribe Reference for React

When an SSE EventStreamProvider passes `subscribe` via React context, unstable reference identity causes the consuming component's SSE `useEffect` to unsubscribe and re-subscribe on every render. During the cleanup/setup gap, SSE events are silently lost.

## The Bug

```jsx
// EventStreamProvider.jsx — creates NEW function on every render
<EventStreamContext.Provider value={{ connected, subscribe: eventStream.subscribe.bind(eventStream) }}>
```

Every render produces a new `.bind()` result → new `subscribe` reference → every component that uses `subscribe` in its `useEffect` dependency array re-runs → unsubscribes old handler → subscribes new handler → events during the gap are lost.

Even worse: `useCallback` wrapping the event handler with an `onEvent` prop dependency creates the same instability — any parent state change that changes `onEvent` recreates `handleEvent`, recreating the provider effect, disconnecting/reconnecting the entire SSE stream.

## The Fix: Module-Level Stable Reference

```jsx
// EventStreamProvider.jsx
import { eventStream } from '../core/eventStream.js';

// Bind once at module level — identity never changes across renders
const stableSubscribe = eventStream.subscribe.bind(eventStream);

export function EventStreamProvider({ children }) {
  const [connected, setConnected] = useState(false);

  const value = useMemo(() => ({ connected, subscribe: stableSubscribe }), [connected]);

  useEffect(() => {
    eventStream.connect();
    const unsub = eventStream.subscribe((data) => {
      if (data.type === 'stream_connected') setConnected(true);
      if (data.type === 'stream_disconnected') setConnected(false);
    });
    setConnected(eventStream.isConnected());
    return () => { unsub(); eventStream.disconnect(); };
  }, []); // ← empty deps — effect runs once, never re-runs

  return (
    <EventStreamContext.Provider value={value}>
      {children}
    </EventStreamContext.Provider>
  );
}
```

## Key Details

- **`stableSubscribe`** is created at module level (outside any component) → `eventStream.subscribe.bind(eventStream)` executes once → the resulting function has stable identity for the entire app lifetime
- **`useMemo`** wraps the context value → only updates when `connected` actually changes → `subscribe` reference stays constant
- **Provider effect has empty `[]` deps** — no dependency on event handler identity → SSE connection is established once and never torn down/recreated
- **Consumer effects with `subscribe` in deps** now see the same reference every render → effect doesn't re-run → no unsubscribe/resubscribe gap → no event loss
- **Removed `onEvent` prop** from provider — it was the source of instability (if parent state changed, `onEvent` identity changed, recreating `handleEvent`, recreating provider effect). Events are handled by consumers directly via `subscribe`.

## When to Use

Any React app where:
- A singleton service (EventStream, WebSocket, message bus) is exposed via context
- Multiple components subscribe to the same real-time stream
- The `subscribe` function is in `useEffect` dependency arrays
- Events are being lost or streams reconnect unnecessarily

## Diagnostic Signal

If you see SSE/WebSocket events arriving in the service's `_emit()` but not reaching consumer components, check if `subscribe` reference identity changes across renders. Add a `console.log('SSE effect re-run')` in the consumer effect — if it logs on every state update, the reference is unstable.

## What Not to Do

```jsx
// DON'T: bind inside the component — new reference every render
value={{ connected, subscribe: eventStream.subscribe.bind(eventStream) }}

// DON'T: use onEvent prop that changes identity — cascading reconnections
<EventStreamProvider onEvent={handlerThatChangesIdentity}>
// handlerThatChangesIdentity is recreated when parent state updates

// DON'T: useCallback with changing deps — same problem
const handleEvent = useCallback((data) => { onEvent?.(data); }, [onEvent]);
```