import db from './index.js';
import { ArchiveService } from '../services/ArchiveService.js';
import { evaluateDuplicate } from './duplicatePolicy.js';
import { findLastSentEmail, normalizeSentEmail } from './sentEmailHistory.js';

export function normalizeEmail(email) {
  return normalizeSentEmail(email);
}

function getDuplicateSettings() {
  return db.prepare('SELECT duplicate_policy, duplicate_cooldown_days FROM settings WHERE id=1').get() || {};
}

/** Best-level duplicate lookup — permanent archive first, then live session DBs. */
export function findPriorOutreach(email, { since } = {}) {
  const norm = normalizeEmail(email);
  if (!norm) return null;

  const history = findLastSentEmail(norm, { since });
  if (history) {
    return {
      email: norm,
      source: history.source || 'sent_email_history',
      status: 'sent',
      subject: history.subject,
      sent_at: history.sent_at,
      mode: history.mode,
      message_id: history.message_id,
      batch_id: history.batch_id,
      draft_id: history.draft_id,
    };
  }

  const archived = ArchiveService.findLastSent(norm, { since });
  if (archived) {
    return {
      email: norm,
      source: 'archive',
      status: archived.status,
      subject: archived.subject,
      sent_at: archived.created_at,
      mode: archived.mode,
      last_name: archived.last_name,
      batch_id: archived.batch_id,
      agent_summary: archived.agent_summary,
    };
  }

  const instant = db.prepare(`
    SELECT professor_email, subject, sent_at, mode, message_id
    FROM sent_log WHERE professor_email=? ${since ? "AND sent_at >= ?" : ''} ORDER BY sent_at DESC LIMIT 1
  `).get(...(since ? [norm, since] : [norm]));
  if (instant) {
    return {
      email: norm,
      source: 'sent_log',
      status: 'sent',
      subject: instant.subject,
      sent_at: instant.sent_at,
      mode: instant.mode,
      message_id: instant.message_id,
    };
  }

  const sched = db.prepare(`
    SELECT professor_email, subject, sent_at, batch_id, message_id
    FROM scheduled_sent_log WHERE professor_email=? ORDER BY sent_at DESC LIMIT 1
  `).get(norm);
  if (sched) {
    return {
      email: norm,
      source: 'scheduled_sent_log',
      status: 'sent',
      subject: sched.subject,
      sent_at: sched.sent_at,
      mode: 'scheduled',
      batch_id: sched.batch_id,
      message_id: sched.message_id,
    };
  }

  return null;
}

export function wasEmailSentBefore(email) {
  return !!findPriorOutreach(email);
}

/** Split emails into allowed vs previously contacted. */
export function filterDuplicateEmails(emails, { allowAll = false, settings } = {}) {
  const list = (Array.isArray(emails) ? emails : [])
    .map(normalizeEmail)
    .filter(Boolean);

  if (allowAll) return { allowed: [...new Set(list)], skipped: [] };

  const dupSettings = settings || getDuplicateSettings();
  const allowed = [];
  const skipped = [];
  const seen = new Set();

  for (const email of list) {
    if (seen.has(email)) continue;
    seen.add(email);
    const dup = evaluateDuplicate(email, dupSettings);
    if (dup.blocked && dup.action === 'skip') {
      skipped.push({ email, prior: dup.prior });
      continue;
    }
    if (dup.blocked && dup.action === 'review') {
      skipped.push({ email, prior: dup.prior, review: true });
      continue;
    }
    allowed.push(email);
  }

  return { allowed, skipped };
}

export function recordDuplicateBlocked(email, prior, context = {}) {
  ArchiveService.recordOutreach({
    professor_email: email,
    last_name: prior?.last_name,
    mode: context.mode || prior?.mode || 'instant',
    status: 'duplicate_blocked',
    subject: prior?.subject,
    agent_summary: prior
      ? `Duplicate blocked — previously ${prior.status || 'sent'} via ${prior.source} at ${prior.sent_at || 'unknown'}`
      : 'Duplicate blocked',
    batch_id: context.batch_id,
    queue_id: context.queue_id,
  });
  ArchiveService.logAgentEvent({
    professor_email: email,
    mode: context.mode,
    batch_id: context.batch_id,
    queue_id: context.queue_id,
    event_type: 'duplicate_check',
    label: 'Duplicate detected',
    detail: prior,
  });
}
