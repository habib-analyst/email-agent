import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from '../api.js';
import { useEventStream } from '../core/EventStreamProvider.jsx';

const REFRESH_EVENTS = new Set([
  'sent', 'sent_history_updated', 'state_change', 'progress', 'awaiting_proceed',
  'duplicate_review', 'delivery_failure_updated', 'reply_updated', 'reply_scan_complete',
  'gmail_connected', 'gmail_disconnected', 'sending_paused', 'send_limit_reached',
  'scheduled_batch_updated', 'scheduled_batch_approved', 'scheduled_batch_drafted',
  'scheduled_batch_rescheduled', 'scheduled_batch_retry_scheduled',
  'scheduled_batch_sending', 'scheduled_batch_complete', 'scheduled_batch_error',
]);

export default function useOperationalSummary(mode) {
  const { connected, subscribe } = useEventStream();
  const [data, setData] = useState(null);
  const [state, setState] = useState('refreshing');
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const debounceRef = useRef(null);
  const dataRef = useRef(null);

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    setState(current => current === 'live' ? 'refreshing' : current);
    const run = () => get(`/api-usage?mode=${encodeURIComponent(mode)}`, { timeout: 12000 });
    try {
      let result;
      try {
        result = await run();
      } catch {
        await new Promise(resolve => setTimeout(resolve, 500));
        result = await run();
      }
      if (requestId !== requestRef.current) return;
      dataRef.current = result;
      setData(result);
      setError('');
      setState('live');
    } catch (loadError) {
      if (requestId !== requestRef.current) return;
      setError(loadError.message || 'Operational cards could not refresh');
      setState(dataRef.current ? 'stale' : 'error');
    }
  }, [mode]);

  useEffect(() => {
    refresh();
  }, [mode]);

  useEffect(() => subscribe(event => {
    const sameModeFamily = event.mode === mode
      || (['scheduled', 'basic_scheduled'].includes(mode) && ['scheduled', 'basic_scheduled'].includes(event.mode))
      || (['instant', 'basic_instant'].includes(mode) && ['instant', 'basic_instant'].includes(event.mode));
    if (event.mode && !sameModeFamily) return;
    if (!REFRESH_EVENTS.has(event.type) && !event.type?.startsWith('scheduled_')) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(refresh, 500);
  }), [mode, refresh, subscribe]);

  useEffect(() => {
    if (connected) return undefined;
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [connected, refresh]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  return {
    data,
    refresh,
    freshness: {
      state,
      error,
      updatedAt: data?.operational?.updatedAt || null,
      connected,
      retry: refresh,
    },
  };
}
