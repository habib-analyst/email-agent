import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import db from '../src/db/index.js';
import {
  DuplicateSendError,
  SEND_LIMIT_COOLDOWN_MINUTES,
  getOutboundSendBlock,
  pauseOutboundSending,
  recordSendIncident,
  reserveOutboundSend,
} from '../src/gmail/sendControl.js';
import { getSendLimitRetryAt } from '../src/gmail/index.js';
import { getRecordedScheduledDraftIds } from '../src/pipeline/scheduler.js';
import { hasProcessedDeliveryFailure } from '../src/gmail/replies.js';
import { evaluateDuplicate } from '../src/db/duplicatePolicy.js';
import { ArchiveService } from '../src/services/ArchiveService.js';
import {
  getUniversityOutreach,
  invalidateUniversityOutreachCache,
} from '../src/learning/universityOutreach.js';
import { getGlobalUniversityCatalog } from '../src/learning/globalUniversityCatalog.js';
import { resolveUsaUniversityFromEmail } from '../src/learning/usaUniversityResolver.js';
import { recordSentEmail } from '../src/db/sentEmailHistory.js';
import { resolveKnownUniversityLocation } from '../src/learning/universityLocationResolver.js';
import {
  gmailRetryTimeWithBuffer,
  recoverOverdueGmailLimitedBatches,
  rescheduleBatchesAfterGmailReset,
} from '../src/services/scheduledGmailRecovery.js';

const rollback = new Error('rollback');

test('account-wide pause blocks every outbound send path', () => {
  const verify = db.transaction(() => {
    const retryAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const pausedUntil = pauseOutboundSending('quota test', retryAt);
    const blocked = getOutboundSendBlock();
    assert.equal(blocked.code, 'SEND_PAUSED');
    assert.equal(blocked.retryAt, pausedUntil);
    throw rollback;
  });
  assert.throws(verify, error => error === rollback);
});

test('send-limit incidents create the configured cooldown when Gmail omits retry time', () => {
  const verify = db.transaction(() => {
    db.prepare('UPDATE outbound_send_state SET paused_until=NULL, pause_reason=NULL WHERE id=1').run();
    const before = Date.now();
    const incident = recordSendIncident({ type: 'send_limit', reason: 'Gmail send limit reached' });
    const pausedMs = new Date(incident.pausedUntil).getTime();
    assert.equal(getOutboundSendBlock()?.code, 'SEND_PAUSED');
    assert.ok(pausedMs >= before + 14 * 60_000);
    assert.ok(pausedMs <= before + 16 * 60_000);
    throw rollback;
  });
  assert.throws(verify, error => error === rollback);
});

test('Gmail retry time is used only when explicitly provided', () => {
  const retryAt = getSendLimitRetryAt({
    message: 'User-rate limit exceeded. Retry after 2099-01-01T10:00:00.000Z (Mail sending)',
  });
  assert.equal(retryAt, '2099-01-01T10:00:00.000Z');
  assert.equal(getSendLimitRetryAt({ message: 'Gmail send limit reached' }), null);
});

test('Gmail send-limit incidents enforce a repeatable 15-minute account cooldown', () => {
  assert.equal(SEND_LIMIT_COOLDOWN_MINUTES, 15);
  const sendControl = readFileSync(new URL('../src/gmail/sendControl.js', import.meta.url), 'utf8');
  const pipeline = readFileSync(new URL('../src/pipeline/index.js', import.meta.url), 'utf8');
  assert.match(sendControl, /Date\.now\(\) \+ SEND_LIMIT_COOLDOWN_MINUTES \* 60_000/);
  assert.match(pipeline, /sendBlock\?\.code === 'SEND_PAUSED'/);
  assert.match(pipeline, /await delay\(5000\);\s*continue;/);
});

test('scheduled Gmail recovery uses reset time plus two minutes', () => {
  const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  assert.equal(
    new Date(gmailRetryTimeWithBuffer(resetAt)).getTime(),
    new Date(resetAt).getTime() + 2 * 60 * 1000,
  );
  assert.equal(gmailRetryTimeWithBuffer(null), null);
});

test('Gmail reset moves only earlier auto batches to reset plus two minutes', () => {
  const verify = db.transaction(() => {
    const base = 920000000 + Math.floor(Math.random() * 100000);
    const resetAt = new Date(Date.now() + 60 * 60 * 1000);
    resetAt.setMilliseconds(0);
    const safeAt = new Date(resetAt.getTime() + 2 * 60 * 1000);
    const laterAt = new Date(safeAt.getTime() + 60 * 60 * 1000);
    db.prepare(`
      INSERT INTO scheduled_batches (id, scheduled_at, status, auto_approve, send_attempts)
      VALUES (?, datetime('now', '-1 minute'), 'sending', 1, 4)
    `).run(base);
    db.prepare(`
      INSERT INTO scheduled_batches (id, scheduled_at, status, auto_approve)
      VALUES (?, ?, 'scheduled', 1)
    `).run(base + 1, laterAt.toISOString());
    db.prepare(`
      INSERT INTO scheduled_batches (id, scheduled_at, status, auto_approve)
      VALUES (?, datetime('now', '-1 minute'), 'drafted', 0)
    `).run(base + 2);

    const result = rescheduleBatchesAfterGmailReset(resetAt.toISOString(), 'quota test');
    assert.equal(result.batchIds.includes(base), true);
    assert.equal(result.batchIds.includes(base + 1), false);
    assert.equal(result.batchIds.includes(base + 2), false);
    const moved = db.prepare('SELECT status, scheduled_at, send_attempts FROM scheduled_batches WHERE id=?').get(base);
    assert.equal(moved.status, 'scheduled');
    assert.equal(moved.send_attempts, 0);
    assert.equal(new Date(`${moved.scheduled_at.replace(' ', 'T')}Z`).getTime(), safeAt.getTime());
    assert.equal(db.prepare('SELECT scheduled_at FROM scheduled_batches WHERE id=?').get(base + 1).scheduled_at, laterAt.toISOString());
    assert.equal(db.prepare('SELECT status FROM scheduled_batches WHERE id=?').get(base + 2).status, 'drafted');
    throw rollback;
  });
  assert.throws(verify, error => error === rollback);
});

