import { useEffect, useRef } from 'react';
import { isInstantWorkflowComplete, isScheduledWorkflowComplete } from '../utils/workflowComplete.js';

/**
 * After a batch finishes sending, auto-clear workspace sections for the next task.
 * Debounced so the final sent state is visible briefly before reset.
 */
export default function useAutoClearAfterBatch({
  enabled = true,
  queue = [],
  batches = [],
  stats,
  onClear,
  resetting = false,
  delayMs = 2000,
}) {
  const firedRef = useRef(false);
  const timerRef = useRef(null);
  const scheduledMode = batches.length > 0;

  useEffect(() => {
    firedRef.current = false;
  }, [queue.length, batches.length]);

  useEffect(() => {
    if (!enabled || resetting || typeof onClear !== 'function') return;

    const complete = scheduledMode
      ? isScheduledWorkflowComplete(batches)
      : isInstantWorkflowComplete(queue, stats);

    if (!complete) {
      firedRef.current = false;
      return undefined;
    }

    if (firedRef.current) return undefined;

    timerRef.current = setTimeout(() => {
      if (firedRef.current) return;
      firedRef.current = true;
      onClear();
    }, delayMs);

    return () => clearTimeout(timerRef.current);
  }, [enabled, queue, batches, stats, onClear, resetting, delayMs, scheduledMode]);
}
