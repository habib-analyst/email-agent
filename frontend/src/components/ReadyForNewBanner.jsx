import React from 'react';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { isInstantWorkflowComplete, isScheduledWorkflowComplete } from '../utils/workflowComplete.js';

/** Shown when a batch/run is finished — prompts user to start fresh. */
export default function ReadyForNewBanner({
  queue = [],
  batches = [],
  stats,
  onStartNew,
  resetting = false,
  label = 'batch',
  className = '',
}) {
  const scheduledMode = batches.length > 0;

  if (scheduledMode) {
    if (!isScheduledWorkflowComplete(batches)) return null;
    const sentCount = batches.reduce((n, b) => n + (b.sent_count || b.sent || 0), 0);
    return (
      <div className={`flex flex-wrap items-center gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-neutral-800 border border-emerald-200 dark:border-emerald-800 ${className}`}>
        <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm text-emerald-800 dark:text-emerald-200">Ready for a new {label}?</h3>
          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5">
            {sentCount} email{sentCount !== 1 ? 's' : ''} sent across completed batches. Analytics are saved.
          </p>
        </div>
        <button type="button" onClick={onStartNew} disabled={resetting}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white text-xs font-semibold shadow-sm transition-colors shrink-0">
          <RotateCcw className="w-3.5 h-3.5" />
          {resetting ? 'Clearing…' : 'Start new task'}
        </button>
      </div>
    );
  }

  if (!queue.length && !(stats?.sent > 0)) return null;

  if (!isInstantWorkflowComplete(queue, stats)) return null;

  const sentCount = queue.filter(q => q.state === 'sent').length || stats?.sent || 0;

  return (
    <div className={`flex flex-wrap items-center gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-neutral-800 border border-emerald-200 dark:border-emerald-800 ${className}`}>
      <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold text-sm text-emerald-800 dark:text-emerald-200">Ready for a new {label}?</h3>
        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5">
          {sentCount} email{sentCount !== 1 ? 's' : ''} sent. Analytics are saved — start a new {label} when you are ready.
        </p>
      </div>
      <button
        type="button"
        onClick={onStartNew}
        disabled={resetting}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white text-xs font-semibold shadow-sm transition-colors shrink-0"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        {resetting ? 'Clearing…' : 'Start new task'}
      </button>
    </div>
  );
}
