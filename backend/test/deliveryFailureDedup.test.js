import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../src/db/index.js';
import { hasProcessedDeliveryFailure } from '../src/gmail/replies.js';

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
