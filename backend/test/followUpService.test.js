import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../src/db/index.js';
import {
  listFollowUpCandidates,
  saveFollowUpDraft,
  markFollowUpSent,
  markFollowUpSkipped,
} from '../src/services/followUpService.js';

function seedSent(email, daysAgo) {
  db.prepare(`
    INSERT INTO sent_email_history (professor_email, last_name, subject, message_id, source, sent_at, mode)
    VALUES (?, 'Lee', 'MS/PhD Position Inquiry', ?, 'gmail_send', datetime('now', ?), 'instant')
  `).run(email, `msg-${email}`, `-${daysAgo} days`);
}

function cleanup(email) {
  db.prepare('DELETE FROM sent_email_history WHERE professor_email=?').run(email);
  db.prepare('DELETE FROM replies WHERE professor_email=?').run(email);
  db.prepare('DELETE FROM follow_ups WHERE professor_email=?').run(email);
}

test('listFollowUpCandidates surfaces non-responders past the window and hides recent sends', () => {
  const stale = `followup-stale-${Date.now()}@uni.test`;
  const recent = `followup-recent-${Date.now()}@uni.test`;
  try {
    seedSent(stale, 30);
    seedSent(recent, 1);
    const candidates = listFollowUpCandidates({ days: 7 });
    const emails = candidates.map(c => c.professor_email);
    assert.ok(emails.includes(stale), 'stale non-responder should be a candidate');
    assert.ok(!emails.includes(recent), 'recently emailed professor should not be a candidate');
  } finally {
    cleanup(stale);
    cleanup(recent);
  }
});

test('listFollowUpCandidates excludes professors who already replied', () => {
  const email = `followup-replied-${Date.now()}@uni.test`;
  try {
    seedSent(email, 30);
    db.prepare("INSERT INTO replies (professor_email, classification, received_at, workflow_status) VALUES (?, 'positive', datetime('now'), 'new')").run(email);
    const emails = listFollowUpCandidates({ days: 7 }).map(c => c.professor_email);
    assert.ok(!emails.includes(email));
  } finally {
    cleanup(email);
  }
});

test('draft, sent, and skip transitions update follow-up state', () => {
  const draftEmail = `followup-draft-${Date.now()}@uni.test`;
  const skipEmail = `followup-skip-${Date.now()}@uni.test`;
  try {
    seedSent(draftEmail, 30);
    seedSent(skipEmail, 30);

    const candidate = listFollowUpCandidates({ days: 7 }).find(c => c.professor_email === draftEmail);
    saveFollowUpDraft(candidate, { body: '<p>Just following up.</p>', subject: 'Re: MS/PhD Position Inquiry' });
    const drafted = listFollowUpCandidates({ days: 7 }).find(c => c.professor_email === draftEmail);
    assert.equal(drafted.workflow_status, 'drafted');
    assert.match(drafted.suggested_body, /following up/);

    markFollowUpSent(draftEmail, { body: '<p>Just following up.</p>', subject: 'Re: MS/PhD Position Inquiry', sentMessageId: 'm1' });
    assert.ok(!listFollowUpCandidates({ days: 7 }).some(c => c.professor_email === draftEmail), 'sent follow-up should drop off the candidate list');

    markFollowUpSkipped(skipEmail, listFollowUpCandidates({ days: 7 }).find(c => c.professor_email === skipEmail));
    assert.ok(!listFollowUpCandidates({ days: 7 }).some(c => c.professor_email === skipEmail), 'skipped follow-up should drop off the candidate list');
  } finally {
    cleanup(draftEmail);
    cleanup(skipEmail);
  }
});
