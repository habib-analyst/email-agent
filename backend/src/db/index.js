import Database from 'better-sqlite3';
import { resolve } from 'path';
import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { createHash } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

const LEGACY_DB_PATH = resolve(import.meta.dirname, '../../data.db');
const USER_DATA_DIR = resolve(import.meta.dirname, '../../user-data');
const ACTIVE_USER_PATH = resolve(USER_DATA_DIR, '.active-user');
mkdirSync(USER_DATA_DIR, { recursive: true });

export function tenantKey(email) {
  return createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex').slice(0, 24);
}

function readActiveTenantKey() {
  try {
    return readFileSync(ACTIVE_USER_PATH, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function tenantDbPath(key) {
  return resolve(USER_DATA_DIR, key, 'data.db');
}

function openDatabase(path) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  const connection = new Database(path);
  connection.pragma('journal_mode = WAL');
  connection.pragma('foreign_keys = ON');
  connection.pragma('busy_timeout = 5000');
  return connection;
}

function ensureTenantRuntimeSchema(connection) {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS instant_queue_groups (
      id INTEGER PRIMARY KEY,
      queue_number INTEGER NOT NULL,
      mode TEXT NOT NULL,
      source TEXT DEFAULT 'import',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      closed_at DATETIME,
      UNIQUE(mode, queue_number)
    );
    CREATE TABLE IF NOT EXISTS outbound_send_state (
      id INTEGER PRIMARY KEY CHECK(id=1),
      paused_until DATETIME,
      pause_reason TEXT,
      last_send_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS outbound_send_reservations (
      id INTEGER PRIMARY KEY,
      mode TEXT,
      send_after DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS outbound_send_incidents (
      id INTEGER PRIMARY KEY,
      incident_type TEXT NOT NULL,
      reason TEXT,
      source TEXT,
      message_id TEXT,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_incident_message
      ON outbound_send_incidents(message_id)
      WHERE message_id IS NOT NULL AND message_id != '';
    CREATE TABLE IF NOT EXISTS follow_ups (
      id INTEGER PRIMARY KEY,
      professor_email TEXT NOT NULL,
      stage INTEGER NOT NULL DEFAULT 1,
      thread_id TEXT,
      original_message_id TEXT,
      original_subject TEXT,
      last_name TEXT,
      university TEXT,
      mode TEXT DEFAULT 'instant',
      suggested_body TEXT,
      subject TEXT,
      workflow_status TEXT DEFAULT 'candidate',
      sent_at DATETIME,
      sent_message_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(professor_email, stage)
    );
    CREATE TABLE IF NOT EXISTS email_tracking (
      id INTEGER PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      professor_email TEXT,
      subject TEXT,
      mode TEXT,
      message_id TEXT,
      batch_id TEXT,
      open_count INTEGER NOT NULL DEFAULT 0,
      first_open_at DATETIME,
      last_open_at DATETIME,
      click_count INTEGER NOT NULL DEFAULT 0,
      first_click_at DATETIME,
      last_click_at DATETIME,
      last_click_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_email_tracking_mode ON email_tracking(mode);
  `);
  const queueExists = connection.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='queue'").get();
  if (queueExists) {
  try { connection.exec("ALTER TABLE queue ADD COLUMN auto_send_requested INTEGER"); } catch {}
  try { connection.exec("ALTER TABLE queue ADD COLUMN queue_group_id INTEGER"); } catch {}
  try { connection.exec("CREATE INDEX IF NOT EXISTS idx_queue_group ON queue(queue_group_id)"); } catch {}
  for (const mode of ['instant', 'basic_instant']) {
    const existingGroup = connection.prepare('SELECT id FROM instant_queue_groups WHERE mode=? ORDER BY queue_number DESC LIMIT 1').get(mode);
    const ungrouped = connection.prepare('SELECT COUNT(*) AS c FROM queue WHERE mode=? AND queue_group_id IS NULL').get(mode)?.c || 0;
    if (!existingGroup && ungrouped > 0) {
      const group = connection.prepare('INSERT INTO instant_queue_groups (queue_number, mode, source) VALUES (1, ?, ?)').run(mode, 'legacy_migration');
      connection.prepare('UPDATE queue SET queue_group_id=? WHERE mode=? AND queue_group_id IS NULL').run(group.lastInsertRowid, mode);
    } else if (existingGroup && ungrouped > 0) {
      connection.prepare('UPDATE queue SET queue_group_id=? WHERE mode=? AND queue_group_id IS NULL').run(existingGroup.id, mode);
    }
    connection.prepare(`
      UPDATE instant_queue_groups
      SET created_at=COALESCE((
        SELECT MIN(COALESCE(q.research_started_at, q.drafted_at, q.verified_at, q.sent_at))
        FROM queue q WHERE q.queue_group_id=instant_queue_groups.id
      ), created_at)
      WHERE mode=? AND source='legacy_migration'
    `).run(mode);
  }
  }
  connection.prepare('INSERT OR IGNORE INTO outbound_send_state (id) VALUES (1)').run();
}

let activeTenantKey = readActiveTenantKey();
let activeDbPath = activeTenantKey ? tenantDbPath(activeTenantKey) : LEGACY_DB_PATH;
let activeDb = openDatabase(activeDbPath);
ensureTenantRuntimeSchema(activeDb);
const tenantContext = new AsyncLocalStorage();
const tenantConnections = new Map(activeTenantKey ? [[activeTenantKey, activeDb]] : []);

function contextualDatabase() {
  return tenantContext.getStore()?.db || activeDb;
}

const db = new Proxy({}, {
  get(_target, property) {
    const connection = contextualDatabase();
    const value = connection[property];
    return typeof value === 'function' ? value.bind(connection) : value;
  },
});

function schemaStatements(connection) {
  return connection.prepare(`
    SELECT type, sql
    FROM sqlite_master
    WHERE sql IS NOT NULL
      AND name NOT LIKE 'sqlite_%'
      AND type IN ('table','index','trigger')
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name
  `).all().map(row => row.sql);
}

function removeDatabaseFiles(path) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(`${path}${suffix}`, { force: true }); } catch {}
  }
}

function seedEmptyWorkspace(connection, email) {
  connection.prepare(`
    INSERT OR IGNORE INTO settings
      (id, resume_path, daily_cap, min_delay_min, max_delay_min, followup_days, auto_send, last_digest_sent)
    VALUES (1, NULL, 0, 0, 0, 7, 0, date('now', '-7 days'))
  `).run();
  connection.prepare(`
    UPDATE settings
    SET sender_email=?, sender_name=NULL, resume_path=NULL, user_api_keys=NULL
    WHERE id=1
  `).run(email || null);
  connection.prepare('INSERT OR IGNORE INTO outbound_send_state (id) VALUES (1)').run();
}

function connectionForTenantKey(key) {
  if (!key) return activeDb;
  if (tenantConnections.has(key)) {
    const existing = tenantConnections.get(key);
    ensureTenantRuntimeSchema(existing);
    return existing;
  }
  const path = tenantDbPath(key);
  if (!existsSync(path)) throw new Error(`Tenant workspace does not exist: ${key}`);
  const connection = openDatabase(path);
  ensureTenantRuntimeSchema(connection);
  tenantConnections.set(key, connection);
  return connection;
}

export function runWithTenantKey(key, fn) {
  const connection = connectionForTenantKey(key);
  return tenantContext.run({ key, path: tenantDbPath(key), db: connection }, fn);
}

export function currentTenantKey() {
  return tenantContext.getStore()?.key || activeTenantKey || null;
}

export async function ensureUserWorkspace(email, { migrateLegacy = false } = {}) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) throw new Error('Cannot create user workspace without an email address');
  const key = tenantKey(normalized);
  const targetPath = tenantDbPath(key);
  const targetExists = existsSync(targetPath);
  if (!targetExists && migrateLegacy && activeDbPath === LEGACY_DB_PATH) {
    mkdirSync(resolve(targetPath, '..'), { recursive: true });
    activeDb.pragma('wal_checkpoint(FULL)');
    await activeDb.backup(targetPath);
  } else if (!targetExists) {
    const source = contextualDatabase();
    const statements = schemaStatements(source);
    const fresh = openDatabase(targetPath);
    try {
      fresh.transaction(() => {
        for (const sql of statements) fresh.exec(sql);
        seedEmptyWorkspace(fresh, normalized);
      })();
    } finally {
      fresh.close();
    }
  }
  const connection = connectionForTenantKey(key);
  connection.prepare('INSERT OR IGNORE INTO outbound_send_state (id) VALUES (1)').run();
  connection.prepare('UPDATE settings SET sender_email=? WHERE id=1').run(normalized);
  return { key, path: targetPath, created: !targetExists };
}

export async function activateUserWorkspace(email, { migrateLegacy = false } = {}) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) throw new Error('Cannot activate user workspace without an email address');
  const key = tenantKey(normalized);
  const targetPath = tenantDbPath(key);

  if (activeTenantKey === key && activeDbPath === targetPath) {
    activeDb.prepare('UPDATE settings SET sender_email=? WHERE id=1').run(normalized);
    return { key, path: targetPath, created: false };
  }

  const ensured = await ensureUserWorkspace(normalized, { migrateLegacy });
  const targetExists = !ensured.created;

  const previous = activeDb;
  const next = openDatabase(targetPath);
  tenantConnections.set(key, next);
  activeDb = next;
  activeDbPath = targetPath;
  activeTenantKey = key;
  writeFileSync(ACTIVE_USER_PATH, key, 'utf8');
  activeDb.prepare('INSERT OR IGNORE INTO outbound_send_state (id) VALUES (1)').run();
  activeDb.prepare('UPDATE settings SET sender_email=? WHERE id=1').run(normalized);
  const { registerTenant } = await import('../services/tenantRegistry.js');
  registerTenant({ email: normalized, workspaceKey: key });
  try { previous.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
  try { previous.close(); } catch {}
  return { key, path: targetPath, created: !targetExists };
}

export async function activateAnonymousWorkspace() {
  const key = 'anonymous';
  const targetPath = tenantDbPath(key);
  const statements = schemaStatements(activeDb);
  const previous = activeDb;
  try { previous.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
  try { previous.close(); } catch {}

  removeDatabaseFiles(targetPath);
  const fresh = openDatabase(targetPath);
  fresh.transaction(() => {
    for (const sql of statements) fresh.exec(sql);
    seedEmptyWorkspace(fresh, null);
  })();

  activeDb = fresh;
  activeDbPath = targetPath;
  activeTenantKey = key;
  writeFileSync(ACTIVE_USER_PATH, key, 'utf8');
  return { key, path: targetPath };
}

export function getActiveWorkspace() {
  const context = tenantContext.getStore();
  return context
    ? { key: context.key, path: context.path }
    : { key: activeTenantKey, path: activeDbPath };
}

db.exec(`
CREATE TABLE IF NOT EXISTS professors (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE,
  last_name TEXT,
  university TEXT,
  research_areas TEXT,
  dossier TEXT,
  source_url TEXT,
  mode TEXT DEFAULT 'instant',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS queue (
  id INTEGER PRIMARY KEY,
  professor_id INTEGER,
  state TEXT DEFAULT 'pending',
  subject TEXT,
  interest_line TEXT,
  verification_result TEXT,
  scheduled_for DATETIME,
  sent_at DATETIME,
  error TEXT,
  retry_count INTEGER DEFAULT 0,
  retry_after DATETIME,
  heal_count INTEGER DEFAULT 0,
  research_started_at DATETIME,
  drafted_at DATETIME,
  verified_at DATETIME,
  mode TEXT DEFAULT 'instant'
  ,auto_send_requested INTEGER
  ,queue_group_id INTEGER
);

CREATE TABLE IF NOT EXISTS instant_queue_groups (
  id INTEGER PRIMARY KEY,
  queue_number INTEGER NOT NULL,
  mode TEXT NOT NULL,
  source TEXT DEFAULT 'import',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME,
  UNIQUE(mode, queue_number)
);

CREATE TABLE IF NOT EXISTS sent_log (
  id INTEGER PRIMARY KEY,
  professor_email TEXT,
  subject TEXT,
  message_id TEXT,
  sent_at DATETIME,
  follow_up_sent BOOLEAN DEFAULT 0,
  topic TEXT,
  research_duration_ms INTEGER,
  draft_duration_ms INTEGER,
  total_duration_ms INTEGER,
  mode TEXT DEFAULT 'instant'
);

CREATE TABLE IF NOT EXISTS sent_email_history (
  id INTEGER PRIMARY KEY,
  professor_email TEXT NOT NULL,
  last_name TEXT,
  university TEXT,
  subject TEXT,
  message_id TEXT,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  mode TEXT DEFAULT 'instant',
  source TEXT DEFAULT 'gmail_send',
  professor_id INTEGER,
  queue_id INTEGER,
  batch_id INTEGER,
  draft_id INTEGER
);

CREATE TABLE IF NOT EXISTS university_locations (
  normalized_name TEXT PRIMARY KEY,
  university_name TEXT NOT NULL,
  country_id TEXT NOT NULL,
  country_name TEXT,
  subdivision TEXT,
  source TEXT NOT NULL DEFAULT 'catalog',
  confidence REAL DEFAULT 1,
  source_url TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY,
  thread_id TEXT,
  professor_email TEXT,
  classification TEXT,
  summary TEXT,
  received_at DATETIME
);

CREATE TABLE IF NOT EXISTS reply_scenarios (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  subject_template TEXT DEFAULT 'Re: {{ORIGINAL_SUBJECT}}',
  body_template TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  built_in INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS delivery_failures (
  id INTEGER PRIMARY KEY,
  professor_email TEXT NOT NULL,
  failure_type TEXT DEFAULT 'delivery_failed',
  reason TEXT,
  source TEXT DEFAULT 'gmail',
  mode TEXT DEFAULT 'scheduled',
  message_id TEXT,
  thread_id TEXT,
  batch_id INTEGER,
  draft_id INTEGER,
  queue_id INTEGER,
  raw_excerpt TEXT,
  inquiry_status TEXT DEFAULT 'not_checked',
  inquiry_summary TEXT,
  inquiry_checked_at DATETIME,
  status TEXT DEFAULT 'pending',
  received_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scheduled_batch_history (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  scheduled_at DATETIME,
  gmail_reset_at DATETIME,
  detail TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS outbound_send_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  paused_until DATETIME,
  pause_reason TEXT,
  last_send_at DATETIME,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS outbound_send_reservations (
  id INTEGER PRIMARY KEY,
  mode TEXT,
  recipient_email TEXT,
  send_after DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS outbound_send_incidents (
  id INTEGER PRIMARY KEY,
  incident_type TEXT NOT NULL,
  reason TEXT,
  source TEXT,
  message_id TEXT,
  received_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  resume_path TEXT,
  daily_cap INTEGER DEFAULT 25,
  min_delay_min INTEGER DEFAULT 0,
  max_delay_min INTEGER DEFAULT 0,
  followup_days INTEGER DEFAULT 7,
  auto_send BOOLEAN DEFAULT 0,
  last_digest_sent DATE
);

CREATE TABLE IF NOT EXISTS learning_stats (
  topic TEXT PRIMARY KEY,
  sends INTEGER DEFAULT 0,
  replies INTEGER DEFAULT 0,
  positive_replies INTEGER DEFAULT 0,
  last_used DATETIME
);

CREATE TABLE IF NOT EXISTS template (
  id INTEGER PRIMARY KEY CHECK(id=1),
  raw_html TEXT,
  last_name_placeholder TEXT,
  interest_line_placeholder TEXT,
  instructions TEXT,
  sample_subject TEXT,
  mode TEXT DEFAULT 'instant'
);

CREATE INDEX IF NOT EXISTS idx_professors_email ON professors(email);
CREATE TABLE IF NOT EXISTS scheduled_batches (
  id INTEGER PRIMARY KEY,
  scheduled_at DATETIME NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  total INTEGER DEFAULT 0,
  sent INTEGER DEFAULT 0,
  source_url TEXT,
  auto_approve INTEGER DEFAULT 1,
  source_emails TEXT,
  heal_count INTEGER DEFAULT 0,
  max_professors INTEGER
);

CREATE TABLE IF NOT EXISTS app_counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scheduled_professors (
  id INTEGER PRIMARY KEY,
  email TEXT,
  last_name TEXT,
  university TEXT,
  research_areas TEXT,
  dossier TEXT,
  source_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  verified_name TEXT,
  name_source TEXT,
  name_verified INTEGER DEFAULT 0,
  name_mismatch TEXT,
  batch_id INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_prof_email_batch ON scheduled_professors(email, batch_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_prof_batch ON scheduled_professors(batch_id);

CREATE TABLE IF NOT EXISTS scheduled_sent_log (
  id INTEGER PRIMARY KEY,
  professor_email TEXT,
  subject TEXT,
  topic TEXT,
  message_id TEXT,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  follow_up_sent INTEGER DEFAULT 0,
  batch_id INTEGER,
  draft_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_scheduled_sent_email ON scheduled_sent_log(professor_email);
CREATE INDEX IF NOT EXISTS idx_scheduled_sent_batch ON scheduled_sent_log(batch_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_sent_at ON scheduled_sent_log(sent_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_sent_email_batch ON scheduled_sent_log(professor_email, batch_id);

CREATE TABLE IF NOT EXISTS scheduled_drafts (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER REFERENCES scheduled_batches(id),
  professor_id INTEGER REFERENCES scheduled_professors(id),
  subject TEXT,
  interest_line TEXT,
  html_preview TEXT,
  custom_html TEXT,
  status TEXT DEFAULT 'draft',
  edited_by_user BOOLEAN DEFAULT 0,
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_queue_state ON queue(state);
CREATE INDEX IF NOT EXISTS idx_queue_scheduled ON queue(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_queue_professor_id ON queue(professor_id);
CREATE INDEX IF NOT EXISTS idx_queue_group ON queue(queue_group_id);
CREATE INDEX IF NOT EXISTS idx_sent_log_email ON sent_log(professor_email);
CREATE INDEX IF NOT EXISTS idx_sent_log_sent_at ON sent_log(sent_at);
CREATE INDEX IF NOT EXISTS idx_sent_log_email_mode ON sent_log(professor_email, mode);
CREATE INDEX IF NOT EXISTS idx_sent_email_history_email ON sent_email_history(professor_email);
CREATE INDEX IF NOT EXISTS idx_sent_email_history_sent_at ON sent_email_history(sent_at);
CREATE INDEX IF NOT EXISTS idx_sent_email_history_email_sent_at ON sent_email_history(professor_email, sent_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sent_email_history_message ON sent_email_history(message_id) WHERE message_id IS NOT NULL AND message_id != '';
CREATE INDEX IF NOT EXISTS idx_delivery_failures_email ON delivery_failures(professor_email);
CREATE INDEX IF NOT EXISTS idx_delivery_failures_type ON delivery_failures(failure_type);
CREATE INDEX IF NOT EXISTS idx_delivery_failures_received ON delivery_failures(received_at);
CREATE INDEX IF NOT EXISTS idx_queue_state_mode ON queue(state, mode);
CREATE INDEX IF NOT EXISTS idx_sent_log_sent_at_mode ON sent_log(sent_at, mode);
CREATE INDEX IF NOT EXISTS idx_scheduled_batches_status ON scheduled_batches(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_drafts_batch ON scheduled_drafts(batch_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_drafts_professor_id ON scheduled_drafts(professor_id);
`);

// ── Other scheduled-mode tables ──
db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_replies (
    id INTEGER PRIMARY KEY,
    thread_id TEXT,
    professor_email TEXT,
    classification TEXT,
    summary TEXT,
    received_at DATETIME,
    suggested_reply TEXT,
    reply_subject TEXT,
    reply_sent INTEGER DEFAULT 0,
    attachment_path TEXT,
    original_subject TEXT
  );

  CREATE TABLE IF NOT EXISTS scheduled_template (
    id INTEGER PRIMARY KEY,
    raw_html TEXT,
    last_name_placeholder TEXT,
    interest_line_placeholder TEXT,
    instructions TEXT,
    sample_subject TEXT
  );
`);

// auto_approve column on scheduled_batches (default 1 = automated: draft→auto-approve→send at scheduled_at)
alterTableSilent("ALTER TABLE scheduled_batches ADD COLUMN auto_approve INTEGER DEFAULT 1");

// Store source emails as JSON so queue can re-process later
alterTableSilent("ALTER TABLE scheduled_batches ADD COLUMN source_emails TEXT");

// custom_html override for scheduled drafts (edited by user)
alterTableSilent("ALTER TABLE scheduled_drafts ADD COLUMN custom_html TEXT");

// heal_count for stuck batch recovery tracking
alterTableSilent("ALTER TABLE scheduled_batches ADD COLUMN heal_count INTEGER DEFAULT 0");

// max_professors limit for controlling how many professors to process per batch
alterTableSilent("ALTER TABLE scheduled_batches ADD COLUMN max_professors INTEGER");
alterTableSilent("ALTER TABLE scheduled_batches ADD COLUMN batch_mode TEXT DEFAULT 'scheduled'");
alterTableSilent("ALTER TABLE scheduled_batches ADD COLUMN target_countries TEXT");
alterTableSilent("ALTER TABLE scheduled_batches ADD COLUMN skip_duplicates INTEGER DEFAULT 1");
alterTableSilent("ALTER TABLE scheduled_batches ADD COLUMN enable_web_search INTEGER DEFAULT 0");
alterTableSilent("ALTER TABLE scheduled_batches ADD COLUMN skip_designations TEXT");
alterTableSilent("ALTER TABLE scheduled_template ADD COLUMN mode TEXT DEFAULT 'scheduled'");
try { db.exec("UPDATE scheduled_template SET mode='scheduled' WHERE mode IS NULL OR mode=''"); } catch {}

// Duration tracking columns on sent_log (referenced by /replies route)
alterTableSilent("ALTER TABLE sent_log ADD COLUMN research_duration_ms INTEGER");
alterTableSilent("ALTER TABLE sent_log ADD COLUMN draft_duration_ms INTEGER");
alterTableSilent("ALTER TABLE sent_log ADD COLUMN total_duration_ms INTEGER");

// ── Copy-only migration: backfill mode='scheduled' rows from shared tables ──
// No deletion — mode column kept on shared tables, instant queries still filter WHERE mode='instant'
try {
  const scheduledProfs = db.prepare("SELECT * FROM professors WHERE mode='scheduled'").all();
  if (scheduledProfs.length) {
    const insertProf = db.prepare(`
      INSERT OR IGNORE INTO scheduled_professors
      (id, email, last_name, university, research_areas, dossier, source_url, created_at, verified_name, name_source, name_verified, name_mismatch, batch_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,0,NULL)
    `);
    for (const p of scheduledProfs) {
      insertProf.run(p.id, p.email, p.last_name, p.university, p.research_areas, p.dossier, p.source_url, p.created_at, p.verified_name, p.name_source, p.name_verified, p.name_mismatch);
    }
    // Remap scheduled_drafts.professor_id from old professors.id → scheduled_professors.id
    const draftsNeedingRemap = db.prepare(`
      SELECT d.id as draft_id, d.professor_id as old_prof_id, sp.id as new_prof_id
      FROM scheduled_drafts d
      JOIN scheduled_professors sp ON sp.email = (
        SELECT email FROM professors WHERE professors.id = d.professor_id
      )
      WHERE d.professor_id NOT IN (SELECT id FROM scheduled_professors)
    `).all();
    if (draftsNeedingRemap.length) {
      const remapStmt = db.prepare('UPDATE scheduled_drafts SET professor_id=? WHERE id=?');
      for (const r of draftsNeedingRemap) {
        remapStmt.run(r.new_prof_id, r.draft_id);
      }
      console.log(`[DB] Remapped ${draftsNeedingRemap.length} draft FKs to scheduled_professors`);
    }
    console.log(`[DB] Migrated ${scheduledProfs.length} scheduled professors to separate table`);
  }
} catch (e) { console.error('[DB] Scheduled professor migration:', e.message); }

try {
  const scheduledSent = db.prepare("SELECT * FROM sent_log WHERE mode='scheduled'").all();
  if (scheduledSent.length) {
    const insertSent = db.prepare(`
      INSERT OR IGNORE INTO scheduled_sent_log
      (professor_email, subject, topic, message_id, sent_at, follow_up_sent, batch_id, draft_id)
      VALUES (?,?,?,?,?,?,NULL,NULL)
    `);
    for (const s of scheduledSent) {
      insertSent.run(s.professor_email, s.subject, s.topic, s.message_id, s.sent_at, s.follow_up_sent);
    }
    console.log(`[DB] Migrated ${scheduledSent.length} scheduled sent_log entries to separate table`);
  }
} catch (e) { console.error('[DB] Scheduled sent_log migration:', e.message); }

try {
  const scheduledTpl = db.prepare("SELECT * FROM template WHERE mode='scheduled'").get();
  if (scheduledTpl && !db.prepare("SELECT id FROM scheduled_template WHERE id=?").get(scheduledTpl.id)) {
    db.prepare(`
      INSERT INTO scheduled_template
      (id, raw_html, last_name_placeholder, interest_line_placeholder, instructions, sample_subject)
      VALUES (?,?,?,?,?,?)
    `).run(scheduledTpl.id, scheduledTpl.raw_html, scheduledTpl.last_name_placeholder, scheduledTpl.interest_line_placeholder, scheduledTpl.instructions, scheduledTpl.sample_subject);
    console.log('[DB] Migrated scheduled template to separate table');
  }
} catch (e) { console.error('[DB] Scheduled template migration:', e.message); }

import { getSessionEpoch, ensureEpochColumn } from '../session/epoch.js';
import { migrateProfessorsEmailMode } from './migrateProfessors.js';

ensureEpochColumn(db);
function findResume() {
  const resumeDir = resolve(import.meta.dirname, '../../../Resume');
  try {
    const files = readdirSync(resumeDir);
    const match = files.find(f => /habib/i.test(f) && f.endsWith('.pdf'));
    return match ? resolve(resumeDir, match) : (files.find(f => f.endsWith('.pdf')) ? resolve(resumeDir, files.find(f => f.endsWith('.pdf'))) : null);
  } catch { return null; }
}

// Seed settings
const existing = db.prepare('SELECT id FROM settings WHERE id=1').get();
if (!existing) {
  const resumePath = activeTenantKey ? null : findResume();
  db.prepare(`INSERT INTO settings (id, resume_path, daily_cap, min_delay_min, max_delay_min, followup_days, auto_send, last_digest_sent)
    VALUES (1, ?, 0, 0, 0, 7, 0, date('now', '-7 days'))`).run(resumePath);
}
db.prepare('INSERT OR IGNORE INTO outbound_send_state (id) VALUES (1)').run();

// Validate resume exists on every startup
const settings = db.prepare('SELECT resume_path FROM settings WHERE id=1').get();
if ((!settings.resume_path || !existsSync(settings.resume_path)) && !activeTenantKey) {
  const found = findResume();
  if (found) {
    db.prepare('UPDATE settings SET resume_path=? WHERE id=1').run(found);
    console.log(`[Resume] Found: ${found}`);
  } else {
    console.error('[Resume] WARNING: No PDF found in Resume/ folder!');
  }
} else if (settings.resume_path && existsSync(settings.resume_path)) {
  console.log(`[Resume] Pre-attached: ${settings.resume_path}`);
} else {
  console.log('[Resume] No resume configured for this user workspace');
}

alterTableSilent("ALTER TABLE settings ADD COLUMN approval_mode TEXT DEFAULT 'manual'");
try { db.prepare("UPDATE settings SET approval_mode='manual', auto_send=0 WHERE id=1 AND (approval_mode IS NULL OR approval_mode='' OR approval_mode='auto')").run(); } catch {}
alterTableSilent("ALTER TABLE settings ADD COLUMN basic_subject_keyword INTEGER DEFAULT 0");
alterTableSilent("ALTER TABLE settings ADD COLUMN basic_search_subject_keyword INTEGER DEFAULT 0");
alterTableSilent("ALTER TABLE settings ADD COLUMN duplicate_policy TEXT DEFAULT 'review_always'");
alterTableSilent("ALTER TABLE settings ADD COLUMN duplicate_cooldown_days INTEGER DEFAULT 30");
alterTableSilent("ALTER TABLE settings ADD COLUMN queue_workers INTEGER DEFAULT 2");
alterTableSilent("ALTER TABLE settings ADD COLUMN auto_advance_queue INTEGER DEFAULT 1");
alterTableSilent("ALTER TABLE settings ADD COLUMN confidence_auto_send INTEGER DEFAULT 1");
alterTableSilent("ALTER TABLE settings ADD COLUMN draft_first_scheduled INTEGER DEFAULT 0");
alterTableSilent("ALTER TABLE settings ADD COLUMN stagger_send_min INTEGER DEFAULT 0");
alterTableSilent("ALTER TABLE settings ADD COLUMN wave_batch_size INTEGER DEFAULT 0");
alterTableSilent("ALTER TABLE settings ADD COLUMN campaign_presets TEXT");
alterTableSilent("ALTER TABLE settings ADD COLUMN sender_email TEXT");
alterTableSilent("ALTER TABLE settings ADD COLUMN sender_name TEXT");
alterTableSilent("ALTER TABLE settings ADD COLUMN user_api_keys TEXT");
alterTableSilent("ALTER TABLE scheduled_batches ADD COLUMN draft_first INTEGER DEFAULT 0");
alterTableSilent("ALTER TABLE scheduled_batches ADD COLUMN stagger_send_min INTEGER DEFAULT 0");
alterTableSilent("ALTER TABLE scheduled_batches ADD COLUMN wave_index INTEGER DEFAULT 0");
alterTableSilent("ALTER TABLE scheduled_batches ADD COLUMN wave_total INTEGER DEFAULT 0");
alterTableSilent("ALTER TABLE scheduled_batches ADD COLUMN manual_due_notified_at DATETIME");
alterTableSilent("ALTER TABLE scheduled_batches ADD COLUMN send_attempts INTEGER DEFAULT 0");
alterTableSilent("ALTER TABLE scheduled_batches ADD COLUMN ready_notice_sent_at DATETIME");
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_incident_message ON outbound_send_incidents(message_id) WHERE message_id IS NOT NULL AND message_id != ''"); } catch {}

// Add instructions columns if missing
function alterTableAddColumn(column, definition) {
  try { db.exec(`ALTER TABLE template ADD COLUMN ${column} ${definition}`); } catch (e) {
    if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
      console.error(`[DB] ALTER TABLE ADD COLUMN ${column} failed:`, e.message);
    }
  }
}
alterTableAddColumn('instructions', 'TEXT');
alterTableAddColumn('sample_subject', 'TEXT');
try { db.exec('ALTER TABLE sent_log ADD COLUMN topic TEXT'); } catch (e) {
  if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
    console.error('[DB] ALTER TABLE sent_log ADD COLUMN topic failed:', e.message);
  }
}
try { db.exec('ALTER TABLE queue ADD COLUMN retry_after DATETIME'); } catch (e) {
  if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
    console.error('[DB] ALTER TABLE queue ADD COLUMN retry_after failed:', e.message);
  }
}
try { db.exec('ALTER TABLE queue ADD COLUMN research_started_at DATETIME'); } catch (e) {
  if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
    console.error('[DB] ALTER TABLE queue ADD COLUMN research_started_at failed:', e.message);
  }
}
try { db.exec('ALTER TABLE queue ADD COLUMN drafted_at DATETIME'); } catch (e) {
  if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
    console.error('[DB] ALTER TABLE queue ADD COLUMN drafted_at failed:', e.message);
  }
}
try { db.exec('ALTER TABLE queue ADD COLUMN fast_track INTEGER DEFAULT 0'); } catch (e) {
  if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
    console.error('[DB] ALTER TABLE queue ADD COLUMN fast_track failed:', e.message);
  }
}
try { db.exec('ALTER TABLE queue ADD COLUMN duplicate_override INTEGER DEFAULT 0'); } catch (e) {
  if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
    console.error('[DB] ALTER TABLE queue ADD COLUMN duplicate_override failed:', e.message);
  }
}
try { db.exec('ALTER TABLE settings DROP COLUMN send_window'); } catch {}

// Mode separation: instant vs scheduled
function alterTableSilent(sql) {
  try { db.exec(sql); } catch (e) {
    if (!e.message.includes('duplicate column name') && !e.message.includes('already exists') && !e.message.includes('no such column')) {
      console.error('[DB] Migration failed:', sql, e.message);
    }
  }
}
alterTableSilent("ALTER TABLE queue ADD COLUMN mode TEXT DEFAULT 'instant'");
alterTableSilent("ALTER TABLE queue ADD COLUMN custom_html TEXT");
alterTableSilent("ALTER TABLE queue ADD COLUMN duplicate_override INTEGER DEFAULT 0");
alterTableSilent("ALTER TABLE queue ADD COLUMN auto_send_requested INTEGER");
alterTableSilent("ALTER TABLE queue ADD COLUMN queue_group_id INTEGER");
try { db.exec("CREATE INDEX IF NOT EXISTS idx_queue_group ON queue(queue_group_id)"); } catch {}
alterTableSilent("ALTER TABLE professors ADD COLUMN mode TEXT DEFAULT 'instant'");
alterTableSilent("ALTER TABLE professors ADD COLUMN verified_name TEXT");
alterTableSilent("ALTER TABLE professors ADD COLUMN name_source TEXT");
alterTableSilent("ALTER TABLE professors ADD COLUMN name_verified INTEGER DEFAULT 0");
alterTableSilent("ALTER TABLE professors ADD COLUMN name_mismatch TEXT");
alterTableSilent("ALTER TABLE sent_log ADD COLUMN mode TEXT DEFAULT 'instant'");
alterTableSilent("ALTER TABLE sent_email_history ADD COLUMN last_name TEXT");
alterTableSilent("ALTER TABLE sent_email_history ADD COLUMN university TEXT");
try { db.exec("CREATE INDEX IF NOT EXISTS idx_sent_email_history_university ON sent_email_history(university)"); } catch {}
alterTableSilent("ALTER TABLE replies ADD COLUMN mode TEXT DEFAULT 'instant'");
alterTableSilent("ALTER TABLE replies ADD COLUMN suggested_reply TEXT");
alterTableSilent("ALTER TABLE replies ADD COLUMN reply_subject TEXT");
alterTableSilent("ALTER TABLE replies ADD COLUMN reply_sent INTEGER DEFAULT 0");
alterTableSilent("ALTER TABLE replies ADD COLUMN attachment_path TEXT");
alterTableSilent("ALTER TABLE replies ADD COLUMN original_subject TEXT");
alterTableSilent("ALTER TABLE replies ADD COLUMN reply_body TEXT");
alterTableSilent("ALTER TABLE replies ADD COLUMN gmail_message_id TEXT");
alterTableSilent("ALTER TABLE replies ADD COLUMN analyzed_at DATETIME");
alterTableSilent("ALTER TABLE replies ADD COLUMN scenario_id INTEGER");
alterTableSilent("ALTER TABLE replies ADD COLUMN scenario_confidence REAL");
alterTableSilent("ALTER TABLE replies ADD COLUMN workflow_status TEXT DEFAULT 'new'");
alterTableSilent("ALTER TABLE replies ADD COLUMN replied_by_user INTEGER DEFAULT 0");
alterTableSilent("ALTER TABLE replies ADD COLUMN reply_sent_at DATETIME");
alterTableSilent("ALTER TABLE replies ADD COLUMN sent_message_id TEXT");
alterTableSilent("ALTER TABLE replies ADD COLUMN gmail_draft_id TEXT");
alterTableSilent("ALTER TABLE replies ADD COLUMN rejected_at DATETIME");
alterTableSilent("ALTER TABLE replies ADD COLUMN original_resent_at DATETIME");
alterTableSilent("ALTER TABLE replies ADD COLUMN original_resent_message_id TEXT");
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_replies_gmail_message ON replies(gmail_message_id) WHERE gmail_message_id IS NOT NULL"); } catch {}
alterTableSilent("ALTER TABLE delivery_failures ADD COLUMN status TEXT DEFAULT 'open'");
alterTableSilent("ALTER TABLE delivery_failures ADD COLUMN resent_at DATETIME");
alterTableSilent("ALTER TABLE delivery_failures ADD COLUMN resent_message_id TEXT");
alterTableSilent("ALTER TABLE delivery_failures ADD COLUMN rejected_at DATETIME");
alterTableSilent("ALTER TABLE scheduled_batches ADD COLUMN gmail_reset_at DATETIME");
alterTableSilent("ALTER TABLE scheduled_batches ADD COLUMN gmail_retry_at DATETIME");
try { db.exec("CREATE INDEX IF NOT EXISTS idx_scheduled_batch_history_batch ON scheduled_batch_history(batch_id, id DESC)"); } catch {}
db.prepare(`
  UPDATE scheduled_batches
  SET gmail_retry_at=scheduled_at,
      gmail_reset_at=datetime(scheduled_at, '-2 minutes')
  WHERE gmail_retry_at IS NULL
    AND id IN (
      SELECT DISTINCT batch_id FROM scheduled_drafts
      WHERE status='approved' AND (
        lower(COALESCE(error,'')) LIKE '%rate limit%'
        OR lower(COALESCE(error,'')) LIKE '%sending limit%'
        OR lower(COALESCE(error,'')) LIKE '%limit exceeded%'
      )
    )
`).run();
db.prepare("UPDATE delivery_failures SET status='pending' WHERE status='open' OR status IS NULL").run();
db.prepare("UPDATE replies SET workflow_status=CASE WHEN reply_sent=1 THEN 'sent' ELSE 'new' END WHERE workflow_status IS NULL OR workflow_status=''").run();
alterTableSilent("ALTER TABLE outbound_send_reservations ADD COLUMN recipient_email TEXT");
try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_send_reservations_recipient
    ON outbound_send_reservations(recipient_email)
    WHERE recipient_email IS NOT NULL AND recipient_email != ''
  `);
} catch {}
db.prepare(`
  DELETE FROM delivery_failures
  WHERE message_id IS NOT NULL AND message_id != ''
    AND id NOT IN (
      SELECT MIN(id)
      FROM delivery_failures
      WHERE message_id IS NOT NULL AND message_id != ''
      GROUP BY message_id, professor_email
    )
`).run();
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_failures_message_recipient
  ON delivery_failures(message_id, professor_email)
  WHERE message_id IS NOT NULL AND message_id != ''
`);
alterTableSilent("ALTER TABLE template ADD COLUMN mode TEXT");
try { db.exec("CREATE INDEX idx_queue_mode ON queue(mode)"); } catch {}
try { db.exec("CREATE INDEX idx_professors_mode ON professors(mode)"); } catch {}
try { db.exec("CREATE INDEX idx_sent_log_mode ON sent_log(mode)"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_replies_scenario ON replies(scenario_id, received_at DESC)"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_replies_thread ON replies(thread_id, received_at DESC)"); } catch {}

const DEFAULT_REPLY_SCENARIOS = [
  {
    name: 'No Searches / No Hiring This Year',
    description: 'The professor is not searching for students or hiring this year.',
    body: `Dear Professor [Last Name],

Thank you for letting me know. Could you kindly let me know when you plan to hire again? I would be glad to send you my updated resume for your review at that time. I remain confident in my ability to contribute meaningfully to your research.

Best regards,
Habib Ur Rehman`,
  },
  {
    name: 'No Funding',
    description: 'The professor or lab currently has no funding.',
    body: `Dear Professor [Last Name],

Thank you for your response. I understand the funding situation. Please do remember me if any opportunity opens up in the future. I remain confident that my background and skills would be a strong fit for your lab.

Best regards,
Habib Ur Rehman`,
  },
  {
    name: 'Retiring / Leaving Academia',
    description: 'The professor is retiring, retired, or leaving academia.',
    body: `Dear Professor [Last Name],

Thank you for the update. I wish you all the best in your retirement and future endeavors.

Best regards,
Habib Ur Rehman`,
  },
  {
    name: 'Self-Funding Required',
    description: 'The opportunity requires the student to provide their own funding.',
    body: `Dear Professor [Last Name],

Thank you for your response. I understand, but I am unable to self-fund at this time. Please do remember me if any funded opportunity becomes available in the future. I remain confident I can contribute meaningfully to your work.

Best regards,
Habib Ur Rehman`,
  },
  {
    name: 'Direct to University Application (No Lab Position)',
    description: 'The professor asks the student to apply through the university rather than offering a lab position.',
    body: `Dear Professor [Last Name],

Thank you for letting me know. I will start the university application process and choose you as my primary supervisor. I am confident that working under your guidance would be a great opportunity, and I look forward to contributing meaningfully to your lab.

Best regards,
Habib Ur Rehman`,
  },
  {
    name: 'No Lab Space',
    description: 'The professor has no physical or available lab space.',
    body: `Dear Professor [Last Name],

Thank you for letting me know. Could you kindly let me know when you plan to hire again? I would be glad to send you my updated resume for your review at that time. I remain confident in my ability to contribute meaningfully to your research.

Best regards,
Habib Ur Rehman`,
  },
];

const insertReplyScenario = db.prepare(`
  INSERT OR IGNORE INTO reply_scenarios
    (name, description, subject_template, body_template, active, built_in, sort_order)
  VALUES (?, ?, 'Re: {{ORIGINAL_SUBJECT}}', ?, 1, 1, ?)
`);
DEFAULT_REPLY_SCENARIOS.forEach((scenario, index) => {
  insertReplyScenario.run(scenario.name, scenario.description, scenario.body, index + 1);
});
// Migrate template table: remove CHECK(id=1) to allow multiple rows (one per mode)
try {
  const hasScheduledTpl = db.prepare("SELECT id FROM template WHERE mode='scheduled'").get();
  if (!hasScheduledTpl) {
    // Recreate without CHECK constraint
    db.exec(`
      CREATE TABLE IF NOT EXISTS template_new (
        id INTEGER PRIMARY KEY,
        raw_html TEXT,
        last_name_placeholder TEXT,
        interest_line_placeholder TEXT,
        instructions TEXT,
        sample_subject TEXT,
        mode TEXT UNIQUE
      );
      INSERT OR IGNORE INTO template_new SELECT id, raw_html, last_name_placeholder, interest_line_placeholder, instructions, sample_subject, COALESCE(mode,'instant') FROM template;
      DROP TABLE template;
      ALTER TABLE template_new RENAME TO template;
    `);
  }
} catch {}
// Drop unique email constraint — professors can exist in both modes
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_professors_email_mode ON professors(email, mode)"); } catch {}

migrateProfessorsEmailMode(db);

const tenantStartedWithoutTemplates = !!activeTenantKey
  && db.prepare('SELECT COUNT(*) AS c FROM template').get().c === 0
  && db.prepare('SELECT COUNT(*) AS c FROM scheduled_template').get().c === 0;

// Pre-install default instructions so the agent knows what to do
const DEFAULT_INSTRUCTIONS = `ONLY change 3 things per email — the rest must stay EXACTLY as in the template:

1. SUBJECT: "[Single Keyword] Seeking an MS/PhD Position in Your Lab" — pick ONE research area (1-3 words) from the professor's actual work that aligns with my background (AI/ML, ViT, Perceiver IO, multimodal, deepfake detection, forecasting). Replace [Keyword] with that area.

2. GREETING: Replace {{LAST_NAME}} with the professor's actual last name. Format: "Dear Professor LastName," — use their real last name from research, not guessed from email.

3. INTEREST LINE: Replace {{INTEREST_LINE}} with EXACTLY 3 comma-separated research keywords from the professor's profile. The template already says "I am particularly interested in your work in {{INTEREST_LINE}}." — so {{INTEREST_LINE}} gets replaced with just the keywords (no period), e.g. "Distributed Systems, Cloud Computing, Big Data Processing". DO NOT repeat the sentence wrapper. MAXIMUM 30 words total. DO NOT mention paper titles, publications, or citation details — only research area keywords.

TEMPLATE STRUCTURE (do NOT change any other part):
- Opening: "Greetings!" — stays identical
- My background paragraph (AI/ML, medical imaging, multimodal, deepfake, forecasting) — stays identical
- My publications list (Medical Imaging ViT, GCViT, Multimodal-FNet, Photovoltaic) — stays identical
- My methods paragraph (CNNs, LSTM/GRU, ViT, Perceiver IO, GCViT, multimodal fusion, time-series, Python, PyTorch, TensorFlow, Scikit-learn, XGBoost) — stays identical
- Interest line: "I am particularly interested in your work in {{INTEREST_LINE}}." — ONLY replace {{INTEREST_LINE}} with 3 comma-separated keywords (no period; the template already has the period after the placeholder)
- Closing request: "I would be glad if you have any open MS/PhD or research assistant positions in your lab." — stays identical
- Thank you + signature (Habib Ur Rehman) — stays identical`;
const DEFAULT_SUBJECT = '[Keyword] Seeking an MS/PhD Position in Your Lab';
const DEFAULT_HTML = `<div dir="ltr"><p>Dear Professor {{LAST_NAME}},</p><p>Greetings!</p><p>I am Habib Ur Rehman, a BS Data Analytics graduate from Government College University Faisalabad, Pakistan. My research background is in AI/ML, medical imaging, multimodal learning, deepfake detection, photovoltaic forecasting, and predictive analytics.</p><p>I am seeking an MS/PhD position relevant to my previous works:</p><p></p><ul><li style="margin-left:15px">Medical Imaging with ViT and Perceiver IO — Computational Biology and Chemistry, 2025</li><li style="margin-left:15px">GCViT and Perceiver IO for Multi-Disease Classification — Journal of Supercomputing, 2025</li><li style="margin-left:15px">Multimodal-FNet for Audio-Visual Deepfake Detection — TPAMI, 2026</li><li style="margin-left:15px">Photovoltaic Power Forecasting using Vision Transformer and Time-Series Fusion — 2026</li></ul><p></p><p>My research experiments are mainly based on CNNs, LSTM/GRU, Vision Transformers, Perceiver IO, GCViT, multimodal fusion, and time-series models using Python, PyTorch, TensorFlow, Scikit-learn, and XGBoost, as provided in my attached resume.</p><p>I am particularly interested in your work in {{INTEREST_LINE}}.</p><p>I would be glad if you have any open MS/PhD or research assistant positions in your lab.</p><p>Thank you for taking the time to read this email. I look forward to your response.</p><p>Regards,<br>Habib Ur Rehman</p></div>`;

// Instant-mode template (shared template table, mode='instant')
const tpl = db.prepare("SELECT id FROM template WHERE mode='instant'").get();
if (!tpl) {
  db.prepare("INSERT OR IGNORE INTO template (raw_html, last_name_placeholder, interest_line_placeholder, instructions, sample_subject, mode) VALUES (?, ?, ?, ?, ?, 'instant')").run(DEFAULT_HTML, '{{LAST_NAME}}', '{{INTEREST_LINE}}', DEFAULT_INSTRUCTIONS, DEFAULT_SUBJECT);
} else {
  db.prepare("UPDATE template SET raw_html=COALESCE(raw_html,?), last_name_placeholder=?, interest_line_placeholder=?, instructions=?, sample_subject=? WHERE mode='instant'").run(DEFAULT_HTML, '{{LAST_NAME}}', '{{INTEREST_LINE}}', DEFAULT_INSTRUCTIONS, DEFAULT_SUBJECT);
}

// Basic instant-mode template (last name only — no subject keyword / interest line)
const basicTpl = db.prepare("SELECT id FROM template WHERE mode='basic_instant'").get();
const BASIC_INSTRUCTIONS = `BASIC INSTANT MODE — draft rules for each professor:

ONLY change 1 thing: replace {{LAST_NAME}} with the professor's real last name (Dear Professor LastName,).

DO NOT change:
- Subject — always use exactly: "Seeking an MS/PhD Position in Your Lab" (no [Keyword], no research area)
- Email body — identical for every professor except the greeting last name
- No interest line, no research keywords, no paper references, no personalized sentences

Research step: look up last name only. Then send with fixed subject + template body.`;
const BASIC_SUBJECT = 'Seeking an MS/PhD Position in Your Lab';
const BASIC_HTML = `<div dir="ltr"><p>Dear Professor {{LAST_NAME}},</p><p>Greetings!</p><p>I am Habib Ur Rehman, a BS Data Analytics graduate from Government College University Faisalabad, Pakistan. My research background is in AI/ML, medical imaging, multimodal learning, deepfake detection, photovoltaic forecasting, and predictive analytics.</p><p>I am seeking an MS/PhD position relevant to my previous works:</p><p></p><ul><li style="margin-left:15px">Medical Imaging with ViT and Perceiver IO — Computational Biology and Chemistry, 2025</li><li style="margin-left:15px">GCViT and Perceiver IO for Multi-Disease Classification — Journal of Supercomputing, 2025</li><li style="margin-left:15px">Multimodal-FNet for Audio-Visual Deepfake Detection — TPAMI, 2026</li><li style="margin-left:15px">Photovoltaic Power Forecasting using Vision Transformer and Time-Series Fusion — 2026</li></ul><p></p><p>My research experiments are mainly based on CNNs, LSTM/GRU, Vision Transformers, Perceiver IO, GCViT, multimodal fusion, and time-series models using Python, PyTorch, TensorFlow, Scikit-learn, and XGBoost, as provided in my attached resume.</p><p>I would be glad if you have any open MS/PhD or research assistant positions in your lab.</p><p>Thank you for taking the time to read this email. I look forward to your response.</p><p>Regards,<br>Habib Ur Rehman</p></div>`;
if (!basicTpl) {
  db.prepare("INSERT OR IGNORE INTO template (raw_html, last_name_placeholder, interest_line_placeholder, instructions, sample_subject, mode) VALUES (?, ?, ?, ?, ?, 'basic_instant')").run(BASIC_HTML, '{{LAST_NAME}}', null, BASIC_INSTRUCTIONS, BASIC_SUBJECT);
} else {
  db.prepare("UPDATE template SET raw_html=?, last_name_placeholder=?, interest_line_placeholder=NULL, instructions=?, sample_subject=? WHERE mode='basic_instant'").run(BASIC_HTML, '{{LAST_NAME}}', BASIC_INSTRUCTIONS, BASIC_SUBJECT);
}

// Scheduled-mode templates (normal + basic)
const sTplSched = db.prepare("SELECT id FROM scheduled_template WHERE mode='scheduled'").get();
if (!sTplSched) {
  db.prepare("INSERT INTO scheduled_template (raw_html, last_name_placeholder, interest_line_placeholder, instructions, sample_subject, mode) VALUES (?, ?, ?, ?, ?, 'scheduled')").run(DEFAULT_HTML, '{{LAST_NAME}}', '{{INTEREST_LINE}}', DEFAULT_INSTRUCTIONS, DEFAULT_SUBJECT);
} else {
  db.prepare("UPDATE scheduled_template SET raw_html=COALESCE(raw_html,?), last_name_placeholder=?, interest_line_placeholder=?, instructions=?, sample_subject=? WHERE mode='scheduled'").run(DEFAULT_HTML, '{{LAST_NAME}}', '{{INTEREST_LINE}}', DEFAULT_INSTRUCTIONS, DEFAULT_SUBJECT);
}
const sTplBasic = db.prepare("SELECT id FROM scheduled_template WHERE mode='basic_scheduled'").get();
if (!sTplBasic) {
  db.prepare("INSERT INTO scheduled_template (raw_html, last_name_placeholder, interest_line_placeholder, instructions, sample_subject, mode) VALUES (?, ?, NULL, ?, ?, 'basic_scheduled')").run(BASIC_HTML, '{{LAST_NAME}}', BASIC_INSTRUCTIONS, BASIC_SUBJECT);
} else {
  db.prepare("UPDATE scheduled_template SET raw_html=?, last_name_placeholder=?, interest_line_placeholder=NULL, instructions=?, sample_subject=? WHERE mode='basic_scheduled'").run(BASIC_HTML, '{{LAST_NAME}}', BASIC_INSTRUCTIONS, BASIC_SUBJECT);
}

// Ensure period lives in template after {{INTEREST_LINE}}, not in stored keywords
for (const table of ['template', 'scheduled_template']) {
  try {
    const rows = db.prepare(`SELECT id, raw_html FROM ${table} WHERE raw_html LIKE '%{{INTEREST_LINE}}%'`).all();
    for (const row of rows) {
      const fixed = row.raw_html.replace(/\{\{INTEREST_LINE\}\}(?![.!?])/g, '{{INTEREST_LINE}}.');
      if (fixed !== row.raw_html) {
        db.prepare(`UPDATE ${table} SET raw_html=? WHERE id=?`).run(fixed, row.id);
      }
    }
  } catch {}
}

if (tenantStartedWithoutTemplates) {
  db.prepare('DELETE FROM template').run();
  db.prepare('DELETE FROM scheduled_template').run();
  console.log('[TemplateSeeder] New user workspace has no inherited personal template');
}

// One-time migration: move the legacy single-user database into the connected
// Gmail account's private workspace. Future startups open that workspace directly.
if (!readActiveTenantKey()) {
  const legacyOwner = db.prepare('SELECT sender_email FROM settings WHERE id=1').get()?.sender_email;
  if (legacyOwner) {
    await activateUserWorkspace(legacyOwner, { migrateLegacy: true });
    console.log('[DB] Migrated legacy data into a private user workspace');
  }
}

export default db;