test('identical Gmail reset events reschedule and record each batch only once', () => {
  const verify = db.transaction(() => {
    const batchId = 925000000 + Math.floor(Math.random() * 100000);
    const resetAt = new Date(Date.now() + 60 * 60 * 1000);
    resetAt.setMilliseconds(0);
    db.prepare(`
      INSERT INTO scheduled_batches (id, scheduled_at, status, auto_approve)
      VALUES (?, datetime('now', '-1 minute'), 'sending', 1)
    `).run(batchId);
    const first = rescheduleBatchesAfterGmailReset(resetAt.toISOString(), 'same quota event');
    const second = rescheduleBatchesAfterGmailReset(resetAt.toISOString(), 'same quota event');
    assert.equal(first.batchIds.includes(batchId), true);
    assert.equal(second.batchIds.includes(batchId), false);
    assert.equal(
      db.prepare(`
        SELECT COUNT(*) AS count FROM scheduled_batch_history
        WHERE batch_id=? AND action='gmail_limit_rescheduled'
      `).get(batchId).count,
      1,
    );
    throw rollback;
  });
  assert.throws(verify, error => error === rollback);
});

test('overdue drafted Gmail-limit batches are restored for automatic retry', () => {
  const verify = db.transaction(() => {
    const batchId = 930000000 + Math.floor(Math.random() * 100000);
    const professorId = batchId + 1;
    db.prepare(`
      INSERT INTO scheduled_batches (id, scheduled_at, status, auto_approve, send_attempts)
      VALUES (?, datetime('now', '-5 minutes'), 'drafted', 1, 5)
    `).run(batchId);
    db.prepare(`
      INSERT INTO scheduled_professors (id, email, batch_id)
      VALUES (?, ?, ?)
    `).run(professorId, `recovery-${batchId}@example.edu`, batchId);
    db.prepare(`
      INSERT INTO scheduled_drafts (batch_id, professor_id, status, error)
      VALUES (?, ?, 'approved', 'User-rate limit exceeded')
    `).run(batchId, professorId);
    const recovered = recoverOverdueGmailLimitedBatches();
    assert.equal(recovered.batchIds.includes(batchId), true);
    const batch = db.prepare('SELECT status, send_attempts FROM scheduled_batches WHERE id=?').get(batchId);
    assert.equal(batch.status, 'scheduled');
    assert.equal(batch.send_attempts, 0);
    throw rollback;
  });
  assert.throws(verify, error => error === rollback);
});

test('send-limit bounces are stored as account incidents, not recipient failures', () => {
  const verify = db.transaction(() => {
    const messageId = `account-limit-${Date.now()}-${Math.random()}`;
    recordSendIncident({
      type: 'send_limit',
      reason: 'quota test',
      source: 'gmail_bounce',
      messageId,
    });
    assert.equal(hasProcessedDeliveryFailure(messageId), true);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM delivery_failures WHERE message_id=?').get(messageId).count,
      0,
    );
    throw rollback;
  });
  assert.throws(verify, error => error === rollback);
});

test('daily cap counts authoritative history across send modes in UTC', () => {
  const verify = db.transaction(() => {
    db.prepare('DELETE FROM outbound_send_reservations').run();
    db.prepare('UPDATE outbound_send_state SET paused_until=NULL, pause_reason=NULL WHERE id=1').run();
    const original = db.prepare('SELECT daily_cap FROM settings WHERE id=1').get();
    const sentToday = db.prepare(`
      SELECT COUNT(*) AS count FROM sent_email_history
      WHERE sent_at >= datetime('now', 'start of day')
        AND source IN ('gmail_send', 'gmail_reply')
    `).get().count;
    db.prepare('UPDATE settings SET daily_cap=? WHERE id=1').run(sentToday + 1);
    db.prepare(`
      INSERT INTO sent_email_history (professor_email, source, mode, sent_at)
      VALUES ('cap-test@example.com', 'gmail_send', 'scheduled', datetime('now'))
    `).run();
    const blocked = getOutboundSendBlock();
    assert.equal(blocked.code, 'DAILY_CAP_REACHED');
    db.prepare('UPDATE settings SET daily_cap=? WHERE id=1').run(original.daily_cap);
    throw rollback;
  });
  assert.throws(verify, error => error === rollback);
});

test('scheduled crash recovery trusts immediate Gmail send history', () => {
  const verify = db.transaction(() => {
    const batchId = 900000000 + Math.floor(Math.random() * 1000000);
    const draftId = batchId + 1;
    db.prepare(`
      INSERT INTO sent_email_history
        (professor_email, source, mode, batch_id, draft_id, sent_at)
      VALUES ('recovery-test@example.com', 'gmail_send', 'scheduled', ?, ?, datetime('now'))
    `).run(batchId, draftId);
    assert.deepEqual(getRecordedScheduledDraftIds(batchId), [draftId]);
    throw rollback;
  });
  assert.throws(verify, error => error === rollback);
});

