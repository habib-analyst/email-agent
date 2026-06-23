import db from '../db/index.js';
import { eventBus } from '../core/EventBus.js';
import { syncRosterFromDb } from '../learning/rosterExcel.js';

export function reconcileInstantQueue(mode = null) {
  const modeClause = mode ? 'AND q.mode=?' : '';
  const modeParams = mode ? [mode] : [];
  const confirmed = db.prepare(`
    SELECT q.id, q.mode, seh.sent_at
    FROM queue q
    JOIN sent_email_history seh ON seh.queue_id=q.id
    WHERE q.state NOT IN ('sent','replied')
      AND seh.source IN ('gmail_send','gmail_dry_run')
      ${modeClause}
    GROUP BY q.id
  `).all(...modeParams);

  const markSent = db.prepare(`
    UPDATE queue
    SET state='sent', sent_at=COALESCE(?, sent_at), error=NULL,
        retry_after=NULL, fast_track=0
    WHERE id=?
  `);
  const applyConfirmed = db.transaction(rows => {
    for (const row of rows) markSent.run(row.sent_at || null, row.id);
  });
  applyConfirmed(confirmed);

  const duplicateRows = db.prepare(`
    SELECT q.id
    FROM queue q
    JOIN professors p ON p.id=q.professor_id AND p.mode=q.mode
    WHERE q.state NOT IN ('sent','replied')
      ${modeClause}
      AND NOT EXISTS (SELECT 1 FROM sent_email_history exact WHERE exact.queue_id=q.id)
      AND EXISTS (
        SELECT 1 FROM sent_email_history prior
        WHERE lower(prior.professor_email)=lower(p.email)
      )
  `).all(...modeParams);
  const markDuplicate = db.prepare(
    "UPDATE queue SET state='skipped', error='duplicate_skipped', retry_after=NULL, fast_track=0 WHERE id=?"
  );
  db.transaction(rows => {
    for (const row of rows) markDuplicate.run(row.id);
  })(duplicateRows);

  const failedDeliveries = db.prepare(`
    SELECT DISTINCT q.id, df.failure_type, df.reason
    FROM queue q
    JOIN professors p ON p.id=q.professor_id AND p.mode=q.mode
    JOIN delivery_failures df
      ON df.queue_id=q.id
      OR (df.queue_id IS NULL AND lower(df.professor_email)=lower(p.email) AND df.mode=q.mode)
    WHERE df.failure_type IN ('not_found','delivery_failed')
      ${modeClause}
      AND q.state NOT IN ('sent','replied')
  `).all(...modeParams);
  const markFailed = db.prepare(
    "UPDATE queue SET state='failed', error=?, retry_after=NULL, fast_track=0 WHERE id=?"
  );
  db.transaction(rows => {
    for (const row of rows) markFailed.run(row.reason || row.failure_type, row.id);
  })(failedDeliveries);

  const gmailLimited = db.prepare(`
    SELECT DISTINCT q.id
    FROM queue q
    JOIN professors p ON p.id=q.professor_id AND p.mode=q.mode
    LEFT JOIN delivery_failures df
      ON df.queue_id=q.id
      OR (df.queue_id IS NULL AND lower(df.professor_email)=lower(p.email) AND df.mode=q.mode)
    WHERE q.state NOT IN ('sent','replied','skipped')
      ${modeClause}
      AND (
        df.failure_type='send_limit'
        OR lower(COALESCE(q.error,'')) LIKE '%rate limit%'
        OR lower(COALESCE(q.error,'')) LIKE '%send limit%'
        OR lower(COALESCE(q.error,'')) LIKE '%user-rate%'
      )
  `).all(...modeParams);
  const markPending = db.prepare(
    "UPDATE queue SET state='pending', research_started_at=NULL, fast_track=1 WHERE id=?"
  );
  db.transaction(rows => {
    for (const row of rows) markPending.run(row.id);
  })(gmailLimited);

  const recovered = db.prepare(`
    UPDATE queue
    SET state='pending', research_started_at=NULL
    WHERE state IN ('researching','drafted','verified','sending')
      ${mode ? 'AND mode=?' : ''}
      AND id NOT IN (
        SELECT queue_id FROM sent_email_history WHERE queue_id IS NOT NULL
      )
  `).run(...modeParams).changes;

  if (confirmed.length || duplicateRows.length || failedDeliveries.length || gmailLimited.length || recovered) {
    syncRosterFromDb(mode || 'all');
  }
  return {
    confirmed: confirmed.length,
    duplicates: duplicateRows.length,
    failedDeliveries: failedDeliveries.length,
    gmailLimited: gmailLimited.length,
    recovered,
  };
}

function reconcileScheduledBatches() {
  const confirmedDrafts = db.prepare(`
    SELECT DISTINCT d.id
    FROM scheduled_drafts d
    JOIN sent_email_history seh ON seh.draft_id=d.id
    WHERE d.status NOT IN ('sent','resent')
      AND seh.source IN ('gmail_send','gmail_dry_run','scheduled_sent_log')
  `).all();
  const markDraftSent = db.prepare(
    "UPDATE scheduled_drafts SET status='sent', error=NULL WHERE id=?"
  );
  const applyConfirmed = db.transaction(rows => {
    for (const row of rows) markDraftSent.run(row.id);
  });
  applyConfirmed(confirmedDrafts);

  const batches = db.prepare(`
    SELECT b.id, b.status,
      COUNT(d.id) AS total_drafts,
      SUM(CASE WHEN d.status IN ('sent','resent') THEN 1 ELSE 0 END) AS sent_drafts,
      SUM(CASE WHEN d.status='approved' THEN 1 ELSE 0 END) AS approved_drafts
    FROM scheduled_batches b
    LEFT JOIN scheduled_drafts d ON d.batch_id=b.id
    WHERE b.status!='cancelled'
    GROUP BY b.id
  `).all();

  const updateCount = db.prepare('UPDATE scheduled_batches SET sent=? WHERE id=?');
  const completeBatch = db.prepare(
    "UPDATE scheduled_batches SET status='completed', sent=? WHERE id=?"
  );
  const restoreSending = db.prepare(
    "UPDATE scheduled_batches SET status='scheduled', sent=? WHERE id=? AND status='sending'"
  );
  const applyBatches = db.transaction(rows => {
    for (const batch of rows) {
      const sent = Number(batch.sent_drafts) || 0;
      const total = Number(batch.total_drafts) || 0;
      if (total > 0 && sent === total) completeBatch.run(sent, batch.id);
      else if (batch.status === 'sending' && Number(batch.approved_drafts) > 0) {
        restoreSending.run(sent, batch.id);
      } else {
        updateCount.run(sent, batch.id);
      }
    }
  });
  applyBatches(batches);

  return { confirmedDrafts: confirmedDrafts.length, batches: batches.length };
}

export function reconcilePersistedWork() {
  const instant = reconcileInstantQueue();
  const scheduled = reconcileScheduledBatches();
  const changed = instant.confirmed + instant.recovered + scheduled.confirmedDrafts;
  if (changed) {
    console.log(
      `[Startup] Reconciled ${instant.confirmed} confirmed instant send(s), `
      + `${instant.recovered} interrupted instant item(s), and `
      + `${scheduled.confirmedDrafts} confirmed scheduled draft(s)`,
    );
    eventBus.publish({
      type: 'startup_reconciled',
      mode: 'system',
      instant,
      scheduled,
    });
  }
  return { instant, scheduled };
}

export default reconcilePersistedWork;
