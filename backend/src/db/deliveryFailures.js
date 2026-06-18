import db from './index.js';
import { invalidateUniversityOutreachCache } from '../learning/universityOutreach.js';

export function normalizeFailureEmail(email) {
  return (email || '').toLowerCase().trim();
}

export function recordDeliveryFailure({
  professor_email,
  failure_type = 'delivery_failed',
  reason,
  source = 'gmail',
  mode = 'scheduled',
  message_id,
  thread_id,
  batch_id,
  draft_id,
  queue_id,
  raw_excerpt,
  received_at,
} = {}) {
  const email = normalizeFailureEmail(professor_email);
  if (!email) return null;

  const existing = message_id
    ? db.prepare('SELECT id FROM delivery_failures WHERE message_id=? AND professor_email=?').get(message_id, email)
    : null;
  if (existing) return existing.id;

  const info = db.prepare(`
    INSERT INTO delivery_failures
      (professor_email, failure_type, reason, source, mode, message_id, thread_id, batch_id, draft_id, queue_id, raw_excerpt, received_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
  `).run(
    email,
    failure_type,
    reason || failure_type,
    source,
    mode,
    message_id || null,
    thread_id || null,
    batch_id ?? null,
    draft_id ?? null,
    queue_id ?? null,
    raw_excerpt || null,
    received_at || null,
  );

  if (draft_id != null) {
    db.prepare("UPDATE scheduled_drafts SET status='failed', error=? WHERE id=?").run(reason || failure_type, draft_id);
  }
  db.prepare(`
    UPDATE scheduled_drafts
    SET status='failed', error=?
    WHERE professor_id IN (SELECT id FROM scheduled_professors WHERE lower(email)=?)
      AND status IN ('sent','resent','approved','draft','failed','sending')
  `).run(reason || failure_type, email);
  db.prepare(`
    UPDATE queue
    SET state='failed', error=?
    WHERE professor_id IN (SELECT id FROM professors WHERE lower(email)=?)
      AND state IN ('sent','pending','awaiting_proceed','sending','verified','drafted','failed')
  `).run(reason || failure_type, email);

  invalidateUniversityOutreachCache();
  return info.lastInsertRowid;
}

export function getDeliveryFailureStats(mode) {
  const modeClause = mode ? 'WHERE mode=?' : '';
  const params = mode ? [mode] : [];
  const total = db.prepare(`SELECT COUNT(*) as c FROM delivery_failures ${modeClause}`).get(...params).c;
  const recipientLimitRows = db.prepare(`SELECT COUNT(*) as c FROM delivery_failures ${modeClause ? `${modeClause} AND` : 'WHERE'} failure_type='send_limit'`).get(...params).c;
  const accountLimitIncidents = db.prepare("SELECT COUNT(*) as c FROM outbound_send_incidents WHERE incident_type='send_limit'").get().c;
  const limitReached = recipientLimitRows + accountLimitIncidents;
  const notFound = db.prepare(`SELECT COUNT(*) as c FROM delivery_failures ${modeClause ? `${modeClause} AND` : 'WHERE'} failure_type='not_found'`).get(...params).c;
  const recent = db.prepare(`SELECT COUNT(*) as c FROM delivery_failures ${modeClause ? `${modeClause} AND` : 'WHERE'} received_at >= datetime('now', '-24 hours')`).get(...params).c;
  return { deliveryFailed: total, sendLimitFailures: limitReached, notFoundFailures: notFound, recentDeliveryFailures: recent };
}
