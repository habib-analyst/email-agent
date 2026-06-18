import Database from 'better-sqlite3';
import { resolve } from 'path';

/** Permanent outreach archive — never cleared on session reset. */
const archivePath = resolve(import.meta.dirname, '../../archive.db');
const archiveDb = new Database(archivePath);

archiveDb.pragma('journal_mode = WAL');
archiveDb.pragma('foreign_keys = ON');
archiveDb.pragma('busy_timeout = 5000');

archiveDb.exec(`
CREATE TABLE IF NOT EXISTS archive_outreach (
  id INTEGER PRIMARY KEY,
  professor_email TEXT NOT NULL,
  last_name TEXT,
  university TEXT,
  mode TEXT,
  outreach_type TEXT,
  status TEXT NOT NULL,
  subject TEXT,
  interest_line TEXT,
  message_id TEXT,
  error TEXT,
  agent_summary TEXT,
  batch_id INTEGER,
  queue_id INTEGER,
  draft_id INTEGER,
  session_epoch INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_archive_outreach_email ON archive_outreach(professor_email);
CREATE INDEX IF NOT EXISTS idx_archive_outreach_email_status ON archive_outreach(professor_email, status);
CREATE INDEX IF NOT EXISTS idx_archive_outreach_created ON archive_outreach(created_at);

CREATE TABLE IF NOT EXISTS archive_agent_log (
  id INTEGER PRIMARY KEY,
  professor_email TEXT,
  last_name TEXT,
  mode TEXT,
  batch_id INTEGER,
  queue_id INTEGER,
  draft_id INTEGER,
  event_type TEXT NOT NULL,
  label TEXT,
  detail TEXT,
  tokens INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_archive_agent_email ON archive_agent_log(professor_email);
CREATE INDEX IF NOT EXISTS idx_archive_agent_created ON archive_agent_log(created_at);
CREATE INDEX IF NOT EXISTS idx_archive_agent_type ON archive_agent_log(event_type);
`);

export default archiveDb;
