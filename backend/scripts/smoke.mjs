import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import db from '../src/db/index.js';
import { getModeProfile } from '../src/config/modes.js';

function scalar(sql, ...params) {
  return db.prepare(sql).get(...params);
}

function tableExists(name) {
  return !!scalar("SELECT name FROM sqlite_master WHERE type='table' AND name=?", name);
}

function indexExists(name) {
  return !!scalar("SELECT name FROM sqlite_master WHERE type='index' AND name=?", name);
}

try {
  assert.equal(String(db.pragma('journal_mode', { simple: true })).toLowerCase(), 'wal', 'SQLite WAL mode must be enabled');
  assert.equal(Number(db.pragma('foreign_keys', { simple: true })), 1, 'SQLite foreign keys must be enabled');
  assert.ok(Number(db.pragma('busy_timeout', { simple: true })) >= 5000, 'SQLite busy_timeout must be at least 5000ms');

  for (const table of [
    'professors',
    'queue',
    'sent_log',
    'replies',
    'settings',
    'template',
    'scheduled_batches',
    'scheduled_professors',
    'scheduled_drafts',
    'scheduled_sent_log',
    'scheduled_template',
  ]) {
    assert.ok(tableExists(table), `Missing table: ${table}`);
  }

  for (const index of [
    'idx_queue_state',
    'idx_queue_professor_id',
    'idx_sent_log_email',
    'idx_professors_email_mode',
    'idx_scheduled_prof_email_batch',
    'idx_scheduled_drafts_batch',
  ]) {
    assert.ok(indexExists(index), `Missing index: ${index}`);
  }

  assert.equal(scalar('SELECT id FROM settings WHERE id=1')?.id, 1, 'Settings seed row is missing');

  for (const mode of ['instant', 'basic_instant']) {
    const profile = getModeProfile(mode);
    const tpl = scalar('SELECT raw_html FROM template WHERE mode=?', mode);
    assert.equal(profile.templateTable, 'template', `${mode} should use template table`);
    assert.ok(tpl?.raw_html, `Missing template for ${mode}`);
  }

  for (const mode of ['scheduled', 'basic_scheduled']) {
    const profile = getModeProfile(mode);
    const tpl = scalar('SELECT raw_html FROM scheduled_template WHERE mode=?', mode);
    assert.equal(profile.templateTable, 'scheduled_template', `${mode} should use scheduled_template table`);
    assert.ok(tpl?.raw_html, `Missing template for ${mode}`);
  }

  const routesSource = readFileSync(resolve(import.meta.dirname, '../src/routes/index.js'), 'utf8');
  const queueDeleteRoutes = routesSource.match(/router\.delete\('\/queue\/:id'/g) || [];
  assert.equal(queueDeleteRoutes.length, 1, 'Expected exactly one DELETE /queue/:id route');
  assert.match(routesSource, /Cannot delete a sent item/, 'Queue delete route must block sent items');

  console.log('backend smoke ok');
} finally {
  db.close();
}
