import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../src/db/index.js';
import {
  injectTracking,
  parseTenantFromToken,
  createTrackingRecord,
  recordOpen,
  recordClick,
  attachMessageId,
  getTrackingSummary,
} from '../src/tracking/index.js';

function row(token) {
  return db.prepare('SELECT * FROM email_tracking WHERE token=?').get(token);
}

test('injectTracking rewrites http links and appends an open pixel', () => {
  const html = '<body><p>Hi</p><a href="https://lab.example.edu/apply">apply</a> <a href="mailto:p@uni.edu">mail</a></body>';
  const out = injectTracking(html, 'tok123');
  assert.match(out, /\/api\/track\/c\/tok123\?u=https%3A%2F%2Flab\.example\.edu%2Fapply/);
  assert.match(out, /mailto:p@uni\.edu/);
  assert.match(out, /\/api\/track\/o\/tok123\.gif/);
  assert.ok(out.indexOf('<img') > out.indexOf('apply'), 'pixel inserted before </body>');
});

test('injectTracking does not double-wrap already-tracked links', () => {
  const html = '<a href="https://x.test/page">x</a>';
  const once = injectTracking(html, 'tokA');
  const twice = injectTracking(once, 'tokB');
  assert.equal((twice.match(/track\/c\//g) || []).length, 1);
});

test('parseTenantFromToken maps legacy token to null and reads tenant prefix', () => {
  assert.equal(parseTenantFromToken('_~abc123'), null);
  assert.equal(parseTenantFromToken('deadbeefdeadbeefdeadbeef~abc'), 'deadbeefdeadbeefdeadbeef');
});

test('recordOpen and recordClick increment counts and timestamps', () => {
  const token = createTrackingRecord({ professor_email: 'track-a@uni.test', subject: 'Hi', mode: 'instant' });
  try {
    attachMessageId(token, 'msg-track-a');
    assert.equal(row(token).message_id, 'msg-track-a');

    recordOpen(token);
    recordOpen(token);
    recordClick(token, 'https://lab.test/apply');

    const r = row(token);
    assert.equal(r.open_count, 2);
    assert.equal(r.click_count, 1);
    assert.ok(r.first_open_at);
    assert.equal(r.last_click_url, 'https://lab.test/apply');
  } finally {
    db.prepare('DELETE FROM email_tracking WHERE token=?').run(token);
  }
});

test('getTrackingSummary returns numeric rates within 0-100', () => {
  const token = createTrackingRecord({ professor_email: 'track-b@uni.test', subject: 'Hi', mode: 'instant' });
  try {
    recordOpen(token);
    const summary = getTrackingSummary();
    assert.equal(typeof summary.tracked, 'number');
    assert.ok(summary.open_rate >= 0 && summary.open_rate <= 100);
    assert.ok(summary.click_rate >= 0 && summary.click_rate <= 100);
    assert.ok(Array.isArray(summary.by_mode));
  } finally {
    db.prepare('DELETE FROM email_tracking WHERE token=?').run(token);
  }
});
