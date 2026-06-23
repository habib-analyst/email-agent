import db from '../db/index.js';

const INSTANT_MODES = new Set(['instant', 'basic_instant']);

export function normalizeInstantMode(mode) {
  return mode === 'basic_instant' ? 'basic_instant' : 'instant';
}

export function createInstantQueueGroup(mode, source = 'import') {
  const normalizedMode = normalizeInstantMode(mode);
  return db.transaction(() => {
    const next = (db.prepare('SELECT COALESCE(MAX(queue_number), 0) + 1 AS n FROM instant_queue_groups WHERE mode=?').get(normalizedMode)?.n || 1);
    const info = db.prepare('INSERT INTO instant_queue_groups (queue_number, mode, source) VALUES (?, ?, ?)').run(next, normalizedMode, source);
    return { id: Number(info.lastInsertRowid), queue_number: next, mode: normalizedMode, source };
  })();
}

export function removeEmptyInstantQueueGroup(groupId) {
  if (!groupId) return;
  const count = db.prepare('SELECT COUNT(*) AS c FROM queue WHERE queue_group_id=?').get(groupId)?.c || 0;
  if (count === 0) db.prepare('DELETE FROM instant_queue_groups WHERE id=?').run(groupId);
}

export function latestInstantQueueGroup(mode) {
  return db.prepare('SELECT * FROM instant_queue_groups WHERE mode=? AND closed_at IS NULL ORDER BY queue_number DESC LIMIT 1')
    .get(normalizeInstantMode(mode)) || null;
}

export function listInstantQueueGroups(mode) {
  const normalizedMode = normalizeInstantMode(mode);
  return db.prepare(`
    SELECT g.*,
      COUNT(q.id) AS total,
      SUM(CASE WHEN q.state='sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN q.state='replied' THEN 1 ELSE 0 END) AS replied,
      SUM(CASE WHEN q.state='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN q.state='skipped' THEN 1 ELSE 0 END) AS skipped,
      SUM(CASE WHEN q.state='duplicate_review' OR q.error='duplicate_skipped' THEN 1 ELSE 0 END) AS duplicates,
      SUM(CASE WHEN q.state IN ('pending','awaiting_proceed','needs_web_research','needs_review') THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN q.state IN ('researching','drafted','verified','sending') THEN 1 ELSE 0 END) AS processing,
      MAX(COALESCE(q.sent_at, q.verified_at, q.drafted_at, q.research_started_at, g.created_at)) AS last_activity_at,
      CASE
        WHEN COUNT(q.id)=0 THEN 'empty'
        WHEN SUM(CASE WHEN q.state IN ('pending','awaiting_proceed','needs_web_research','needs_review','duplicate_review','researching','drafted','verified','sending') THEN 1 ELSE 0 END)=0 THEN 'completed'
        ELSE 'active'
      END AS status
    FROM instant_queue_groups g
    LEFT JOIN queue q ON q.queue_group_id=g.id
    WHERE g.mode=?
    GROUP BY g.id
    ORDER BY g.queue_number DESC
  `).all(normalizedMode);
}

export function getInstantQueueGroupRows(groupId, mode) {
  const normalizedMode = normalizeInstantMode(mode);
  const group = db.prepare('SELECT * FROM instant_queue_groups WHERE id=? AND mode=?').get(groupId, normalizedMode);
  if (!group) return null;
  const rows = db.prepare(`
    SELECT q.*, p.email AS professor_email, p.last_name, p.university, p.dossier,
      COALESCE(json_extract(p.dossier, '$.roster.last_name'), json_extract(p.dossier, '$.last_name'), p.last_name, '') AS uploaded_last_name,
      COALESCE(json_extract(p.dossier, '$.subject_keyword'), '') AS uploaded_subject_keyword,
      COALESCE(json_extract(p.dossier, '$.interest_line'), json_extract(p.dossier, '$.roster.research_interest'), '') AS uploaded_interest_line
    FROM queue q
    JOIN professors p ON p.id=q.professor_id
    WHERE q.queue_group_id=? AND q.mode=?
    ORDER BY q.id
  `).all(group.id, normalizedMode);
  return { ...group, rows };
}

export function closeCurrentInstantQueue(mode, reason = 'reset_by_user') {
  const group = latestInstantQueueGroup(mode);
  if (!group) return;
  db.transaction(() => {
    db.prepare(`
      UPDATE queue
      SET state='skipped', error=?
      WHERE queue_group_id=?
        AND state NOT IN ('sent','replied','failed','skipped')
    `).run(reason, group.id);
    db.prepare('UPDATE instant_queue_groups SET closed_at=COALESCE(closed_at, CURRENT_TIMESTAMP) WHERE id=?').run(group.id);
  })();
}

export function isInstantMode(mode) {
  return INSTANT_MODES.has(mode);
}
