import archiveDb from '../db/archive.js';
import db from '../db/index.js';

function normEmail(email) {
  return (email || '').toLowerCase().trim();
}

/** One-time backfill from session DBs into permanent archive. */
function backfillFromSessionDb() {
  const count = archiveDb.prepare('SELECT COUNT(*) as c FROM archive_outreach').get().c;
  if (count > 0) return;

  const instantRows = db.prepare(`
    SELECT sl.professor_email, sl.subject, sl.message_id, sl.sent_at, sl.mode,
           p.last_name, p.university
    FROM sent_log sl
    LEFT JOIN professors p ON p.email = sl.professor_email
  `).all();

  const insert = archiveDb.prepare(`
    INSERT INTO archive_outreach
      (professor_email, last_name, university, mode, outreach_type, status, subject, message_id, agent_summary, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `);

  const backfill = archiveDb.transaction((rows) => {
    for (const r of rows) {
      insert.run(
        normEmail(r.professor_email),
        r.last_name || null,
        r.university || null,
        r.mode || 'instant',
        r.mode?.includes('scheduled') ? 'scheduled' : 'instant',
        'sent',
        r.subject || null,
        r.message_id || null,
        'Backfilled from sent_log',
        r.sent_at || new Date().toISOString(),
      );
    }
  });

  backfill(instantRows);

  const schedRows = db.prepare(`
    SELECT ssl.professor_email, ssl.subject, ssl.message_id, ssl.sent_at, ssl.batch_id,
           sp.last_name, sp.university
    FROM scheduled_sent_log ssl
    LEFT JOIN scheduled_professors sp ON sp.email = ssl.professor_email
  `).all();

  const backfillSched = archiveDb.transaction((rows) => {
    for (const r of rows) {
      insert.run(
        normEmail(r.professor_email),
        r.last_name || null,
        r.university || null,
        'scheduled',
        'scheduled',
        'sent',
        r.subject || null,
        r.message_id || null,
        `Backfilled from scheduled_sent_log (batch #${r.batch_id || '?'})`,
        r.sent_at || new Date().toISOString(),
      );
    }
  });

  backfillSched(schedRows);

  const total = archiveDb.prepare('SELECT COUNT(*) as c FROM archive_outreach').get().c;
  if (total > 0) console.log(`[Archive] Backfilled ${total} outreach records from session DB`);
}

backfillFromSessionDb();

