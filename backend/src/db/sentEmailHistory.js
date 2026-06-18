import db from './index.js';
import archiveDb from './archive.js';
import { invalidateUniversityOutreachCache } from '../learning/universityOutreach.js';

export function normalizeSentEmail(email) {
  return (email || '').toLowerCase().trim();
}

export function recordSentEmail({
  professor_email,
  last_name,
  university,
  subject,
  message_id,
  sent_at,
  mode = 'instant',
  source = 'gmail_send',
  professor_id,
  queue_id,
  batch_id,
  draft_id,
} = {}) {
  const email = normalizeSentEmail(professor_email);
  if (!email) return null;

  const sentAt = sent_at || new Date().toISOString();
  const existingByMessage = message_id
    ? db.prepare('SELECT id FROM sent_email_history WHERE message_id=?').get(message_id)
    : null;
  if (existingByMessage) return existingByMessage.id;

  if (!message_id) {
    const existing = db.prepare(`
      SELECT id FROM sent_email_history
      WHERE professor_email=?
        AND sent_at=?
        AND mode=?
        AND source=?
        AND COALESCE(subject, '')=COALESCE(?, '')
      LIMIT 1
    `).get(email, sentAt, mode || 'instant', source || 'gmail_send', subject || null);
    if (existing) return existing.id;
  }

  const info = db.prepare(`
    INSERT INTO sent_email_history
      (professor_email, last_name, university, subject, message_id, sent_at, mode, source, professor_id, queue_id, batch_id, draft_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    email,
    last_name || null,
    university || null,
    subject || null,
    message_id || null,
    sentAt,
    mode || 'instant',
    source || 'gmail_send',
    professor_id ?? null,
    queue_id ?? null,
    batch_id ?? null,
    draft_id ?? null,
  );
  invalidateUniversityOutreachCache();

  return info.lastInsertRowid;
}

export function findLastSentEmail(email, { since } = {}) {
  const norm = normalizeSentEmail(email);
  if (!norm) return null;

  if (since) {
    return db.prepare(`
      SELECT * FROM sent_email_history
      WHERE professor_email=? AND sent_at >= ?
      ORDER BY sent_at DESC, id DESC LIMIT 1
    `).get(norm, since);
  }

  return db.prepare(`
    SELECT * FROM sent_email_history
    WHERE professor_email=?
    ORDER BY sent_at DESC, id DESC LIMIT 1
  `).get(norm);
}

function backfillSentEmailHistory() {
  const fromSentLog = db.prepare(`
    SELECT sl.professor_email, p.last_name, p.university, sl.subject, sl.message_id, sl.sent_at, sl.mode,
           'sent_log' as source, NULL as batch_id, NULL as draft_id
    FROM sent_log sl
    LEFT JOIN professors p ON p.email = sl.professor_email
    WHERE sl.professor_email IS NOT NULL AND TRIM(sl.professor_email) != ''
  `).all();

  const fromScheduled = db.prepare(`
    SELECT ssl.professor_email, sp.last_name, sp.university, ssl.subject, ssl.message_id, ssl.sent_at, 'scheduled' as mode,
           'scheduled_sent_log' as source, ssl.batch_id, ssl.draft_id
    FROM scheduled_sent_log ssl
    LEFT JOIN scheduled_professors sp ON sp.email = ssl.professor_email
    WHERE ssl.professor_email IS NOT NULL AND TRIM(ssl.professor_email) != ''
  `).all();

  const fromArchive = archiveDb.prepare(`
    SELECT professor_email, last_name, university, subject, message_id, created_at as sent_at, mode,
           'archive_outreach' as source, batch_id, draft_id
    FROM archive_outreach
    WHERE professor_email IS NOT NULL
      AND TRIM(professor_email) != ''
      AND status IN ('sent', 'resent')
  `).all();

  const before = db.prepare('SELECT COUNT(*) as c FROM sent_email_history').get().c;
  const backfill = db.transaction((rows) => {
    for (const row of rows) recordSentEmail(row);
  });
  backfill([...fromSentLog, ...fromScheduled, ...fromArchive]);

  db.prepare(`
    UPDATE sent_email_history
    SET university = COALESCE(
      NULLIF(university, ''),
      (SELECT university FROM professors p WHERE p.email = sent_email_history.professor_email AND p.university IS NOT NULL AND p.university != '' LIMIT 1),
      (SELECT university FROM scheduled_professors sp WHERE sp.email = sent_email_history.professor_email AND sp.university IS NOT NULL AND sp.university != '' LIMIT 1)
    )
    WHERE university IS NULL OR university = ''
  `).run();

  const after = db.prepare('SELECT COUNT(*) as c FROM sent_email_history').get().c;
  if (after > before) {
    console.log(`[SentHistory] Backfilled ${after - before} sent email record(s)`);
  }
}

backfillSentEmailHistory();
