import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import db from '../src/db/index.js';
import {
  getOutboundSendBlock,
  pauseOutboundSending,
  recordSendIncident,
} from '../src/gmail/sendControl.js';
import { getRecordedScheduledDraftIds } from '../src/pipeline/scheduler.js';
import { hasProcessedDeliveryFailure } from '../src/gmail/replies.js';

const rollback = new Error('rollback');

test('account-wide pause blocks every outbound send path', () => {
  const verify = db.transaction(() => {
    const pausedUntil = pauseOutboundSending('quota test', 1);
    const blocked = getOutboundSendBlock();
    assert.equal(blocked.code, 'SEND_PAUSED');
    assert.equal(blocked.retryAt, pausedUntil);
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
});

test('OAuth token storage is scoped to the active workspace', () => {
  const authSource = readFileSync(new URL('../src/auth/index.js', import.meta.url), 'utf8');
  const authServiceSource = readFileSync(new URL('../src/services/AuthService.js', import.meta.url), 'utf8');
  assert.match(authSource, /USER_DATA_DIR/);
  assert.match(authSource, /activeTokenPath/);
  assert.match(authSource, /commitPendingTokens/);
  assert.match(authServiceSource, /Disconnect \$\{previousEmail\} before connecting \$\{profile\.email\}/);
});
