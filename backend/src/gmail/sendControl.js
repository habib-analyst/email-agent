import db from '../db/index.js';
import { delay } from '../pipeline/utils.js';
import { rescheduleBatchesAfterGmailReset } from '../services/scheduledGmailRecovery.js';

const STALE_RESERVATION_GRACE_MINUTES = 5;
export const SEND_LIMIT_COOLDOWN_MINUTES = 15;

export class SendPausedError extends Error {
  constructor(message, pausedUntil) {
    super(message);
    this.code = 'SEND_PAUSED';
    this.pausedUntil = pausedUntil;
  }
}

export class DailyCapError extends Error {
  constructor(cap) {
    super(`Daily sending cap of ${cap} reached`);
    this.code = 'DAILY_CAP_REACHED';
  }
}

export class DuplicateSendError extends Error {
  constructor(email, prior) {
    super(`Email already sent to ${email}; duplicate send blocked`);
    this.code = 'DUPLICATE_SEND_BLOCKED';
    this.email = email;
    this.prior = prior || null;
  }
}

function randomDelayMs(minMinutes, maxMinutes) {
  const min = Math.max(0, Number(minMinutes) || 0);
  const max = Math.max(min, Number(maxMinutes) || min);
  return Math.round((min + Math.random() * (max - min)) * 60_000);
}

