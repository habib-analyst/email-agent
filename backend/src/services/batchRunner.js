import db from '../db/index.js';
import { eventBus } from '../core/EventBus.js';
import { prioritizeQueue, startWorkers } from '../pipeline/index.js';
import { AuthService } from './AuthService.js';
import { GmailService } from './GmailService.js';

/** Shared batch kickoff — used by upload, professors import, and POST /queue/run-batch */
export async function autoStartBatchQueue(queueIds, source = 'batch_import', mode = 'instant') {
  if (!queueIds?.length) return { autoStarted: false, templateLoaded: false, count: 0 };

  const placeholders = queueIds.map(() => '?').join(',');
  const runnable = db.prepare(`
    SELECT id FROM queue
    WHERE id IN (${placeholders})
      AND state IN ('pending', 'awaiting_proceed', 'failed', 'needs_review')
      AND state != 'needs_web_research'
  `).all(...queueIds).map(r => r.id);

  if (!runnable.length) {
    return { autoStarted: false, templateLoaded: false, count: 0, skippedNeedsWeb: queueIds.length };
  }

  const runPh = runnable.map(() => '?').join(',');
  db.prepare(`UPDATE queue SET fast_track=0, state='pending', retry_after=NULL, error=NULL WHERE id IN (${runPh}) AND state NOT IN ('sent','researching','drafted','verified','sending','needs_web_research')`).run(...runnable);
  for (const qid of runnable) prioritizeQueue(qid);

  let templateResult = { success: false };
  if (AuthService.isConnected()) {
    try {
      templateResult = await GmailService.tryAutoLoadTemplate(source, mode);
    } catch (e) {
      console.error('[BatchRunner] Template load failed:', e.message);
    }
  }

  eventBus.publish({
    type: 'batch_auto_start',
    mode,
    count: runnable.length,
    label: `Starting outreach for ${runnable.length} professor(s)`,
  });
  if (templateResult.success) {
    eventBus.publish({ type: 'template_loaded', source, mode });
  }
  return { autoStarted: true, templateLoaded: templateResult.success, count: runnable.length };
}

/** Start all pending / awaiting items for a mode (Run Batch). */
export async function runBatchForMode(mode = 'instant', { queueIds, source = 'run_batch' } = {}) {
  let ids = queueIds;
  if (!ids?.length) {
    ids = db.prepare(`
      SELECT id FROM queue
      WHERE mode=? AND state IN ('pending', 'awaiting_proceed', 'failed', 'needs_review')
      ORDER BY id
    `).all(mode).map(r => r.id);
  }
  if (!ids.length) return { autoStarted: false, templateLoaded: false, count: 0, message: 'No items to start' };
  startWorkers();
  return autoStartBatchQueue(ids, source, mode);
}

export function getQueueProgress(mode = 'instant') {
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN state IN ('pending','awaiting_proceed','researching','drafted','verified','sending') THEN 1 ELSE 0 END) as remaining,
      SUM(CASE WHEN state='sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN state IN ('failed','skipped') THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN state='duplicate_review' THEN 1 ELSE 0 END) as duplicates
    FROM queue WHERE mode=?
  `).get(mode);

  const avgMs = db.prepare(`
    SELECT AVG(
      (julianday(COALESCE(sent_at, datetime('now'))) - julianday(research_started_at)) * 86400000
    ) as avg_ms
    FROM queue WHERE mode=? AND state='sent' AND research_started_at IS NOT NULL
  `).get(mode)?.avg_ms;

  const remaining = row?.remaining || 0;
  const etaMinutes = avgMs && remaining > 0 ? Math.ceil((avgMs * remaining) / 60000) : null;

  return {
    total: row?.total || 0,
    remaining,
    sent: row?.sent || 0,
    failed: row?.failed || 0,
    duplicates: row?.duplicates || 0,
    etaMinutes,
    complete: remaining === 0 && (row?.total || 0) > 0,
  };
}
