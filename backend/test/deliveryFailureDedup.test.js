import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../src/db/index.js';
import {
  cleanReplyBody,
  detectDeliveryFailure,
  hasProcessedDeliveryFailure,
} from '../src/gmail/replies.js';

test('delivery failure messages are deduplicated by Gmail message ID', () => {
  const messageId = `dedup-test-${Date.now()}-${Math.random()}`;
  assert.equal(hasProcessedDeliveryFailure(messageId), false);

  const rollback = new Error('rollback');
  const verifyInsideTransaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO delivery_failures (professor_email, failure_type, message_id)
      VALUES (?, 'send_limit', ?)
    `).run('dedup-test@example.com', messageId);
    assert.equal(hasProcessedDeliveryFailure(messageId), true);
    throw rollback;
  });

  assert.throws(verifyInsideTransaction, error => error === rollback);
  assert.equal(hasProcessedDeliveryFailure(messageId), false);
});

test('database prevents duplicate Gmail failure rows for the same recipient', () => {
  const messageId = `dedup-unique-${Date.now()}-${Math.random()}`;
  const rollback = new Error('rollback');
  const verifyInsideTransaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO delivery_failures (professor_email, failure_type, message_id)
      VALUES (?, 'not_found', ?)
    `).run('unique-test@example.com', messageId);
    assert.throws(() => {
      db.prepare(`
        INSERT INTO delivery_failures (professor_email, failure_type, message_id)
        VALUES (?, 'not_found', ?)
      `).run('unique-test@example.com', messageId);
    }, /UNIQUE constraint failed/);
    throw rollback;
  });

  assert.throws(verifyInsideTransaction, error => error === rollback);
});

test('delivery scan recognizes address-not-found and Gmail send-limit messages', () => {
  assert.equal(detectDeliveryFailure({
    from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
    subject: 'Delivery Status Notification',
    body: "Your message to professor@university.edu couldn't be found.",
  })?.type, 'not_found');
  assert.equal(detectDeliveryFailure({
    from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
    subject: 'Delivery Status Notification',
    body: 'You have reached a limit for sending mail.',
  })?.type, 'send_limit');
});

test('reply body cleanup removes quoted email history', () => {
  assert.equal(
    cleanReplyBody('Thank you for your email.\n\nOn Thu, Jun 18, 2026 someone wrote:\n> Previous message'),
    'Thank you for your email.',
  );
});

test('reply scenarios are seeded and reply history has terminal workflow columns', () => {
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM reply_scenarios WHERE built_in=1').get().c, 6);
  const columns = new Set(db.prepare('PRAGMA table_info(replies)').all().map(column => column.name));
  for (const name of ['scenario_id', 'workflow_status', 'replied_by_user', 'original_resent_at']) {
    assert.equal(columns.has(name), true);
  }
});
