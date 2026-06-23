import db from '../db/index.js';
import { eventBus } from '../core/EventBus.js';

const RESET_BUFFER_MS = 2 * 60 * 1000;

function toSqliteUtc(value) {
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
}

export function gmailRetryTimeWithBuffer(resetAt) {
  const resetMs = resetAt ? new Date(resetAt).getTime() : 0;
  if (!Number.isFinite(resetMs) || resetMs <= Date.now()) return null;
  return new Date(resetMs + RESET_BUFFER_MS).toISOString();
}

export function rescheduleBatchesAfterGmailReset(resetAt, reason = 'Gmail sending limit') {
  const retryAt = gmailRetryTimeWithBuffer(resetAt);
  if (!retryAt) return { retryAt: null, updated: 0, batchIds: [] };

  const scheduledAt = toSqliteUtc(retryAt);
  const resetAtSql = toSqliteUtc(resetAt);
  const batches = db.prepare(`
    SELECT id
    FROM scheduled_batches
    WHERE auto_approve=1
      AND status IN ('pending','processing','drafted','scheduled','sending')
      AND (scheduled_at IS NULL OR julianday(scheduled_at) <= julianday(?))
      AND (
        gmail_retry_at IS NULL
        OR gmail_reset_at IS NULL
        OR gmail_retry_at != ?
        OR gmail_reset_at != ?
      )
    ORDER BY id
  `).all(scheduledAt, scheduledAt, resetAtSql);

  if (!batches.length) return { retryAt, updated: 0, batchIds: [] };
  const ids = batches.map(batch => batch.id);
  const placeholders = ids.map(() => '?').join(',');
  db.transaction(() => {
    db.prepare(`
      UPDATE scheduled_batches
      SET status='scheduled',
          scheduled_at=?,
          gmail_reset_at=?,
          gmail_retry_at=?,
          send_attempts=0,
          ready_notice_sent_at=NULL,
          manual_due_notified_at=NULL
      WHERE id IN (${placeholders})
    `).run(scheduledAt, resetAtSql, scheduledAt, ...ids);
    db.prepare(`
      UPDATE scheduled_drafts
      SET status='approved'
      WHERE batch_id IN (${placeholders})
        AND status='failed'
        AND lower(COALESCE(error,'')) LIKE '%limit%'
    `).run(...ids);
  })();

  for (const batchId of ids) {
    db.prepare(`
      INSERT INTO scheduled_batch_history
        (batch_id, action, to_status, scheduled_at, gmail_reset_at, detail)
      SELECT ?, 'gmail_limit_rescheduled', 'scheduled', ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM scheduled_batch_history
        WHERE batch_id=?
          AND action='gmail_limit_rescheduled'
          AND scheduled_at=?
          AND gmail_reset_at=?
          AND TRIM(COALESCE(detail,''))=TRIM(COALESCE(?,''))
      )
    `).run(
      batchId, scheduledAt, resetAtSql, reason,
      batchId, scheduledAt, resetAtSql, reason,
    );
    eventBus.publish({
      type: 'scheduled_batch_retry_scheduled',
      mode: 'scheduled',
      batchId,
      retryAt,
      resetAt,
      bufferMinutes: 2,
      reason,
      label: `Batch #${batchId} will retry 2 minutes after Gmail resets`,
    });
  }
  return { retryAt, updated: ids.length, batchIds: ids };
}

export function recoverOverdueGmailLimitedBatches() {
  const batches = db.prepare(`
    SELECT DISTINCT b.id
    FROM scheduled_batches b
    JOIN scheduled_drafts d ON d.batch_id=b.id
    WHERE b.auto_approve=1
      AND b.status='drafted'
      AND b.scheduled_at <= datetime('now')
      AND d.status='approved'
      AND (
        lower(COALESCE(d.error,'')) LIKE '%rate limit%'
        OR lower(COALESCE(d.error,'')) LIKE '%sending limit%'
        OR lower(COALESCE(d.error,'')) LIKE '%limit exceeded%'
      )
    ORDER BY b.id
  `).all();
  if (!batches.length) return { updated: 0, batchIds: [] };

  const ids = batches.map(batch => batch.id);
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`
    UPDATE scheduled_batches
    SET status='scheduled', send_attempts=0, ready_notice_sent_at=NULL
    WHERE id IN (${placeholders})
  `).run(...ids);
  for (const batchId of ids) {
    db.prepare(`
      INSERT INTO scheduled_batch_history
        (batch_id, action, from_status, to_status, scheduled_at, gmail_reset_at, detail)
      SELECT id, 'gmail_reset_elapsed', 'drafted', 'scheduled', scheduled_at, gmail_reset_at,
        'Gmail reset time completed; automatic retry restored'
      FROM scheduled_batches WHERE id=?
    `).run(batchId);
    eventBus.publish({
      type: 'scheduled_batch_retry_scheduled',
      mode: 'scheduled',
      batchId,
      retryAt: db.prepare('SELECT scheduled_at FROM scheduled_batches WHERE id=?').get(batchId)?.scheduled_at,
      label: `Batch #${batchId} Gmail reset time completed; retrying automatically`,
    });
  }
  return { updated: ids.length, batchIds: ids };
}
