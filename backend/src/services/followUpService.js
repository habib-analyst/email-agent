import db from '../db/index.js';
import { lastNameFromEmail } from '../utils/professor.js';

export const DEFAULT_FOLLOWUP_DAYS = 7;

export function getFollowUpDays() {
  const row = db.prepare('SELECT followup_days FROM settings WHERE id=1').get();
  const value = Number(row?.followup_days);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_FOLLOWUP_DAYS;
}

export function listFollowUpCandidates({ days } = {}) {
  const window = Number.isFinite(Number(days)) && Number(days) > 0 ? Number(days) : getFollowUpDays();
  const rows = db.prepare(`
    SELECT
      h.professor_email AS professor_email,
      h.last_name AS last_name,
      h.university AS university,
      h.subject AS original_subject,
      h.message_id AS original_message_id,
      h.mode AS mode,
      MAX(h.sent_at) AS sent_at,
      CAST(julianday('now') - julianday(MAX(h.sent_at)) AS INTEGER) AS days_since,
      f.workflow_status AS workflow_status,
      f.suggested_body AS suggested_body,
      f.subject AS follow_up_subject,
      f.id AS follow_up_id
    FROM sent_email_history h
    LEFT JOIN follow_ups f
      ON lower(f.professor_email) = lower(h.professor_email) AND f.stage = 1
    WHERE h.source = 'gmail_send'
      AND h.message_id IS NOT NULL AND h.message_id != ''
      AND NOT EXISTS (
        SELECT 1 FROM replies r WHERE lower(r.professor_email) = lower(h.professor_email)
      )
      AND NOT EXISTS (
        SELECT 1 FROM delivery_failures d WHERE lower(d.professor_email) = lower(h.professor_email)
      )
    GROUP BY lower(h.professor_email)
    HAVING MAX(h.sent_at) <= datetime('now', ?)
       AND (f.workflow_status IS NULL OR f.workflow_status NOT IN ('sent', 'skipped'))
    ORDER BY sent_at ASC
  `).all(`-${window} days`);

  return rows.map(row => ({
    ...row,
    last_name: row.last_name || lastNameFromEmail(row.professor_email) || '',
    workflow_status: row.workflow_status || 'candidate',
  }));
}

function upsertFollowUp(candidate, fields) {
  const existing = db.prepare('SELECT id FROM follow_ups WHERE lower(professor_email)=lower(?) AND stage=1').get(candidate.professor_email);
  if (existing) {
    const sets = Object.keys(fields).map(key => `${key}=@${key}`).join(', ');
    db.prepare(`UPDATE follow_ups SET ${sets}, updated_at=datetime('now') WHERE id=@id`).run({ ...fields, id: existing.id });
    return existing.id;
  }
  const info = db.prepare(`
    INSERT INTO follow_ups
      (professor_email, stage, thread_id, original_message_id, original_subject, last_name, university, mode,
       suggested_body, subject, workflow_status)
    VALUES (@professor_email, 1, @thread_id, @original_message_id, @original_subject, @last_name, @university, @mode,
       @suggested_body, @subject, @workflow_status)
  `).run({
    professor_email: candidate.professor_email,
    thread_id: candidate.thread_id || null,
    original_message_id: candidate.original_message_id || null,
    original_subject: candidate.original_subject || null,
    last_name: candidate.last_name || null,
    university: candidate.university || null,
    mode: candidate.mode || 'instant',
    suggested_body: fields.suggested_body || null,
    subject: fields.subject || null,
    workflow_status: fields.workflow_status || 'drafted',
  });
  return info.lastInsertRowid;
}

export function saveFollowUpDraft(candidate, { body, subject, threadId }) {
  return upsertFollowUp({ ...candidate, thread_id: threadId || candidate.thread_id }, {
    suggested_body: body,
    subject,
    thread_id: threadId || candidate.thread_id || null,
    workflow_status: 'drafted',
  });
}

export function markFollowUpSent(professorEmail, { body, subject, sentMessageId }) {
  db.prepare(`
    UPDATE follow_ups
    SET workflow_status='sent', suggested_body=COALESCE(?, suggested_body), subject=COALESCE(?, subject),
        sent_message_id=?, sent_at=datetime('now'), updated_at=datetime('now')
    WHERE lower(professor_email)=lower(?) AND stage=1
  `).run(body || null, subject || null, sentMessageId || null, professorEmail);
  db.prepare('UPDATE sent_log SET follow_up_sent=1 WHERE lower(professor_email)=lower(?)').run(professorEmail);
}

export function markFollowUpSkipped(professorEmail, candidate = {}) {
  upsertFollowUp({ ...candidate, professor_email: professorEmail }, { workflow_status: 'skipped' });
}
