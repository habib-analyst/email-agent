const ACTIVE_QUEUE_STATES = new Set([
  'pending', 'awaiting_proceed', 'researching', 'drafted', 'verified', 'sending', 'needs_review',
]);

const ACTIVE_BATCH_STATUSES = new Set(['processing', 'sending', 'drafted', 'scheduled', 'pending']);

/** True when instant/basic_instant queue finished sending and nothing is still in progress. */
export function isInstantWorkflowComplete(queue = [], stats) {
  if (!queue.length && !(stats?.sent > 0)) return false;

  const hasSent = queue.some(q => q.state === 'sent') || (stats?.sent || 0) > 0;
  const hasActive = queue.some(q => ACTIVE_QUEUE_STATES.has(q.state));
  const hasDuplicateReview = queue.some(q => q.state === 'duplicate_review');
  const allTerminal = queue.length > 0 && !hasActive && !hasDuplicateReview;

  return hasSent && allTerminal;
}

/** True when all scheduled batches are done sending. */
export function isScheduledWorkflowComplete(batches = []) {
  if (!batches.length) return false;

  const hasSent = batches.some(b => b.status === 'completed' || (b.sent_count || b.sent || 0) > 0);
  const hasActive = batches.some(b => ACTIVE_BATCH_STATUSES.has(b.status));

  return hasSent && !hasActive;
}
