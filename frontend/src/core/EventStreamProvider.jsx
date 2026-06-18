import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { eventStream } from '../core/eventStream.js';
import { useSession } from '../context/SessionContext.jsx';

const EventStreamContext = createContext(null);

// Stable subscribe reference — never changes, so SSE effects don't re-run
const stableSubscribe = eventStream.subscribe.bind(eventStream);

/**
 * Central SSE hub — all pages subscribe here instead of opening their own EventSource.
 */
export function EventStreamProvider({ children }) {
  const { backendReachable } = useSession();
  const [connected, setConnected] = useState(false);

  const value = useMemo(() => ({ connected, subscribe: stableSubscribe }), [connected]);

  useEffect(() => {
    if (!backendReachable) {
      eventStream.disconnect();
      setConnected(false);
      return undefined;
    }

    eventStream.connect();
    const unsub = eventStream.subscribe((data) => {
      if (data.type === 'stream_connected') setConnected(true);
      if (data.type === 'stream_disconnected') setConnected(false);
    });
    setConnected(eventStream.isConnected());
    return () => { unsub(); eventStream.disconnect(); };
  }, [backendReachable]);

  return (
    <EventStreamContext.Provider value={value}>
      {children}
    </EventStreamContext.Provider>
  );
}

export function useEventStream() {
  const ctx = useContext(EventStreamContext);
  if (!ctx) throw new Error('useEventStream must be used within EventStreamProvider');
  return ctx;
}

export default EventStreamProvider;
