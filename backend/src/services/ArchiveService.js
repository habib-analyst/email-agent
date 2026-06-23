import archiveDb from '../db/archive.js';
import db, { currentTenantKey } from '../db/index.js';

function normEmail(email) {
  return (email || '').toLowerCase().trim();
}

function timestampMs(value) {
  if (!value) return 0;
  const normalized = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  return new Date(normalized).getTime() || 0;
}

function authoritativeSentRows(q = '') {
  const params = [];
  let where = '';
  if (q) {
    const like = `%${q}%`;
    where = 'WHERE professor_email LIKE ? OR last_name LIKE ? OR subject LIKE ?';
    params.push(like, like, like);
  }
  return db.prepare(`
    SELECT id, professor_email, last_name, university, mode, subject, message_id,
      batch_id, queue_id, draft_id, source, sent_at
    FROM sent_email_history
    ${where}
  `).all(...params).map(row => ({
    id: `sent-history-${row.id}`,
    professor_email: row.professor_email,
    last_name: row.last_name,
    university: row.university,
    mode: row.mode,
    outreach_type: row.mode?.includes('scheduled') ? 'scheduled' : 'instant',
    status: row.source?.includes('resend') ? 'resent' : 'sent',
    subject: row.subject,
    message_id: row.message_id,
    batch_id: row.batch_id,
    queue_id: row.queue_id,
    draft_id: row.draft_id,
    agent_summary: `Authoritative sent history (${row.source || 'gmail_send'})`,
    created_at: row.sent_at,
  }));
}

function sentEmailWhere(q) {
  if (!q) return { where: '', params: [] };
  const like = `%${q}%`;
  return {
    where: `WHERE (
      seh.professor_email LIKE ?
      OR seh.last_name LIKE ?
      OR seh.university LIKE ?
      OR seh.subject LIKE ?
      OR CAST(seh.batch_id AS TEXT) LIKE ?
    )`,
    params: [like, like, like, like, like],
  };
}

/** One-time backfill from session DBs into permanent archive. */
const backfilledTenants = new Set();

function backfillFromSessionDb() {
  const tenant = currentTenantKey() || 'anonymous';
  if (backfilledTenants.has(tenant)) return;
  const count = archiveDb.prepare('SELECT COUNT(*) as c FROM archive_outreach').get().c;
  if (count > 0) {
    backfilledTenants.add(tenant);
    return;
  }

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
  backfilledTenants.add(tenant);
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
    backfillFromSessionDb();
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
    backfillFromSessionDb();
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
    backfillFromSessionDb();
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
    backfillFromSessionDb();
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
    backfillFromSessionDb();
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

  sentEmails({ q = '', limit = 200, offset = 0 } = {}) {
    const { where, params } = sentEmailWhere(q);
    const rows = db.prepare(`
      SELECT seh.*,
        (SELECT COUNT(*) FROM replies r
          WHERE lower(r.professor_email)=lower(seh.professor_email)) AS reply_count,
        (SELECT r.classification FROM replies r
          WHERE lower(r.professor_email)=lower(seh.professor_email)
          ORDER BY r.received_at DESC, r.id DESC LIMIT 1) AS latest_reply_classification,
        (SELECT r.received_at FROM replies r
          WHERE lower(r.professor_email)=lower(seh.professor_email)
          ORDER BY r.received_at DESC, r.id DESC LIMIT 1) AS latest_reply_at
      FROM sent_email_history seh
      ${where}
      ORDER BY seh.sent_at DESC, seh.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    const total = db.prepare(`
      SELECT COUNT(*) AS count FROM sent_email_history seh ${where}
    `).get(...params).count;
    return { rows, total };
  },

  sentEmailDetail(id) {
    const sent = db.prepare(`
      SELECT seh.*,
        COALESCE(sd.custom_html, sd.html_preview, q.custom_html) AS stored_html,
        sd.interest_line AS scheduled_interest_line,
        q.interest_line AS instant_interest_line
      FROM sent_email_history seh
      LEFT JOIN scheduled_drafts sd ON sd.id=seh.draft_id AND seh.mode LIKE '%scheduled%'
      LEFT JOIN queue q ON q.id=seh.queue_id
      WHERE seh.id=?
    `).get(id);
    if (!sent) return null;
    const replies = db.prepare(`
      SELECT id, thread_id, classification, summary, reply_body, received_at,
        workflow_status, replied_by_user, reply_sent_at, suggested_reply,
        original_subject, gmail_message_id, sent_message_id
      FROM replies
      WHERE lower(professor_email)=lower(?)
      ORDER BY received_at ASC, id ASC
    `).all(sent.professor_email);
    const settings = db.prepare(
      'SELECT sender_email, sender_name, resume_path FROM settings WHERE id=1'
    ).get() || {};
    return {
      sent,
      replies,
      sender: {
        email: settings.sender_email || null,
        name: settings.sender_name || null,
      },
      resumeName: settings.resume_path
        ? String(settings.resume_path).split(/[\\/]/).pop()
        : 'Resume.pdf',
    };
  },

  searchContacts({ q, status, limit = 100, offset = 0 } = {}) {
    backfillFromSessionDb();
    const rows = [];
    if (!status || status === 'sent' || status === 'resent') {
      rows.push(...authoritativeSentRows(q).filter(row => !status || row.status === status));
    }

    const clauses = ["status NOT IN ('sent','resent')"];
    const params = [];
    if (q) {
      clauses.push('(professor_email LIKE ? OR last_name LIKE ? OR subject LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    if (status && status !== 'sent' && status !== 'resent') {
      clauses.push('status=?');
      params.push(status);
    }
    if (!status || (status !== 'sent' && status !== 'resent')) {
      rows.push(...archiveDb.prepare(`
        SELECT * FROM archive_outreach
        WHERE ${clauses.join(' AND ')}
      `).all(...params));
    }

    rows.sort((a, b) => timestampMs(b.created_at) - timestampMs(a.created_at));
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  },

  recentAgentLog(limit = 50) {
    backfillFromSessionDb();
    return archiveDb.prepare(`
      SELECT * FROM archive_agent_log ORDER BY created_at DESC LIMIT ?
    `).all(limit);
  },

  stats() {
    backfillFromSessionDb();
    const sent = db.prepare('SELECT COUNT(*) as c FROM sent_email_history').get().c;
    const uniqueEmails = db.prepare('SELECT COUNT(DISTINCT professor_email) as c FROM sent_email_history').get().c;
    const nonSent = archiveDb.prepare("SELECT COUNT(*) as c FROM archive_outreach WHERE status NOT IN ('sent','resent')").get().c;
    return {
      totalOutreach: sent + nonSent,
      sent,
      failed: archiveDb.prepare("SELECT COUNT(*) as c FROM archive_outreach WHERE status='failed'").get().c,
      duplicates: archiveDb.prepare("SELECT COUNT(*) as c FROM archive_outreach WHERE status='duplicate_blocked'").get().c,
      agentEvents: archiveDb.prepare('SELECT COUNT(*) as c FROM archive_agent_log').get().c,
      uniqueEmails,
    };
  },
};

export default ArchiveService;