test('Gmail send calls are not wrapped in generic automatic retries', () => {
  const instant = readFileSync(new URL('../src/pipeline/index.js', import.meta.url), 'utf8');
  const scheduled = readFileSync(new URL('../src/pipeline/scheduler.js', import.meta.url), 'utf8');
  assert.doesNotMatch(instant, /withRetry\(\(\)\s*=>\s*sendEmail/);
  assert.doesNotMatch(scheduled, /withRetry\(\(\)\s*=>\s*sendEmail/);
  assert.doesNotMatch(instant, /function getNext\(\) \{\s*if \(getOutboundSendBlock\(\)\) return null;/);
  assert.match(instant, /retry_after=\?, fast_track=1/);
  assert.match(instant, /isOutboundSendBlockedError\(e\) \|\| isSendLimitError\(e\)\) throw e/);
  assert.match(instant, /if \(blocked\?\.retryAt\)/);
  assert.match(instant, /queue_id=\? AND lower\(professor_email\)=lower\(\?\)/);
  assert.doesNotMatch(instant, /updateState\(item\.id, 'sent', \{[\s\S]{0,160}messageId:/);
});

test('outbound reservation blocks recipients already sent in any previous flow', async () => {
  const email = `duplicate-block-${Date.now()}-${Math.random()}@example.com`;
  db.prepare(`
    INSERT INTO sent_email_history (professor_email, source, mode, sent_at)
    VALUES (?, 'gmail_send', 'instant', datetime('now'))
  `).run(email);
  try {
    await assert.rejects(
      reserveOutboundSend({ mode: 'scheduled', recipientEmail: email }),
      error => error instanceof DuplicateSendError && error.code === 'DUPLICATE_SEND_BLOCKED',
    );
  } finally {
    db.prepare('DELETE FROM sent_email_history WHERE professor_email=?').run(email);
  }
});

test('duplicate policy always skips previously sent recipients', () => {
  const email = `duplicate-policy-${Date.now()}-${Math.random()}@example.com`;
  db.prepare(`
    INSERT INTO sent_email_history (professor_email, source, mode, sent_at)
    VALUES (?, 'gmail_send', 'scheduled', datetime('now'))
  `).run(email);
  try {
    assert.equal(evaluateDuplicate(email, { duplicate_policy: 'allow_after_days', duplicate_cooldown_days: 0 }).action, 'skip');
  } finally {
    db.prepare('DELETE FROM sent_email_history WHERE professor_email=?').run(email);
  }
});

test('university outreach counts sent messages and unique contacts from sent history', () => {
  const verify = db.transaction(() => {
    const email = `university-history-${Date.now()}-${Math.random()}@tamu.edu`;
    invalidateUniversityOutreachCache();
    const before = getUniversityOutreach().regions.usa.universities
      .find(row => row.university === 'Texas A&M University') || { sent: 0, contactsSent: 0 };
    db.prepare(`
      INSERT INTO sent_email_history (professor_email, university, source, mode, sent_at)
      VALUES (?, 'Tamu', 'gmail_send', 'instant', datetime('now'))
    `).run(email);
    db.prepare(`
      INSERT INTO sent_email_history (professor_email, university, source, mode, sent_at)
      VALUES (?, 'Tamu', 'gmail_reply', 'reply', datetime('now'))
    `).run(email);
    invalidateUniversityOutreachCache();
    const after = getUniversityOutreach().regions.usa.universities
      .find(row => row.university === 'Texas A&M University');
    assert.equal(after.sent, before.sent + 2);
    assert.equal(after.contactsSent, before.contactsSent + 1);
    assert.equal(after.state, 'Texas');
    throw rollback;
  });
  assert.throws(verify, error => error === rollback);
  invalidateUniversityOutreachCache();
});

test('USA sent history resolves university from exact email domains and updates the catalog row', () => {
  assert.equal(resolveUsaUniversityFromEmail('professor@cs.cornell.edu'), 'Cornell University');
  assert.equal(resolveUsaUniversityFromEmail('professor@adventhealth.edu'), 'AdventHealth University');
  assert.equal(resolveUsaUniversityFromEmail('professor@ambiguous-unknown.edu'), null);

  const verify = db.transaction(() => {
    const email = `domain-history-${Date.now()}@adventhealth.edu`;
    invalidateUniversityOutreachCache();
    const before = getUniversityOutreach().regions.usa.universities
      .find(row => row.university === 'AdventHealth University') || { sent: 0 };
    recordSentEmail({
      professor_email: email,
      university: 'Wrong Imported Name',
      subject: 'Domain resolver test',
      message_id: `domain-resolver-${Date.now()}`,
      mode: 'instant',
    });
    const stored = db.prepare('SELECT university FROM sent_email_history WHERE professor_email=?').get(email);
    assert.equal(stored.university, 'AdventHealth University');
    invalidateUniversityOutreachCache();
    const after = getUniversityOutreach().regions.usa.universities
      .find(row => row.university === 'AdventHealth University');
    assert.equal(after.sent, before.sent + 1);
    assert.equal(after.status, 'complete');
    throw rollback;
  });
  assert.throws(verify, error => error === rollback);
  invalidateUniversityOutreachCache();
});

test('USA outreach repairs historical sent rows using the email domain', () => {
  const verify = db.transaction(() => {
    const email = `historical-domain-${Date.now()}@cs.cornell.edu`;
    db.prepare(`
      INSERT INTO sent_email_history (professor_email, university, subject, message_id, mode, source, sent_at)
      VALUES (?, 'Cornell', 'Historical resolver test', ?, 'instant', 'gmail_send', datetime('now'))
    `).run(email, `historical-resolver-${Date.now()}`);
    invalidateUniversityOutreachCache();
    const outreach = getUniversityOutreach();
    const stored = db.prepare('SELECT university FROM sent_email_history WHERE professor_email=?').get(email);
    assert.equal(stored.university, 'Cornell University');
    assert.ok(outreach.regions.usa.universities.some(row => row.university === 'Cornell University' && row.sent > 0));
    throw rollback;
  });
  assert.throws(verify, error => error === rollback);
  invalidateUniversityOutreachCache();
});

test('global outreach catalog covers every configured country with QS 2026 rankings', () => {
  const catalog = getGlobalUniversityCatalog();
  const expected = [
    'usa', 'canada', 'uk', 'germany', 'france', 'netherlands', 'switzerland',
    'sweden', 'italy', 'spain', 'austria', 'ireland', 'finland', 'china',
    'japan', 'south-korea', 'singapore', 'malaysia', 'hong-kong', 'taiwan',
    'australia', 'new-zealand',
  ];
  assert.equal(catalog.year, 2026);
  assert.match(catalog.ranking, /QS World University Rankings 2026/);
  for (const countryId of expected) {
    assert.ok(catalog.countries[countryId]?.length > 0, `${countryId} ranking catalog is empty`);
  }
});

test('USA outreach preserves the full state-grouped target catalog', () => {
  invalidateUniversityOutreachCache();
  const usa = getUniversityOutreach().regions.usa;
  assert.ok(usa.catalogTotal >= 2700);
  assert.equal(usa.suggested.length, 1000);
  assert.equal(usa.states.length, 51);
  assert.ok(usa.states.some(row => row.state === 'California'));
  assert.ok(usa.states.some(row => row.state === 'Texas'));
});

test('China outreach groups its ranked catalog by province and municipality', () => {
  invalidateUniversityOutreachCache();
  const china = getUniversityOutreach().regions.china;
  assert.equal(china.catalogTotal, 72);
  assert.equal(china.suggested.length, 72);
  assert.ok(china.states.length >= 19);
  assert.ok(china.states.some(row => row.state === 'Beijing'));
  assert.ok(china.states.some(row => row.state === 'Shanghai'));
  assert.ok(china.states.some(row => row.state === 'Jiangsu'));
  assert.equal(china.suggested.filter(row => row.state === 'Unknown').length, 0);
});

test('roster universities outside USA join the correct country and subdivision', () => {
  const verify = db.transaction(() => {
    const location = resolveKnownUniversityLocation('ETH Zurich', 'professor@ethz.ch');
    assert.equal(location.country_id, 'switzerland');
    assert.equal(location.subdivision, 'Canton of Zürich');
    const email = `eth-roster-${Date.now()}@ethz.ch`;
    const dossier = JSON.stringify({
      email,
      university: location.university_name,
      university_country: location.country_id,
      university_state: location.subdivision,
      research_source: 'roster',
    });
    const info = db.prepare(`
      INSERT INTO professors (email, university, dossier, mode)
      VALUES (?, ?, ?, 'instant')
    `).run(email, location.university_name, dossier);
    db.prepare("INSERT INTO queue (professor_id, state, mode) VALUES (?, 'pending', 'instant')").run(info.lastInsertRowid);
    invalidateUniversityOutreachCache();
    const switzerland = getUniversityOutreach().regions.switzerland;
    const row = switzerland.universities.find(item => item.university === location.university_name);
    assert.equal(row.state, 'Canton of Zürich');
    assert.equal(row.status, 'pending');
    assert.ok(switzerland.states.some(item => item.state === 'Canton of Zürich'));
    throw rollback;
  });
  assert.throws(verify, error => error === rollback);
  invalidateUniversityOutreachCache();
});

test('university outreach exposes scheduled and rescheduled states from live batches', () => {
  const verify = db.transaction(() => {
    const batchId = 940000000 + Math.floor(Math.random() * 100000);
    const professorId = batchId + 1;
    const email = `status-${batchId}@utoronto.ca`;
    db.prepare(`
      INSERT INTO scheduled_batches
        (id, scheduled_at, status, auto_approve, gmail_reset_at, gmail_retry_at)
      VALUES (?, datetime('now', '+1 hour'), 'scheduled', 1, datetime('now', '+50 minutes'), datetime('now', '+1 hour'))
    `).run(batchId);
    db.prepare(`
      INSERT INTO scheduled_professors (id, email, university, batch_id)
      VALUES (?, ?, 'University of Toronto', ?)
    `).run(professorId, email, batchId);
    db.prepare(`
      INSERT INTO scheduled_drafts (batch_id, professor_id, status)
      VALUES (?, ?, 'approved')
    `).run(batchId, professorId);
    invalidateUniversityOutreachCache();
    const row = getUniversityOutreach().regions.canada.universities
      .find(item => item.university === 'University of Toronto');
    assert.equal(row.status, 'rescheduled');
    assert.equal(row.rescheduled, 1);
    throw rollback;
  });
  assert.throws(verify, error => error === rollback);
  invalidateUniversityOutreachCache();
});

test('delivery failure resends use explicit terminal status and confirmation', () => {
  const routes = readFileSync(new URL('../src/routes/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(routes, /THEN 'sent'/);
  assert.match(routes, /row\.status !== 'pending'/);
  assert.match(routes, /req\.body\?\.confirm !== true/);
  assert.match(routes, /status='resent', resent_at=datetime\('now'\)/);
  assert.match(routes, /SET status='sending' WHERE id=\? AND status='pending'/);
  assert.match(routes, /router\.post\('\/delivery-failures\/:id\/reject'/);
  assert.match(routes, /Failure rejected permanently/);
});

test('instant file imports start workers and single-row auto mode uses the same path', () => {
  const batchRunner = readFileSync(new URL('../src/services/batchRunner.js', import.meta.url), 'utf8');
  const gmailService = readFileSync(new URL('../src/services/GmailService.js', import.meta.url), 'utf8');
  const instantPage = readFileSync(new URL('../../frontend/src/pages/Instant.jsx', import.meta.url), 'utf8');
  const upload = readFileSync(new URL('../src/routes/upload.js', import.meta.url), 'utf8');
  assert.match(batchRunner, /if \(processable\.length\) startWorkers\(\)/);
  assert.match(batchRunner, /approval_mode, auto_send/);
  assert.match(batchRunner, /auto_send_requested=\?/);
  assert.match(upload, /result\.isSingle && result\.singleQueueId/);
  assert.match(upload, /inserted\.isSingle && inserted\.singleQueueId/);
  assert.match(instantPage, /approval_mode: settings\?\.approval_mode \|\| 'manual'/);
  assert.match(upload, /UPDATE settings SET approval_mode=\?, auto_send=\?/);
  assert.doesNotMatch(gmailService, /for \(const m of \['instant', 'basic_instant', 'scheduled'\]\)/);
  assert.match(gmailService, /loadTemplateFromFile\(mode\)/);
  assert.doesNotMatch(instantPage, /Agent starting — loading template/);
  assert.match(batchRunner, /autoSend \? 1 : 0, autoSend \? 1 : 0/);
  assert.match(readFileSync(new URL('../src/pipeline/index.js', import.meta.url), 'utf8'), /item\?\.auto_send_requested != null/);
  assert.match(upload, /if \(isEntryObjects\) \{/);
  assert.doesNotMatch(upload, /if \(canSkipResearch\(entry\)\) \{/);
});

test('duplicate overrides are removed from instant and scheduled user flows', () => {
  const routes = readFileSync(new URL('../src/routes/index.js', import.meta.url), 'utf8');
  const scheduledRoutes = readFileSync(new URL('../src/routes/scheduled.js', import.meta.url), 'utf8');
  const instantPipeline = readFileSync(new URL('../src/pipeline/index.js', import.meta.url), 'utf8');
  const scheduledPage = readFileSync(new URL('../../frontend/src/pages/Scheduled.jsx', import.meta.url), 'utf8');
  const instantPage = readFileSync(new URL('../../frontend/src/pages/Instant.jsx', import.meta.url), 'utf8');
  assert.match(routes, /Permanent duplicate protection/);
  assert.doesNotMatch(routes, /duplicate_override=1/);
  assert.match(scheduledRoutes, /const skipDup = 1/);
  assert.doesNotMatch(scheduledPage, /Schedule anyway \(re-send to duplicates\)/);
  assert.doesNotMatch(instantPage, /send-again/);
  assert.match(instantPipeline, /if \(isDupe\(item\.prof_email\)\)/);
});

test('sent history pushes real-time university outreach refreshes', () => {
  const gmail = readFileSync(new URL('../src/gmail/index.js', import.meta.url), 'utf8');
  const outreachUi = readFileSync(new URL('../../frontend/src/components/UniversityOutreachBar.jsx', import.meta.url), 'utf8');
  assert.match(gmail, /type: 'sent_history_updated'/);
  assert.match(outreachUi, /event\.type === 'sent_history_updated'/);
  assert.match(outreachUi, /Contacts sent/);
  assert.match(outreachUi, /Universities done/);
  assert.match(outreachUi, /StatusBadge/);
  assert.match(outreachUi, /Refresh DB/);
  assert.match(outreachUi, /filtered\.filter\(row => row\.variant !== 'suggested'\)/);
  assert.match(outreachUi, /\[\.\.\.tracked, \.\.\.suggestions\.slice/);
});

test('instant live send states are persisted and mode-scoped', () => {
  const instant = readFileSync(new URL('../src/pipeline/index.js', import.meta.url), 'utf8');
  assert.match(instant, /updateState\(item\.id, 'sending'\)/);
  assert.doesNotMatch(instant, /type: 'sent'[^\n]*id: item\.id \}\);/);
  assert.doesNotMatch(instant, /type: 'awaiting_proceed'[^\n]*interest_line: interestLine \}\);/);
});

test('scheduled pause events include a readable reason and retry time', () => {
  const scheduler = readFileSync(new URL('../src/pipeline/scheduler.js', import.meta.url), 'utf8');
  const scheduledPage = readFileSync(new URL('../../frontend/src/pages/Scheduled.jsx', import.meta.url), 'utf8');
  assert.match(scheduler, /type: 'scheduled_sending_paused'/);
  assert.match(scheduler, /reason: blocked\?\.reason/);
  assert.match(scheduler, /retryAt: recovery\?\.retryAt/);
  assert.match(scheduler, /gmailResetAt: blocked\?\.retryAt/);
  assert.match(scheduledPage, /gmail_retry_at: data\.retryAt/);
  assert.match(scheduledPage, /gmail_reset_at: data\.(resetAt|gmailResetAt)/);
});

test('batch details collapse identical history events', () => {
  const routes = readFileSync(new URL('../src/routes/scheduled.js', import.meta.url), 'utf8');
  assert.match(routes, /const seenHistory = new Set\(\)/);
  assert.match(routes, /replace\(\/\\s\+\/g, ' '\)\.trim\(\)/);
  assert.match(routes, /if \(seenHistory\.has\(key\)\) return false/);
});

test('permanent archive sent totals and rows use authoritative sent history', () => {
  const verify = db.transaction(() => {
    const email = `archive-authority-${Date.now()}-${Math.random()}@example.com`;
    db.prepare(`
      INSERT INTO sent_email_history (professor_email, subject, source, mode, sent_at)
      VALUES (?, 'Archive authority test', 'gmail_send', 'scheduled', datetime('now'))
    `).run(email);
    const stats = ArchiveService.stats();
    const historyCount = db.prepare('SELECT COUNT(*) AS count FROM sent_email_history').get().count;
    assert.equal(stats.sent, historyCount);
    const result = ArchiveService.searchContacts({ q: email, limit: 10 });
    assert.equal(result.total, 1);
    assert.equal(result.rows[0].professor_email, email);
    assert.equal(result.rows[0].status, 'sent');
    throw rollback;
  });
  assert.throws(verify, error => error === rollback);
});

test('sent archive exposes sent-only rows with reply metadata and message detail', () => {
  const verify = db.transaction(() => {
    const email = `sent-modal-${Date.now()}-${Math.random()}@example.com`;
    const insert = db.prepare(`
      INSERT INTO sent_email_history
        (professor_email, last_name, university, subject, source, mode, sent_at)
      VALUES (?, 'Modal', 'Test University', 'Sent modal test', 'gmail_send', 'instant', datetime('now'))
    `).run(email);
    db.prepare(`
      INSERT INTO replies
        (professor_email, classification, summary, reply_body, received_at, workflow_status)
      VALUES (?, 'positive', 'Interested', 'Please apply.', datetime('now'), 'new')
    `).run(email);
    const list = ArchiveService.sentEmails({ q: email, limit: 10 });
    assert.equal(list.total, 1);
    assert.equal(list.rows[0].reply_count, 1);
    assert.equal(list.rows[0].latest_reply_classification, 'positive');
    const detail = ArchiveService.sentEmailDetail(insert.lastInsertRowid);
    assert.equal(detail.sent.professor_email, email);
    assert.equal(detail.replies.length, 1);
    throw rollback;
  });
  assert.throws(verify, error => error === rollback);
});

test('OAuth token storage is scoped to the active workspace', () => {
  const authSource = readFileSync(new URL('../src/auth/index.js', import.meta.url), 'utf8');
  const authServiceSource = readFileSync(new URL('../src/services/AuthService.js', import.meta.url), 'utf8');
  const frontendApiSource = readFileSync(new URL('../../frontend/src/api.js', import.meta.url), 'utf8');
  assert.match(authSource, /USER_DATA_DIR/);
  assert.match(authSource, /activeTokenPath/);
  assert.match(authSource, /currentTenantKey\(\)/);
  assert.match(authSource, /resolve\(USER_DATA_DIR, tenant, '\.tokens\.json'\)/);
  assert.match(authSource, /commitPendingTokens/);
  assert.match(authServiceSource, /createTenantSession/);
  assert.match(authServiceSource, /runWithTenantKey/);
  assert.doesNotMatch(frontendApiSource, /if \(!sessionVerified && !publicRequest\)/);
  assert.match(frontendApiSource, /credentials: 'include'/);
});

test('scheduled history is permanent and Gmail scans use a rolling 72 hours', () => {
  const scheduledPage = readFileSync(new URL('../../frontend/src/pages/Scheduled.jsx', import.meta.url), 'utf8');
  const sessionContext = readFileSync(new URL('../../frontend/src/context/SessionContext.jsx', import.meta.url), 'utf8');
  const routes = readFileSync(new URL('../src/routes/index.js', import.meta.url), 'utf8');
  const replies = readFileSync(new URL('../src/gmail/replies.js', import.meta.url), 'utf8');

  assert.doesNotMatch(scheduledPage, /useAutoClearAfterBatch/);
  assert.doesNotMatch(sessionContext, /setInterval\(loadSession/);
  assert.match(scheduledPage, /Completed batches/);
  assert.match(routes, /last 72 hours/);
  assert.match(replies, /SCAN_WINDOW_HOURS = 72/);
  assert.match(replies, /after:\$\{after\}/);
  assert.match(replies, /pageToken/);
  assert.match(replies, /full\.data\.internalDate/);
});

test('operational cards navigate to mode-scoped read-only workflow surfaces', () => {
  const routes = readFileSync(new URL('../src/routes/index.js', import.meta.url), 'utf8');
  const instantPage = readFileSync(new URL('../../frontend/src/pages/Instant.jsx', import.meta.url), 'utf8');
  const scheduledPage = readFileSync(new URL('../../frontend/src/pages/Scheduled.jsx', import.meta.url), 'utf8');
  const operationalHook = readFileSync(new URL('../../frontend/src/hooks/useOperationalSummary.js', import.meta.url), 'utf8');
  const insights = readFileSync(new URL('../../frontend/src/components/InsightsPanel.jsx', import.meta.url), 'utf8');

  assert.match(routes, /const requestedMode = String\(req\.query\.mode \|\| 'instant'\)/);
  assert.match(routes, /FROM queue WHERE mode=\?/);
  assert.match(routes, /COALESCE\(batch_mode, 'scheduled'\)=\?/);
  assert.match(instantPage, /navigateCard\('failures', 'not_found'\)/);
  assert.match(instantPage, /openSentArchive\(\)/);
  assert.match(scheduledPage, /navigateCard\('batches', 'scheduled'\)/);
  assert.match(scheduledPage, /id="batches"/);
  assert.match(scheduledPage, /onClearFilter=\{\(\) => setFailureFilter\('all'\)\}/);
  assert.match(insights, /action=\{actions\.sentHistory\}/);
  assert.match(operationalHook, /if \(connected\) return undefined/);
  assert.match(operationalHook, /setInterval\(refresh, 30000\)/);
  assert.doesNotMatch(operationalHook, /\bpost\(|\bput\(|\bdel\(/);
});

test('instant and scheduled modes share the same scroll and slider workflow architecture', () => {
  const instantPage = readFileSync(new URL('../../frontend/src/pages/Instant.jsx', import.meta.url), 'utf8');
  const scheduledPage = readFileSync(new URL('../../frontend/src/pages/Scheduled.jsx', import.meta.url), 'utf8');
  const deck = readFileSync(new URL('../../frontend/src/components/layout/WorkflowDeck.jsx', import.meta.url), 'utf8');
  const layoutContext = readFileSync(new URL('../../frontend/src/context/WorkflowLayoutContext.jsx', import.meta.url), 'utf8');
  const stepCard = readFileSync(new URL('../../frontend/src/components/StepCard.jsx', import.meta.url), 'utf8');

  assert.match(instantPage, /<WorkflowDeck/);
  assert.match(scheduledPage, /<WorkflowDeck/);
  assert.match(instantPage, /id="duplicates"/);
  assert.match(scheduledPage, /id="batches"/);
  assert.match(deck, /workflow-slider-track/);
  assert.match(deck, /ArrowLeft/);
  assert.match(deck, /ArrowRight/);
  assert.match(layoutContext, /email-agent-workflow-layout/);
  assert.match(layoutContext, /return 'scroll'/);
  assert.match(stepCard, /data-owner=\{owner\}/);
  assert.doesNotMatch(deck, /\bpost\(|\bput\(|\bdel\(/);
});

test('workflow layout keeps status in settings and template preview collapsed', () => {
  const header = readFileSync(new URL('../../frontend/src/components/layout/AppHeader.jsx', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../../frontend/src/components/SettingsModal.jsx', import.meta.url), 'utf8');
  const compose = readFileSync(new URL('../../frontend/src/components/GmailComposeChrome.jsx', import.meta.url), 'utf8');
  const live = readFileSync(new URL('../../frontend/src/components/layout/CombinedLiveSection.jsx', import.meta.url), 'utf8');

  assert.match(header, /LayoutToggle/);
  assert.doesNotMatch(header, /GmailConnectionCard/);
  assert.doesNotMatch(header, /StatusChip/);
  assert.match(settings, /System & account status/);
  assert.match(settings, /Connected sender/);
  assert.match(compose, /useState\(false\)/);
  assert.match(compose, /Show template/);
  assert.match(compose, /Hide template/);
  assert.match(live, /Live activity & pipeline/);
  assert.doesNotMatch(live, /Agent now/);
  assert.doesNotMatch(live, /Completed batches/);
});

test('analytics opens from the header beside university outreach', () => {
  const header = readFileSync(new URL('../../frontend/src/components/layout/AppHeader.jsx', import.meta.url), 'utf8');
  const instant = readFileSync(new URL('../../frontend/src/pages/Instant.jsx', import.meta.url), 'utf8');
  const scheduled = readFileSync(new URL('../../frontend/src/pages/Scheduled.jsx', import.meta.url), 'utf8');
  const context = readFileSync(new URL('../../frontend/src/context/AnalyticsPopupContext.jsx', import.meta.url), 'utf8');

  assert.match(header, /<AnalyticsMenu \/>[\s\S]*<UniversityOutreachBar \/>/);
  assert.doesNotMatch(header, /<h2[^>]*>Analytics & insights/);
  assert.match(header, /createPortal/);
  assert.match(header, /closest\('header'\)/);
  assert.match(header, /style=\{\{ top: popupTop \}\}/);
  assert.match(header, /items-start justify-center/);
  assert.match(header, /1280px/);
  assert.match(header, /type: 'spring'/);
  assert.match(instant, /<AnalyticsPopupRegistration/);
  assert.match(scheduled, /<AnalyticsPopupRegistration/);
  assert.doesNotMatch(instant, /<AnalyticsInsightsSection/);
  assert.doesNotMatch(scheduled, /<AnalyticsInsightsSection/);
  assert.match(context, /AnalyticsPopupProvider/);
});

test('university outreach uses a full-width under-header portal', () => {
  const outreach = readFileSync(new URL('../../frontend/src/components/UniversityOutreachBar.jsx', import.meta.url), 'utf8');
  assert.match(outreach, /createPortal/);
  assert.match(outreach, /closest\('header'\)/);
  assert.match(outreach, /top: popupTop/);
  assert.match(outreach, /fixed inset-x-0 bottom-0 z-\[100\]/);
  assert.match(outreach, /flex h-full w-full flex-col overflow-hidden/);
  assert.match(outreach, /type: 'spring'/);
});

test('professor time zones open from a header button after university outreach', () => {
  const header = readFileSync(new URL('../../frontend/src/components/layout/AppHeader.jsx', import.meta.url), 'utf8');
  assert.match(header, /<UniversityOutreachBar \/>[\s\S]*<TimeZonesMenu \/>/);
  assert.match(header, /aria-label="Professor time zones"/);
  assert.match(header, /<TimeManagement \/>/);
  assert.match(header, /closest\('header'\)/);
  assert.match(header, /type: 'spring'/);
  assert.doesNotMatch(header, /Professor time zones[\s\S]*Collapse/);
});

test('startup reconciliation restores persisted instant and scheduled progress', () => {
  const source = readFileSync(new URL('../src/services/startupReconciliation.js', import.meta.url), 'utf8');
  assert.match(source, /JOIN sent_email_history seh ON seh\.queue_id=q\.id/);
  assert.match(source, /WHERE q\.state NOT IN \('sent','replied'\)/);
  assert.match(source, /JOIN sent_email_history seh ON seh\.draft_id=d\.id/);
  assert.match(source, /SET state='pending', research_started_at=NULL/);
  assert.match(source, /SET status='completed', sent=\?/);

  const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(server, /reconcilePersistedWork\(\);\s*PipelineService\.startCronJobs\(\);/);
});

test('permanent archive refreshes from live sent history events', () => {
  const source = readFileSync(new URL('../../frontend/src/components/ArchivePanel.jsx', import.meta.url), 'utf8');
  assert.match(source, /useEventStream/);
  assert.match(source, /sent_history_updated/);
  assert.match(source, /startup_reconciled/);
  assert.match(source, /refreshSignal=\{archiveRefreshSignal\}/);
});

test('instant roster stays user-owned while processing uses a separate persisted ledger', () => {
  const roster = readFileSync(new URL('../src/learning/rosterExcel.js', import.meta.url), 'utf8');
  const routes = readFileSync(new URL('../src/routes/index.js', import.meta.url), 'utf8');
  const instant = readFileSync(new URL('../../frontend/src/pages/Instant.jsx', import.meta.url), 'utf8');
  const rosterUi = readFileSync(new URL('../../frontend/src/components/LiveRosterPanel.jsx', import.meta.url), 'utf8');

  assert.match(roster, /existing\?\.research_status === 'imported'/);
  assert.match(roster, /export function removeRosterRow/);
  assert.match(routes, /router\.delete\('\/roster\/:id'/);
  assert.match(routes, /if \(!sheetRows\.length\) return res\.json\(\[\]\)/);
  assert.match(instant, /WorkflowSlide id="pipeline" title="Processing"/);
  assert.match(instant, /<ProcessingQueueTable/);
  assert.match(rosterUi, /Imported Excel Roster/);
  assert.doesNotMatch(rosterUi, /<StateBadge/);
});

test('instant processing ledger exposes sent, duplicate, not-found, and Gmail-limit evidence', () => {
  const routes = readFileSync(new URL('../src/routes/index.js', import.meta.url), 'utf8');
  const queueUi = readFileSync(new URL('../../frontend/src/components/ProcessingQueueTable.jsx', import.meta.url), 'utf8');

  assert.match(routes, /AS failure_type/);
  assert.match(routes, /AS confirmed_sent_at/);
  assert.match(routes, /AS previously_contacted/);
  assert.match(routes, /AS uploaded_last_name/);
  assert.match(routes, /AS uploaded_subject_keyword/);
  assert.match(routes, /AS uploaded_interest_line/);
  assert.match(routes, /ORDER BY q\.id LIMIT 500/);
  assert.match(queueUi, /Email not found/);
  assert.match(queueUi, /Gmail limit/);
  assert.match(queueUi, /Confirmed in sent history/);
  assert.match(queueUi, /Matched against permanent sent history/);
  assert.match(queueUi, /\['Sr\.', 'Last Name', 'Email', 'Subject Keyword', 'Interest Line', 'Status', 'Actions'\]/);
  assert.doesNotMatch(queueUi, /slice\(0,\s*100\)/);
});

test('safe Send All reconciles first and excludes sent, duplicate, and delivery-failure rows', () => {
  const routes = readFileSync(new URL('../src/routes/index.js', import.meta.url), 'utf8');
  const batchRunner = readFileSync(new URL('../src/services/batchRunner.js', import.meta.url), 'utf8');
  const queueUi = readFileSync(new URL('../../frontend/src/components/ProcessingQueueTable.jsx', import.meta.url), 'utf8');

  assert.match(routes, /router\.post\('\/queue\/send-all-safe'/);
  assert.match(routes, /Explicit Send All confirmation is required/);
  assert.match(routes, /reconcileInstantQueue\(mode\)/);
  assert.match(routes, /df\.failure_type IN \('not_found','delivery_failed'\)/);
  assert.match(routes, /SELECT 1 FROM sent_email_history seh/);
  assert.match(routes, /forceAutoSend: true/);
  assert.match(batchRunner, /forceAutoSend = false/);
  assert.match(queueUi, /Send All \(\$\{safeSendCount\}\)/);
  assert.match(queueUi, /Confirm \$\{safeSendCount\} emails/);
});

test('instant imports have permanent mode-scoped queue numbers and completed queue history', () => {
  const schema = readFileSync(new URL('../src/db/index.js', import.meta.url), 'utf8');
  const groups = readFileSync(new URL('../src/services/instantQueueGroups.js', import.meta.url), 'utf8');
  const upload = readFileSync(new URL('../src/routes/upload.js', import.meta.url), 'utf8');
  const reset = readFileSync(new URL('../src/db/resetSession.js', import.meta.url), 'utf8');
  const instant = readFileSync(new URL('../../frontend/src/pages/Instant.jsx', import.meta.url), 'utf8');

  assert.match(schema, /CREATE TABLE IF NOT EXISTS instant_queue_groups/);
  assert.match(schema, /UNIQUE\(mode, queue_number\)/);
  assert.match(schema, /ALTER TABLE queue ADD COLUMN queue_group_id/);
  assert.match(groups, /MAX\(queue_number\), 0\) \+ 1/);
  assert.match(groups, /mode === 'basic_instant' \? 'basic_instant' : 'instant'/);
  assert.match(upload, /createInstantQueueGroup\(mode \|\| 'instant', 'file_import'\)/);
  assert.match(upload, /INSERT INTO queue \(professor_id, state, mode, queue_group_id\)/);
  assert.match(reset, /closeCurrentInstantQueue\('instant'\)/);
  assert.doesNotMatch(reset, /DELETE FROM queue'\)\.run\(\)/);
  assert.match(instant, /WorkflowSlide id="completed-queues" title="Completed queues"/);
  assert.match(instant, /Processing · Queue #/);
});
