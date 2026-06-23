import React, { useEffect, useState } from 'react';
import { Play, Loader2, Clock } from 'lucide-react';
import { post, get } from '../api.js';
import { useToast } from './Toast.jsx';
import { useEventStream } from '../core/EventStreamProvider.jsx';

/** One-click run batch + ETA progress. */
export default function RunBatchBar({ mode = 'instant', onStarted, className = '' }) {
  const toast = useToast();
  const { connected, subscribe } = useEventStream();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [loadError, setLoadError] = useState('');

  const loadProgress = async () => {
    try {
      const p = await get(`/queue/progress?mode=${mode}`);
      setProgress(p);
      setLoadError('');
    } catch (error) {
      setLoadError(error.message || 'Progress could not refresh');
    }
  };

  useEffect(() => {
    loadProgress();
    if (connected) return undefined;
    const id = setInterval(loadProgress, 30000);
    return () => clearInterval(id);
  }, [mode, connected]);

  useEffect(() => subscribe(event => {
    if (event.mode && event.mode !== mode) return;
    if (['progress', 'state_change', 'sent', 'send_limit_reached'].includes(event.type)) loadProgress();
  }), [mode, subscribe]);

  const runBatch = async () => {
    setRunning(true);
    try {
      const res = await post('/queue/run-batch', { mode });
      toast.success(res.message || `Started ${res.count || ''} professor(s)`);
      onStarted?.();
      loadProgress();
    } catch (e) {
      toast.error(e.message || 'Could not start batch');
    } finally {
      setRunning(false);
    }
  };

  if (!progress && !running && !loadError) return null;

  return (
    <div className={`flex flex-wrap items-center gap-2 p-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-neutral-800 ${className}`}>
      <button
        type="button"
        onClick={runBatch}
        disabled={running}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors disabled:opacity-60"
      >
        {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
        Run batch
      </button>
      {progress && progress.total > 0 && (
        <span className="text-[11px] text-emerald-800 dark:text-emerald-200">
          {progress.sent}/{progress.total} sent
          {progress.remaining > 0 && ` · ${progress.remaining} left`}
          {progress.etaMinutes != null && progress.remaining > 0 && (
            <span className="inline-flex items-center gap-0.5 ml-1 text-emerald-600">
              <Clock className="w-3 h-3" /> ~{progress.etaMinutes}m
            </span>
          )}
          {progress.complete && ' · Complete'}
        </span>
      )}
      {loadError && (
        <button type="button" onClick={loadProgress} className="text-[10px] font-semibold text-red-600 hover:underline">
          {loadError} · Retry
        </button>
      )}
    </div>
  );
}