export const ArchiveService = {
  recordOutreach({
    professor_email,
    last_name,
    university,
    mode = 'instant',
    outreach_type,
    status,
    subject,
    interest_line,
    message_id,
    error,
    agent_summary,
    batch_id,
    queue_id,
    draft_id,
    session_epoch,
  }) {
    const email = normEmail(professor_email);
    if (!email || !status) return null;

    const info = archiveDb.prepare(`
      INSERT INTO archive_outreach
        (professor_email, last_name, university, mode, outreach_type, status, subject, interest_line,
         message_id, error, agent_summary, batch_id, queue_id, draft_id, session_epoch)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      email,
      last_name || null,
      university || null,
      mode,
      outreach_type || (mode?.includes('scheduled') ? 'scheduled' : 'instant'),
      status,
      subject || null,
      interest_line || null,
      message_id || null,
      error || null,
      agent_summary || null,
      batch_id ?? null,
      queue_id ?? null,
      draft_id ?? null,
      session_epoch ?? null,
    );
    return info.lastInsertRowid;
  },

  logAgentEvent({
    professor_email,
    last_name,
    mode,
    batch_id,
    queue_id,
    draft_id,
    event_type,
    label,
    detail,
    tokens,
  }) {
    if (!event_type) return null;
    const info = archiveDb.prepare(`
      INSERT INTO archive_agent_log
        (professor_email, last_name, mode, batch_id, queue_id, draft_id, event_type, label, detail, tokens)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      professor_email ? normEmail(professor_email) : null,
      last_name || null,
      mode || null,
      batch_id ?? null,
      queue_id ?? null,
      draft_id ?? null,
      event_type,
      label || null,
      detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null,
      tokens ?? null,
    );
    return info.lastInsertRowid;
  },

  findLastSent(email, { since } = {}) {
    const norm = normEmail(email);
    if (!norm) return null;
    if (since) {
      return archiveDb.prepare(`
        SELECT * FROM archive_outreach
        WHERE professor_email=? AND status IN ('sent', 'resent') AND created_at >= ?
        ORDER BY created_at DESC LIMIT 1
      `).get(norm, since);
    }
    return archiveDb.prepare(`
      SELECT * FROM archive_outreach
      WHERE professor_email=? AND status IN ('sent', 'resent')
      ORDER BY created_at DESC LIMIT 1
    `).get(norm);
  },

  /** Reuse dossier from archive agent log when available. */
  getCachedDossier(email) {
    const norm = normEmail(email);
    if (!norm) return null;
    const row = archiveDb.prepare(`
      SELECT detail FROM archive_agent_log
      WHERE professor_email=? AND event_type IN ('research_complete', 'dossier_cached')
      ORDER BY created_at DESC LIMIT 1
    `).get(norm);
    if (!row?.detail) return null;
    try {
      const parsed = JSON.parse(row.detail);
      return parsed.dossier || parsed;
    } catch {
      return null;
    }
  },

  cacheDossier(email, dossier, context = {}) {
    if (!dossier?.last_name) return;
    this.logAgentEvent({
      professor_email: email,
      last_name: dossier.last_name,
      mode: context.mode,
      queue_id: context.queue_id,
      event_type: 'dossier_cached',
      label: 'Cached research dossier',
      detail: { dossier },
    });
  },

  getEmailHistory(email, limit = 20) {
    const norm = normEmail(email);
    if (!norm) return { outreach: [], agentLog: [] };
    return {
      outreach: archiveDb.prepare(`
        SELECT * FROM archive_outreach WHERE professor_email=? ORDER BY created_at DESC LIMIT ?
      `).all(norm, limit),
      agentLog: archiveDb.prepare(`
        SELECT * FROM archive_agent_log WHERE professor_email=? ORDER BY created_at DESC LIMIT ?
      `).all(norm, limit),
    };
  },

  searchContacts({ q, status, limit = 100, offset = 0 } = {}) {
    const clauses = [];
    const params = [];
    if (q) {
      clauses.push('(professor_email LIKE ? OR last_name LIKE ? OR subject LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    if (status) {
      clauses.push('status=?');
      params.push(status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = archiveDb.prepare(`
      SELECT * FROM archive_outreach ${where}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    const total = archiveDb.prepare(`
      SELECT COUNT(*) as c FROM archive_outreach ${where}
    `).get(...params).c;
    return { rows, total };
  },

  recentAgentLog(limit = 50) {
    return archiveDb.prepare(`
      SELECT * FROM archive_agent_log ORDER BY created_at DESC LIMIT ?
    `).all(limit);
  },

  stats() {
    return {
      totalOutreach: archiveDb.prepare('SELECT COUNT(*) as c FROM archive_outreach').get().c,
      sent: archiveDb.prepare("SELECT COUNT(*) as c FROM archive_outreach WHERE status IN ('sent','resent')").get().c,
      failed: archiveDb.prepare("SELECT COUNT(*) as c FROM archive_outreach WHERE status='failed'").get().c,
      duplicates: archiveDb.prepare("SELECT COUNT(*) as c FROM archive_outreach WHERE status='duplicate_blocked'").get().c,
      agentEvents: archiveDb.prepare('SELECT COUNT(*) as c FROM archive_agent_log').get().c,
      uniqueEmails: archiveDb.prepare('SELECT COUNT(DISTINCT professor_email) as c FROM archive_outreach').get().c,
    };
  },
};

export default ArchiveService;