function parseTime(value) {
  const normalized = typeof value === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const ms = normalized ? new Date(normalized).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

export function toSqliteUtc(value) {
  const date = value ? new Date(value) : new Date();
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function clearStaleReservations() {
  db.prepare(`
    DELETE FROM outbound_send_reservations
    WHERE send_after < datetime('now', ?)
  `).run(`-${STALE_RESERVATION_GRACE_MINUTES} minutes`);
}

export function getSendPause() {
  const row = db.prepare('SELECT paused_until, pause_reason FROM outbound_send_state WHERE id=1').get();
  if (!row?.paused_until || parseTime(row.paused_until) <= Date.now()) return null;
  return row;
}

export function getOutboundSendBlock() {
  clearExpiredSendPause();
  clearStaleReservations();
  const paused = getSendPause();
  if (paused) {
    return { code: 'SEND_PAUSED', reason: paused.pause_reason, retryAt: paused.paused_until };
  }
  const cap = Math.max(0, Number(db.prepare('SELECT daily_cap FROM settings WHERE id=1').get()?.daily_cap) || 0);
  if (cap <= 0) return null;
  const sentToday = db.prepare(`
    SELECT COUNT(*) AS count
    FROM sent_email_history
    WHERE sent_at >= datetime('now', 'start of day')
      AND source IN ('gmail_send', 'gmail_reply')
  `).get().count;
  const reserved = db.prepare('SELECT COUNT(*) AS count FROM outbound_send_reservations').get().count;
  if (sentToday + reserved < cap) return null;
  const nextUtcDay = new Date();
  nextUtcDay.setUTCHours(24, 0, 0, 0);
  return {
    code: 'DAILY_CAP_REACHED',
    reason: `Daily sending cap of ${cap} reached`,
    retryAt: nextUtcDay.toISOString(),
  };
}

export function pauseOutboundSending(reason, retryAt) {
  const timestamp = retryAt ? new Date(retryAt).getTime() : 0;
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) return null;
  const pausedUntil = new Date(timestamp).toISOString();
  db.prepare(`
    UPDATE outbound_send_state
    SET paused_until=?, pause_reason=?, updated_at=datetime('now')
    WHERE id=1
  `).run(pausedUntil, reason || 'Gmail sending temporarily paused');
  return pausedUntil;
}

export function clearExpiredSendPause() {
  db.prepare(`
    UPDATE outbound_send_state
    SET paused_until=NULL, pause_reason=NULL, updated_at=datetime('now')
    WHERE id=1 AND paused_until IS NOT NULL AND paused_until <= ?
  `).run(new Date().toISOString());
}

export function recordSendIncident({ type = 'send_limit', reason, messageId, source = 'gmail_api', retryAt } = {}) {
  if (messageId) {
    const existing = db.prepare('SELECT id FROM outbound_send_incidents WHERE message_id=?').get(messageId);
    if (existing) return { id: existing.id, added: false, pausedUntil: getSendPause()?.paused_until || null };
  }
  const info = db.prepare(`
    INSERT INTO outbound_send_incidents (incident_type, reason, source, message_id)
    VALUES (?, ?, ?, ?)
  `).run(type, reason || type, source, messageId || null);
  const cooldownAt = type === 'send_limit'
    ? new Date(Date.now() + SEND_LIMIT_COOLDOWN_MINUTES * 60_000).toISOString()
    : retryAt;
  const pausedUntil = type === 'send_limit' ? pauseOutboundSending(reason, cooldownAt) : null;
  if (pausedUntil) rescheduleBatchesAfterGmailReset(pausedUntil, reason || type);
  return { id: info.lastInsertRowid, added: true, pausedUntil };
}

export async function reserveOutboundSend({ mode = 'instant', recipientEmail, allowDuplicate = false } = {}) {
  const recipient = String(recipientEmail || '').trim().toLowerCase();
  const reservation = db.transaction(() => {
    clearExpiredSendPause();
    clearStaleReservations();

    if (recipient && !allowDuplicate) {
      const prior = db.prepare(`
        SELECT sent_at, subject, message_id, mode, batch_id
        FROM sent_email_history
        WHERE lower(professor_email)=?
        ORDER BY sent_at DESC, id DESC
        LIMIT 1
      `).get(recipient);
      if (prior) throw new DuplicateSendError(recipient, prior);
    }

    const paused = getSendPause();
    if (paused) {
      throw new SendPausedError(
        `${paused.pause_reason || 'Sending paused'} until ${paused.paused_until}`,
        paused.paused_until,
      );
    }

    const settings = db.prepare(
      'SELECT daily_cap, min_delay_min, max_delay_min FROM settings WHERE id=1'
    ).get() || {};
    const cap = Math.max(0, Number(settings.daily_cap) || 0);
    if (cap > 0) {
      const sentToday = db.prepare(`
        SELECT COUNT(*) AS count
        FROM sent_email_history
        WHERE sent_at >= datetime('now', 'start of day')
          AND source IN ('gmail_send', 'gmail_reply')
      `).get().count;
      const reserved = db.prepare('SELECT COUNT(*) AS count FROM outbound_send_reservations').get().count;
      if (sentToday + reserved >= cap) throw new DailyCapError(cap);
    }

    const latest = db.prepare(`
      SELECT MAX(send_after) AS send_after FROM outbound_send_reservations
    `).get()?.send_after;
    const state = db.prepare('SELECT last_send_at FROM outbound_send_state WHERE id=1').get();
    const priorSendTime = Math.max(parseTime(latest), parseTime(state?.last_send_at));
    const base = Math.max(Date.now(), priorSendTime);
    const spacingMs = priorSendTime
      ? Math.max(1000, randomDelayMs(settings.min_delay_min, settings.max_delay_min))
      : 0;
    const sendAfter = toSqliteUtc(new Date(base + spacingMs));
    let info;
    try {
      info = db.prepare(`
        INSERT INTO outbound_send_reservations (mode, recipient_email, send_after)
        VALUES (?, ?, ?)
      `).run(mode, recipient || null, sendAfter);
    } catch (error) {
      if (recipient && String(error?.message || '').includes('outbound_send_reservations.recipient_email')) {
        throw new DuplicateSendError(recipient);
      }
      throw error;
    }
    return { id: info.lastInsertRowid, sendAfter };
  })();

  const waitMs = Math.max(0, parseTime(reservation.sendAfter) - Date.now());
  if (waitMs > 0) await delay(waitMs);

  const paused = getSendPause();
  if (paused) {
    releaseOutboundSend(reservation.id);
    throw new SendPausedError(
      `${paused.pause_reason || 'Sending paused'} until ${paused.paused_until}`,
      paused.paused_until,
    );
  }
  if (recipient && !allowDuplicate) {
    const prior = db.prepare(`
      SELECT sent_at, subject, message_id, mode, batch_id
      FROM sent_email_history
      WHERE lower(professor_email)=?
      ORDER BY sent_at DESC, id DESC
      LIMIT 1
    `).get(recipient);
    if (prior) {
      releaseOutboundSend(reservation.id);
      throw new DuplicateSendError(recipient, prior);
    }
  }
  return reservation;
}

export function completeOutboundSend(reservationId) {
  db.transaction(() => {
    db.prepare('DELETE FROM outbound_send_reservations WHERE id=?').run(reservationId);
    db.prepare(`
      UPDATE outbound_send_state
      SET last_send_at=?, updated_at=datetime('now')
      WHERE id=1
    `).run(new Date().toISOString());
  })();
}

export function releaseOutboundSend(reservationId) {
  if (reservationId != null) {
    db.prepare('DELETE FROM outbound_send_reservations WHERE id=?').run(reservationId);
  }
}

export function isOutboundSendBlockedError(error) {
  return error?.code === 'SEND_PAUSED' || error?.code === 'DAILY_CAP_REACHED';
}
