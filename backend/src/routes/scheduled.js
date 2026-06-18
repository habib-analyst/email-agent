import { Router } from 'express';
import db from '../db/index.js';
import { eventBus } from '../core/EventBus.js';
import { enqueueBatch, sendScheduledBatch, cancelScheduledWork, stopScheduler, clearScheduledAbort } from '../pipeline/scheduler.js';
import { getScheduledBatchAgentContext } from '../db/scheduledAgentContext.js';
import { verifyScheduledBatchBeforeSend, verifyScheduledDraft } from '../pipeline/scheduledVerify.js';
import { filterDuplicateEmails, recordDuplicateBlocked } from '../db/duplicateCheck.js';
import { ArchiveService } from '../services/ArchiveService.js';
import { runWebResearchForProfessor } from '../research/profileResearch.js';
import { generateEmail } from '../ai/index.js';
import { getAITargetingHints } from '../learning/index.js';
import { formatGreetingLastName } from '../utils/professor.js';
import { normalizeInterestLineKeywords } from '../utils/interestLine.js';
import { buildOutreachSubject, buildBasicOutreachSubject, stripInterestFromHtml } from '../gmail/basicTemplate.js';
import { clearRosterExcel } from '../learning/rosterExcel.js';
import { sendEmail, isSendLimitError } from '../gmail/index.js';
import XLSX from 'xlsx';
import { suggestScheduledAt } from '../utils/scheduleSuggest.js';
import { requireGmailValidated } from '../middleware/requireGmail.js';
import { professorsFromRawImportInput } from '../utils/pasteImportParser.js';
import { readRosterExcel } from '../learning/rosterExcel.js';
import { recordDeliveryFailure } from '../db/deliveryFailures.js';
import { getDeliveryFailureStats } from '../db/deliveryFailures.js';

const router = Router();

function nextScheduledBatchId() {
  db.prepare("INSERT OR IGNORE INTO app_counters (name, value) VALUES ('scheduled_batch', COALESCE((SELECT MAX(id) FROM scheduled_batches), 0))").run();
  const current = db.prepare("SELECT value FROM app_counters WHERE name='scheduled_batch'").get()?.value || 0;
  const next = current + 1;
  db.prepare("UPDATE app_counters SET value=? WHERE name='scheduled_batch'").run(next);
  return next;
}

async function completeScheduledDraftWebResearch(draftId) {
  const draft = db.prepare(`
    SELECT d.*, sp.email as professor_email, sp.last_name, sp.source_url, sp.dossier as prof_dossier,
      sp.id as scheduled_professor_id, b.batch_mode
    FROM scheduled_drafts d
    JOIN scheduled_professors sp ON d.professor_id = sp.id
    JOIN scheduled_batches b ON b.id = d.batch_id
    WHERE d.id = ?
  `).get(draftId);
  if (!draft) throw new Error('Draft not found');
  if (draft.status !== 'needs_web_research') throw new Error('Draft is not waiting for web research');

  const batchMode = draft.batch_mode === 'basic_scheduled' ? 'basic_scheduled' : 'scheduled';
  const isBasic = batchMode === 'basic_scheduled';

  let existing = {};
  try { existing = JSON.parse(draft.prof_dossier || '{}'); } catch { existing = {}; }

  const dossier = await runWebResearchForProfessor(
    draft.professor_email,
    draft.source_url || '',
    existing.profile_url || draft.source_url || '',
    existing,
  );

  db.prepare('UPDATE scheduled_professors SET dossier=?, last_name=?, research_areas=?, university=COALESCE(NULLIF(university,\'\'), ?) WHERE id=?').run(
    JSON.stringify(dossier),
    dossier.last_name || draft.last_name,
    (dossier.research_areas || []).join(', '),
    dossier.university || '',
    draft.scheduled_professor_id,
  );

  const tpl = db.prepare('SELECT raw_html, instructions, sample_subject FROM scheduled_template WHERE mode=?').get(isBasic ? 'basic_scheduled' : 'scheduled');
  if (!tpl?.raw_html) throw new Error('Scheduled template not configured');

  const lastName = formatGreetingLastName(dossier.last_name || draft.last_name);
  let subject = '';
  let interestLine = '';
  let htmlPreview = '';

  if (isBasic) {
    const subjectKeyword = dossier.subject_keyword || '';
    if (!subjectKeyword) throw new Error('Web research did not yield a subject keyword');
    subject = buildBasicOutreachSubject('search', subjectKeyword);
    htmlPreview = stripInterestFromHtml(tpl.raw_html).replace(/\{\{LAST_NAME\}\}/g, lastName);
  } else {
    const targetingHints = getAITargetingHints()?.summary || '';
    const result = await generateEmail(dossier, tpl.instructions || '', tpl.sample_subject || '', targetingHints, lastName);
    if (!result.pass || !result.interestLine || result.interestLine.length < 5) {
      throw new Error('Web research completed but email personalization was too weak');
    }
    subject = buildOutreachSubject(result.topic, true);
    interestLine = normalizeInterestLineKeywords(result.interestLine || '');
    htmlPreview = tpl.raw_html.replace(/\{\{LAST_NAME\}\}/g, lastName).replace(/\{\{INTEREST_LINE\}\}/g, interestLine);
  }

  const draftCheck = verifyScheduledDraft({
    subject,
    interest_line: interestLine,
    html_preview: htmlPreview,
    last_name: lastName,
  }, batchMode, 'search');

  if (!draftCheck.ok) throw new Error(draftCheck.errors.join('; '));

  db.prepare(`
    UPDATE scheduled_drafts SET subject=?, interest_line=?, html_preview=?, status='draft', error=NULL WHERE id=?
  `).run(subject, interestLine, htmlPreview, draft.id);

  eventBus.publish({
    type: 'scheduled_draft_ready',
    mode: batchMode,
    batchId: draft.batch_id,
    professorEmail: draft.professor_email,
    subject,
    fromWebResearch: true,
  });

  return { subject, interest_line: interestLine, dossier, professorEmail: draft.professor_email };
}

// Create a scheduled batch
router.post('/batch', async (req, res) => {
  try {
    const { scheduled_at, url, emails, auto_approve, max_professors, skip_duplicates, batch_mode, target_countries, draft_first, stagger_send_min, wave_batch_size, skip_designations } = req.body;
    if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at required' });
    if (!url && !emails) return res.status(400).json({ error: 'url or emails required' });

    const mode = batch_mode === 'basic_scheduled' ? 'basic_scheduled' : 'scheduled';

    let professors = url ? [] : professorsFromRawImportInput(emails);
    if (professors.length && max_professors) {
      professors = professors.slice(0, max_professors);
    }

    const skipDup = skip_duplicates !== false ? 1 : 0;
    let skippedDuplicates = [];

    // Deduplicate via permanent archive + session sent logs (default ON)
    if (professors.length) {
      const emailList = professors.map(p => p.email);
      const { allowed, skipped } = filterDuplicateEmails(emailList, { allowAll: skipDup === 0 });
      const allowedSet = new Set(allowed.map(e => e.toLowerCase()));
      professors = professors.filter(p => allowedSet.has(p.email.toLowerCase()));
      skippedDuplicates = skipped;
      for (const s of skipped) {
        recordDuplicateBlocked(s.email, s.prior, { mode, batch_id: null });
      }
      if (skipped.length > 0) {
        console.log(`[Scheduled] Skipped ${skipped.length} duplicate email(s)`);
      }
    }

    // Store structured professor rows when pasted/imported (scheduler re-parses objects)
    const emailsJson = professors.length ? JSON.stringify(professors) : null;

    const countriesJson = target_countries?.length ? JSON.stringify(target_countries) : null;

    const settings = db.prepare('SELECT draft_first_scheduled, stagger_send_min FROM settings WHERE id=1').get() || {};
    const draftFirst = draft_first ?? settings.draft_first_scheduled ?? 0;
    const staggerMin = stagger_send_min ?? settings.stagger_send_min ?? 0;

    const skipDesignationsJson = Array.isArray(skip_designations) && skip_designations.length
      ? JSON.stringify(skip_designations)
      : null;

    const batchId = nextScheduledBatchId();
    db.prepare(
      'INSERT INTO scheduled_batches (id, scheduled_at, status, source_url, auto_approve, source_emails, max_professors, batch_mode, target_countries, skip_duplicates, draft_first, stagger_send_min, wave_index, wave_total, skip_designations) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(batchId, scheduled_at, 'pending', url || null, auto_approve !== undefined ? auto_approve : 1, emailsJson, max_professors || null, mode, countriesJson, skipDup, draftFirst ? 1 : 0, staggerMin, 1, 1, skipDesignationsJson);
    enqueueBatch(batchId);
    clearRosterExcel();

    res.json({
      success: true,
      batchId,
      batchIds: [batchId],
      waveCount: 1,
      auto_approve: auto_approve !== undefined ? auto_approve : 1,
      batch_mode: mode,
      skippedDuplicates,
      processedCount: professors.length || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List all batches with aggregated stats
router.get('/batches', (req, res) => {
  const batches = db.prepare(`
    SELECT b.*,
      (SELECT COUNT(*) FROM scheduled_drafts WHERE batch_id=b.id) as draft_count,
      (SELECT COUNT(*) FROM scheduled_drafts WHERE batch_id=b.id AND status='draft') as pending_count,
      (SELECT COUNT(*) FROM scheduled_drafts WHERE batch_id=b.id AND status='approved') as approved_count,
      (SELECT COUNT(*) FROM scheduled_drafts WHERE batch_id=b.id AND status='sent') as sent_count,
      (SELECT COUNT(*) FROM scheduled_drafts WHERE batch_id=b.id AND status='failed') as failed_count,
      (SELECT COUNT(*) FROM scheduled_drafts WHERE batch_id=b.id AND status='needs_web_research') as needs_web_count
    FROM scheduled_batches b WHERE b.status != 'cancelled' ORDER BY b.created_at DESC LIMIT 50
  `).all();
  res.json(batches);
});

// Get batch stats (for KPI cards)
router.get('/stats', (req, res) => {
  const totalBatches = db.prepare("SELECT COUNT(*) as count FROM scheduled_batches WHERE status != 'cancelled'").get().count;
  const pendingBatches = db.prepare("SELECT COUNT(*) as count FROM scheduled_batches WHERE status IN ('pending','processing')").get().count;
  const draftedBatches = db.prepare("SELECT COUNT(*) as count FROM scheduled_batches WHERE status='drafted'").get().count;
  const scheduledBatches = db.prepare("SELECT COUNT(*) as count FROM scheduled_batches WHERE status='scheduled'").get().count;
  const completedBatches = db.prepare("SELECT COUNT(*) as count FROM scheduled_batches WHERE status='completed'").get().count;
  const sendingBatches = db.prepare("SELECT COUNT(*) as count FROM scheduled_batches WHERE status='sending'").get().count;

  const totalDrafts = db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts").get().count;
  const draftDrafts = db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts WHERE status='draft'").get().count;
  const approvedDrafts = db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts WHERE status='approved'").get().count;
  const sentDrafts = db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts WHERE status='sent'").get().count;
  const failedDrafts = db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts WHERE status='failed'").get().count;
  const needsWebDrafts = db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts WHERE status='needs_web_research'").get().count;

  const totalSent = db.prepare("SELECT COUNT(*) as count FROM sent_email_history").get().count;
  const uniqueSentEmails = db.prepare("SELECT COUNT(DISTINCT professor_email) as count FROM sent_email_history").get().count;

  res.json({
    batches: { total: totalBatches, pending: pendingBatches, drafted: draftedBatches, scheduled: scheduledBatches, sending: sendingBatches, completed: completedBatches },
    drafts: { total: totalDrafts, draft: draftDrafts, approved: approvedDrafts, sent: sentDrafts, failed: failedDrafts, needs_web_research: needsWebDrafts },
    ...getDeliveryFailureStats('scheduled'),
    sent: totalSent,
    totalSent,
    uniqueSentEmails,
  });
});

// Get professors for a batch (roster view)
router.get('/batch/:id/professors', (req, res) => {
  const professors = db.prepare(`
    SELECT sp.*, d.id as draft_id, d.status as draft_status, d.subject, d.interest_line
    FROM scheduled_professors sp
    LEFT JOIN scheduled_drafts d ON d.professor_id = sp.id AND d.batch_id = sp.batch_id
    WHERE sp.batch_id = ?
    ORDER BY sp.id
  `).all(req.params.id);
  res.json(professors);
});

// Reschedule a batch (change scheduled_at)
router.put('/batch/:id/reschedule', (req, res) => {
  const { scheduled_at } = req.body;
  if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at required' });
  const batch = db.prepare('SELECT * FROM scheduled_batches WHERE id=?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (['completed', 'cancelled', 'sending'].includes(batch.status)) {
    return res.status(400).json({ error: 'Cannot reschedule a ' + batch.status + ' batch' });
  }
  db.prepare(`
    UPDATE scheduled_batches
    SET scheduled_at=?, send_attempts=0, ready_notice_sent_at=NULL, manual_due_notified_at=NULL
    WHERE id=?
  `).run(scheduled_at, req.params.id);
  const isDueNow = new Date(scheduled_at).getTime() <= Date.now();
  if (isDueNow && batch.auto_approve === 1) {
    db.prepare("UPDATE scheduled_batches SET status='scheduled', manual_due_notified_at=NULL WHERE id=?").run(req.params.id);
    sendScheduledBatch(batch.id).catch(e => console.error('[Scheduler] Rescheduled batch send failed:', e.message));
  } else if (isDueNow) {
    db.prepare("UPDATE scheduled_batches SET manual_due_notified_at=NULL WHERE id=?").run(req.params.id);
    eventBus.publish({
      type: 'scheduled_batch_manual_due',
      mode: 'scheduled',
      batchId: batch.id,
      scheduledAt: scheduled_at,
      label: `Batch #${batch.id} is ready to review and send`,
    });
  }
  eventBus.publish({ type: 'scheduled_batch_rescheduled', mode: 'scheduled', batchId: batch.id, scheduled_at });
  res.json({ success: true, scheduled_at });
});

// Force-send all overdue auto-approved batches sequentially.
router.post('/batches/send-overdue-now', requireGmailValidated, async (req, res) => {
  try {
    const batches = db.prepare(`
      SELECT * FROM scheduled_batches
      WHERE status IN ('scheduled','pending') AND auto_approve=1 AND scheduled_at <= datetime('now')
      ORDER BY scheduled_at, id
    `).all();
    const sent = [];
    for (const batch of batches) {
      // eslint-disable-next-line no-await-in-loop
      await sendScheduledBatch(batch.id);
      sent.push(batch.id);
    }
    res.json({ success: true, sentCount: sent.length, batchIds: sent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get drafts for a batch
router.get('/batch/:id/drafts', (req, res) => {
  const drafts = db.prepare(`
    SELECT d.*, sp.email as professor_email, sp.last_name, sp.university, sp.research_areas
    FROM scheduled_drafts d
    JOIN scheduled_professors sp ON d.professor_id = sp.id
    WHERE d.batch_id = ?
    ORDER BY d.id
  `).all(req.params.id);

  // Rebuild html_preview for any drafts where it's missing but we have subject/interest
  const batch = db.prepare('SELECT batch_mode FROM scheduled_batches WHERE id=?').get(req.params.id);
  const tplMode = (batch?.batch_mode === 'basic_scheduled') ? 'basic_scheduled' : 'scheduled';
  let tpl = null;
  for (const d of drafts) {
    if (!d.html_preview && !d.custom_html && d.subject) {
      if (!tpl) tpl = db.prepare('SELECT raw_html FROM scheduled_template WHERE mode=?').get(tplMode);
      if (tpl?.raw_html) {
        d.html_preview = tpl.raw_html
          .replace(/\{\{LAST_NAME\}\}/g, d.last_name || '')
          .replace(/\{\{INTEREST_LINE\}\}/g, normalizeInterestLineKeywords(d.interest_line || ''));
        db.prepare('UPDATE scheduled_drafts SET html_preview=? WHERE id=?').run(d.html_preview, d.id);
      }
    }
  }

  res.json(drafts);
});

// Get a single draft with full HTML (for view popup)
router.get('/draft/:id', (req, res) => {
  const draft = db.prepare(`
    SELECT d.*, sp.email as professor_email, sp.last_name
    FROM scheduled_drafts d
    JOIN scheduled_professors sp ON d.professor_id = sp.id
    WHERE d.id = ?
  `).get(req.params.id);
  if (!draft) return res.status(404).json({ error: 'Draft not found' });

  // Rebuild html_preview on-the-fly if missing
  if (!draft.html_preview && !draft.custom_html && draft.subject) {
    const batch = db.prepare('SELECT batch_mode FROM scheduled_batches WHERE id=?').get(draft.batch_id);
    const tplMode = (batch?.batch_mode === 'basic_scheduled') ? 'basic_scheduled' : 'scheduled';
    const tpl = db.prepare('SELECT raw_html FROM scheduled_template WHERE mode=?').get(tplMode);
    if (tpl?.raw_html) {
      draft.html_preview = tpl.raw_html
        .replace(/\{\{LAST_NAME\}\}/g, draft.last_name || '')
        .replace(/\{\{INTEREST_LINE\}\}/g, normalizeInterestLineKeywords(draft.interest_line || ''));
      db.prepare('UPDATE scheduled_drafts SET html_preview=? WHERE id=?').run(draft.html_preview, draft.id);
    }
  }

  res.json(draft);
});

// Run internet research for a draft stuck at needs_web_research, then generate the draft email
router.post('/draft/:id/web-research', async (req, res) => {
  try {
    const result = await completeScheduledDraftWebResearch(parseInt(req.params.id, 10));
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('[Scheduled] draft web-research:', e.message);
    const status = e.message === 'Draft not found' ? 404 : e.message.includes('not waiting') ? 400 : 500;
    res.status(status).json({ error: e.message || 'Web research failed' });
  }
});

router.post('/batch/:id/web-research-bulk', async (req, res) => {
  try {
    const batchId = parseInt(req.params.id, 10);
    const limit = Math.min(Number(req.body.limit) || 50, 100);
    const drafts = db.prepare(`
      SELECT id FROM scheduled_drafts
      WHERE batch_id=? AND status='needs_web_research'
      ORDER BY id LIMIT ?
    `).all(batchId, limit);

    const results = [];
    for (const d of drafts) {
      try {
        await completeScheduledDraftWebResearch(d.id);
        results.push({ draftId: d.id, success: true });
      } catch (e) {
        results.push({ draftId: d.id, success: false, error: e.message });
      }
    }
    res.json({ success: true, processed: results.length, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Edit a draft
router.put('/draft/:id', (req, res) => {
  const { subject, interest_line, custom_html, professor_email } = req.body;
  const draft = db.prepare('SELECT * FROM scheduled_drafts WHERE id=?').get(req.params.id);
  if (!draft) return res.status(404).json({ error: 'Draft not found' });
  if (draft.status === 'sent') return res.status(400).json({ error: 'Cannot edit sent draft' });

  if (professor_email !== undefined) {
    const email = String(professor_email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid professor email required' });
    db.prepare('UPDATE scheduled_professors SET email=? WHERE id=?').run(email, draft.professor_id);
  }

  const sets = [];
  const vals = [];
  if (subject !== undefined) { sets.push('subject=?'); vals.push(subject); }
  if (interest_line !== undefined) { sets.push('interest_line=?'); vals.push(interest_line); }
  if (custom_html !== undefined) { sets.push('custom_html=?'); vals.push(custom_html); }
  sets.push('edited_by_user=1');
  vals.push(req.params.id);

  db.prepare(`UPDATE scheduled_drafts SET ${sets.join(',')} WHERE id=?`).run(...vals);

  // Rebuild preview from scheduled_template (use correct mode)
  const batch = db.prepare('SELECT batch_mode FROM scheduled_batches WHERE id=?').get(draft.batch_id);
  const tplMode = (batch?.batch_mode === 'basic_scheduled') ? 'basic_scheduled' : 'scheduled';
  const tpl = db.prepare('SELECT raw_html FROM scheduled_template WHERE mode=?').get(tplMode);
  if (tpl?.raw_html) {
    const prof = db.prepare('SELECT last_name FROM scheduled_professors WHERE id=?').get(draft.professor_id);
    const html = tpl.raw_html
      .replace(/\{\{LAST_NAME\}\}/g, prof?.last_name || '')
      .replace(/\{\{INTEREST_LINE\}\}/g, normalizeInterestLineKeywords(interest_line ?? draft.interest_line ?? ''));
    db.prepare('UPDATE scheduled_drafts SET html_preview=? WHERE id=?').run(html, req.params.id);
  }

  res.json({ success: true });
});

router.post('/draft/:id/send-now', requireGmailValidated, async (req, res) => {
  try {
    clearScheduledAbort();
    const draft = db.prepare(`
      SELECT d.*, sp.email as professor_email, sp.last_name, sp.id as prof_id, b.batch_mode
      FROM scheduled_drafts d
      JOIN scheduled_professors sp ON d.professor_id = sp.id
      JOIN scheduled_batches b ON b.id = d.batch_id
      WHERE d.id=?
    `).get(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    console.log(`[Scheduled] Manual send requested for draft #${draft.id} (${draft.professor_email}) status=${draft.status}`);

    const result = await sendEmail({
      professor_id: draft.prof_id,
      subject: draft.subject,
      interest_line: draft.interest_line,
      custom_html: draft.custom_html || draft.html_preview || null,
      mode: 'scheduled',
      batch_id: draft.batch_id,
      draft_id: draft.id,
      stripInterestLine: draft.batch_mode === 'basic_scheduled',
      scheduledTemplateMode: draft.batch_mode === 'basic_scheduled' ? 'basic_scheduled' : 'scheduled',
      useSubjectKeyword: draft.batch_mode !== 'basic_scheduled',
    });

    const nextStatus = draft.status === 'sent' || draft.status === 'resent' ? 'resent' : 'sent';
    db.prepare("UPDATE scheduled_drafts SET status=?, error=NULL WHERE id=?").run(nextStatus, draft.id);
    db.prepare(`
      INSERT INTO scheduled_sent_log (professor_email, subject, topic, message_id, sent_at, batch_id, draft_id)
      VALUES (?,?,?,?,datetime('now'),?,?)
    `).run(
      draft.professor_email,
      draft.subject,
      draft.subject?.match(/\[(.+?)\]/)?.[1] || '',
      result?.id || null,
      draft.batch_id,
      draft.id
    );
    ArchiveService.recordOutreach({
      professor_email: draft.professor_email,
      last_name: draft.last_name,
      mode: draft.batch_mode || 'scheduled',
      status: nextStatus,
      subject: draft.subject,
      message_id: result?.id,
      batch_id: draft.batch_id,
      draft_id: draft.id,
      agent_summary: `User sent draft #${draft.id} manually`,
    });
    eventBus.publish({
      type: nextStatus === 'resent' ? 'scheduled_draft_resent' : 'scheduled_draft_sent',
      mode: 'scheduled',
      batchId: draft.batch_id,
      draftId: draft.id,
      professor: draft.professor_email,
      subject: draft.subject,
      manual: true,
    });
    res.json({ success: true, status: nextStatus, draftId: draft.id, message: nextStatus === 'resent' ? 'Draft resent' : 'Draft sent' });
  } catch (e) {
    const detail = e?.errors?.[0]?.message || e?.response?.data?.error?.message || e?.message || 'Send failed';
    const reason = e?.errors?.[0]?.reason || e?.response?.data?.error?.status || e?.code || e?.status || 'unknown';
    if (isSendLimitError(e)) {
      eventBus.publish({ type: 'scheduled_send_limit_reached', mode: 'scheduled', error: e.message });
      cancelScheduledWork();
      stopScheduler();
    }
    const failedDraft = db.prepare(`
      SELECT d.*, sp.email as professor_email
      FROM scheduled_drafts d
      JOIN scheduled_professors sp ON sp.id=d.professor_id
      WHERE d.id=?
    `).get(req.params.id);
    if (failedDraft) {
      db.prepare("UPDATE scheduled_drafts SET status='failed', error=? WHERE id=?").run(detail, failedDraft.id);
      recordDeliveryFailure({
        professor_email: failedDraft.professor_email,
        failure_type: isSendLimitError(e) ? 'send_limit' : 'delivery_failed',
        reason: detail,
        source: 'gmail_api',
        mode: 'scheduled',
        batch_id: failedDraft.batch_id,
        draft_id: failedDraft.id,
      });
    }
    console.error(`[Scheduled] Manual send failed for draft #${req.params.id}: ${detail} (${reason})`);
    res.status(500).json({ error: e.message || 'Send failed' });
  }
});

// Approve a single draft
router.post('/draft/:id/approve', (req, res) => {
  db.prepare("UPDATE scheduled_drafts SET status='approved' WHERE id=? AND status='draft'").run(req.params.id);

  // Check if all drafts in the batch are now approved — transition batch to 'scheduled'
  const draft = db.prepare('SELECT batch_id FROM scheduled_drafts WHERE id=?').get(req.params.id);
  if (draft) {
    const remainingDrafts = db.prepare(
      "SELECT COUNT(*) as count FROM scheduled_drafts WHERE batch_id=? AND status='draft'"
    ).get(draft.batch_id).count;
    if (remainingDrafts === 0) {
      db.prepare("UPDATE scheduled_batches SET status='scheduled' WHERE id=? AND status='drafted'").run(draft.batch_id);
      eventBus.publish({ type: 'scheduled_batch_approved', mode: 'scheduled', batchId: draft.batch_id });
    }
  }

  res.json({ success: true });
});

// Approve all drafts in a batch (also transitions batch to 'scheduled')
router.post('/batch/:id/approve-all', (req, res) => {
  db.prepare("UPDATE scheduled_drafts SET status='approved' WHERE batch_id=? AND status='draft'").run(req.params.id);
  db.prepare("UPDATE scheduled_batches SET status='scheduled' WHERE id=? AND status IN ('drafted','processing')").run(req.params.id);
  const verification = verifyScheduledBatchBeforeSend(parseInt(req.params.id, 10));
  eventBus.publish({
    type: 'scheduled_batch_approved',
    mode: 'scheduled',
    batchId: parseInt(req.params.id, 10),
    verification,
    agentContext: getScheduledBatchAgentContext(parseInt(req.params.id, 10)),
  });
  res.json({ success: true, verification });
});

// Approve drafts matching a subject pattern (e.g. all Basic drafts with same subject)
router.post('/batch/:id/approve-similar', (req, res) => {
  const batchId = parseInt(req.params.id, 10);
  const { subject_pattern, draft_id } = req.body;
  let pattern = subject_pattern;
  if (!pattern && draft_id) {
    const d = db.prepare('SELECT subject FROM scheduled_drafts WHERE id=? AND batch_id=?').get(draft_id, batchId);
    pattern = d?.subject?.replace(/\[[^\]]+\]/, '[*]') || d?.subject;
  }
  if (!pattern) return res.status(400).json({ error: 'subject_pattern or draft_id required' });

  const like = pattern.replace(/\*/g, '%');
  const updated = db.prepare(`
    UPDATE scheduled_drafts SET status='approved'
    WHERE batch_id=? AND status='draft' AND subject LIKE ?
  `).run(batchId, like).changes;

  res.json({ success: true, approved: updated, pattern: like });
});

router.get('/suggest-time', (req, res) => {
  const countries = req.query.countries ? String(req.query.countries).split(',') : [];
  res.json(suggestScheduledAt(countries));
});

// Pre-send / post-approve verification for a batch
router.get('/batch/:id/verify', (req, res) => {
  const batchId = parseInt(req.params.id, 10);
  const verification = verifyScheduledBatchBeforeSend(batchId);
  res.json({
    ...verification,
    agentContext: getScheduledBatchAgentContext(batchId),
  });
});

// Per-batch agent context (time awareness + mode rules)
router.get('/batch/:id/agent-context', (req, res) => {
  const ctx = getScheduledBatchAgentContext(parseInt(req.params.id, 10));
  if (!ctx) return res.status(404).json({ error: 'Batch not found' });
  res.json(ctx);
});

// Toggle auto_approve on a batch
router.put('/batch/:id/auto-approve', (req, res) => {
  const { auto_approve } = req.body;
  if (auto_approve === undefined) return res.status(400).json({ error: 'auto_approve value required' });
  db.prepare('UPDATE scheduled_batches SET auto_approve=? WHERE id=?').run(auto_approve ? 1 : 0, req.params.id);
  res.json({ success: true, auto_approve: auto_approve ? 1 : 0 });
});

// Cancel a batch (soft delete — sets status to cancelled)
router.delete('/batch/:id', (req, res) => {
  db.prepare("UPDATE scheduled_batches SET status='cancelled' WHERE id=?").run(req.params.id);
  db.prepare("UPDATE scheduled_drafts SET status='cancelled' WHERE batch_id=? AND status IN ('draft','approved')").run(req.params.id);
  eventBus.publish({ type: 'scheduled_batch_cancelled', mode: 'scheduled', batchId: parseInt(req.params.id) });
  res.json({ success: true });
});

// Resend a completed batch immediately — clones drafts into a new batch and sends
router.post('/batch/:id/resend', requireGmailValidated, async (req, res) => {
  try {
    const oldBatchId = parseInt(req.params.id);
    const oldBatch = db.prepare('SELECT * FROM scheduled_batches WHERE id=?').get(oldBatchId);
    if (!oldBatch) return res.status(404).json({ error: 'Batch not found' });
    if (oldBatch.status !== 'completed') return res.status(400).json({ error: 'Only completed batches can be resent' });

    const oldDrafts = db.prepare(`
      SELECT d.*, sp.email as professor_email, sp.last_name, sp.university, sp.research_areas, sp.id as prof_id
      FROM scheduled_drafts d
      JOIN scheduled_professors sp ON d.professor_id = sp.id
      WHERE d.batch_id = ?
    `).all(oldBatchId);

    if (!oldDrafts.length) return res.status(400).json({ error: 'No drafts to resend' });

    const newBatchId = nextScheduledBatchId();
    db.prepare(
      'INSERT INTO scheduled_batches (id, scheduled_at, status, source_url, auto_approve, source_emails, max_professors, total, batch_mode, skip_duplicates) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(newBatchId, new Date().toISOString(), 'sending', oldBatch.source_url || null, 1, oldBatch.source_emails, oldBatch.max_professors, oldDrafts.length, oldBatch.batch_mode || 'scheduled', 0);

    for (const d of oldDrafts) {
      db.prepare(
        'INSERT OR IGNORE INTO scheduled_professors (email, last_name, university, research_areas, dossier, source_url, batch_id) VALUES (?,?,?,?,?,?,?)'
      ).run(d.professor_email, d.last_name, d.university, d.research_areas, null, oldBatch.source_url || '', newBatchId);
      const newProf = db.prepare('SELECT id FROM scheduled_professors WHERE email=? AND batch_id=?').get(d.professor_email, newBatchId);

      db.prepare(`
        INSERT INTO scheduled_drafts (batch_id, professor_id, subject, interest_line, html_preview, custom_html, status)
        VALUES (?,?,?,?,?,?,?)
      `).run(newBatchId, newProf.id, d.subject, d.interest_line, d.html_preview, d.custom_html, 'approved');
    }

    eventBus.publish({ type: 'scheduled_batch_sending', mode: 'scheduled', batchId: newBatchId });

    for (const d of oldDrafts) {
      ArchiveService.recordOutreach({
        professor_email: d.professor_email,
        last_name: d.last_name,
        mode: oldBatch.batch_mode || 'scheduled',
        status: 'resent',
        subject: d.subject,
        batch_id: newBatchId,
        draft_id: d.id,
        agent_summary: `User resent completed batch #${oldBatchId} → new batch #${newBatchId}`,
      });
    }

    const { sendScheduledBatch } = await import('../pipeline/scheduler.js');
    sendScheduledBatch(newBatchId).catch(e => console.error('[Scheduler] Resend failed:', e.message));

    res.json({ success: true, batchId: newBatchId, draftCount: oldDrafts.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Resend only drafts that were not already sent in the same batch.
router.post('/batch/:id/resend-remaining', requireGmailValidated, async (req, res) => {
  try {
    const batchId = parseInt(req.params.id, 10);
    const batch = db.prepare('SELECT * FROM scheduled_batches WHERE id=?').get(batchId);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    clearScheduledAbort();

    db.prepare(`
      UPDATE scheduled_drafts
      SET status='approved', error=NULL
      WHERE batch_id=? AND status NOT IN ('sent', 'cancelled')
    `).run(batchId);

    const remainingDrafts = db.prepare(`
      SELECT d.*, sp.email as professor_email, sp.last_name, sp.id as prof_id
      FROM scheduled_drafts d
      JOIN scheduled_professors sp ON d.professor_id = sp.id
      WHERE d.batch_id = ? AND d.status = 'approved'
      ORDER BY d.id
    `).all(batchId);

    if (!remainingDrafts.length) {
      return res.json({ success: true, batchId, draftCount: 0, message: 'No unsent drafts remaining' });
    }

    db.prepare("UPDATE scheduled_batches SET status='scheduled' WHERE id=? AND status!='completed'").run(batchId);

    sendScheduledBatch(batchId, remainingDrafts).catch(e => console.error('[Scheduler] Resend remaining failed:', e.message));

    res.json({ success: true, batchId, draftCount: remainingDrafts.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Reschedule & resend a completed batch — clones drafts into a new batch with a new scheduled_at
router.post('/batch/:id/reschedule-resend', async (req, res) => {
  try {
    const { scheduled_at } = req.body;
    if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at required' });

    const oldBatchId = parseInt(req.params.id);
    const oldBatch = db.prepare('SELECT * FROM scheduled_batches WHERE id=?').get(oldBatchId);
    if (!oldBatch) return res.status(404).json({ error: 'Batch not found' });
    if (oldBatch.status !== 'completed') return res.status(400).json({ error: 'Only completed batches can be resent' });

    const oldDrafts = db.prepare(`
      SELECT d.*, sp.email as professor_email, sp.last_name, sp.university, sp.research_areas, sp.id as prof_id
      FROM scheduled_drafts d
      JOIN scheduled_professors sp ON d.professor_id = sp.id
      WHERE d.batch_id = ?
    `).all(oldBatchId);

    if (!oldDrafts.length) return res.status(400).json({ error: 'No drafts to resend' });

    const newBatchId = nextScheduledBatchId();
    db.prepare(
      'INSERT INTO scheduled_batches (id, scheduled_at, status, source_url, auto_approve, source_emails, max_professors, total, batch_mode, skip_duplicates) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(newBatchId, scheduled_at, 'scheduled', oldBatch.source_url || null, 1, oldBatch.source_emails, oldBatch.max_professors, oldDrafts.length, oldBatch.batch_mode || 'scheduled', 0);

    for (const d of oldDrafts) {
      db.prepare(
        'INSERT OR IGNORE INTO scheduled_professors (email, last_name, university, research_areas, dossier, source_url, batch_id) VALUES (?,?,?,?,?,?,?)'
      ).run(d.professor_email, d.last_name, d.university, d.research_areas, null, oldBatch.source_url || '', newBatchId);
      const newProf = db.prepare('SELECT id FROM scheduled_professors WHERE email=? AND batch_id=?').get(d.professor_email, newBatchId);

      db.prepare(`
        INSERT INTO scheduled_drafts (batch_id, professor_id, subject, interest_line, html_preview, custom_html, status)
        VALUES (?,?,?,?,?,?,?)
      `).run(newBatchId, newProf.id, d.subject, d.interest_line, d.html_preview, d.custom_html, 'approved');
    }

    eventBus.publish({ type: 'scheduled_batch_approved', mode: 'scheduled', batchId: newBatchId });

    res.json({ success: true, batchId: newBatchId, draftCount: oldDrafts.length, scheduled_at });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Hard delete a batch — removes batch, drafts, professors, sent_log entries from DB
router.delete('/batch/:id/purge', (req, res) => {
  const batchId = parseInt(req.params.id);
  const drafts = db.prepare('SELECT id FROM scheduled_drafts WHERE batch_id=?').all(batchId);
  const profIds = drafts.map(d => d.professor_id).filter(Boolean);

  db.prepare('DELETE FROM scheduled_drafts WHERE batch_id=?').run(batchId);
  db.prepare('DELETE FROM scheduled_sent_log WHERE batch_id=?').run(batchId);
  if (profIds.length) {
    db.prepare(`DELETE FROM scheduled_professors WHERE id IN (${profIds.join(',')})`).run();
  }
  db.prepare('DELETE FROM scheduled_batches WHERE id=?').run(batchId);
  clearRosterExcel();
  eventBus.publish({ type: 'scheduled_batch_deleted', mode: 'scheduled', batchId });
  res.json({ success: true });
});

// Send a batch immediately (ignores scheduled_at)
router.post('/batch/:id/send-now', requireGmailValidated, async (req, res) => {
  const batch = db.prepare('SELECT * FROM scheduled_batches WHERE id=?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (batch.status === 'cancelled') return res.status(400).json({ error: 'Batch cancelled' });
  clearScheduledAbort();

  const unsentCount = db.prepare(`
    SELECT COUNT(*) as count
    FROM scheduled_drafts
    WHERE batch_id=? AND status NOT IN ('sent', 'cancelled')
  `).get(req.params.id).count;
  if (batch.status === 'completed' && unsentCount === 0) return res.status(400).json({ error: 'Already completed' });

  // Send Now means: send every row that is not already sent/cancelled, including approved and failed.
  db.prepare(`
    UPDATE scheduled_drafts
    SET status='approved', error=NULL
    WHERE batch_id=? AND status NOT IN ('sent', 'cancelled')
  `).run(req.params.id);

  const verification = verifyScheduledBatchBeforeSend(batch.id);
  if (!verification.ok) {
    return res.status(400).json({
      error: 'Pre-send verification failed — fix drafts before sending',
      verification,
      agentContext: getScheduledBatchAgentContext(batch.id),
    });
  }

  db.prepare("UPDATE scheduled_batches SET status='sending' WHERE id=?").run(req.params.id);
  eventBus.publish({ type: 'scheduled_batch_sending', mode: 'scheduled', batchId: batch.id });

  // Trigger send in background
  const { sendScheduledBatch } = await import('../pipeline/scheduler.js');
  sendScheduledBatch(batch.id).catch(e => console.error('[Scheduler] Send-now failed:', e.message));

  res.json({ success: true });
});

// Delete a single draft
router.delete('/draft/:id', (req, res) => {
  const draft = db.prepare('SELECT * FROM scheduled_drafts WHERE id=?').get(req.params.id);
  if (!draft) return res.status(404).json({ error: 'Draft not found' });
  if (draft.status === 'sent') return res.status(400).json({ error: 'Cannot delete sent draft' });

  db.prepare('DELETE FROM scheduled_drafts WHERE id=?').run(req.params.id);

  // Check remaining drafts in the batch
  const remainingCount = db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts WHERE batch_id=?").get(draft.batch_id).count;
  if (remainingCount === 0) {
    // Keep the batch record; user can decide whether to delete/cancel it.
    db.prepare("UPDATE scheduled_batches SET status='drafted' WHERE id=? AND status!='completed'").run(draft.batch_id);
    eventBus.publish({ type: 'scheduled_batch_updated', mode: 'scheduled', batchId: draft.batch_id, status: 'drafted' });
  } else {
    // Check if remaining drafts are all approved → transition batch
    const remainingDrafts = db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts WHERE batch_id=? AND status='draft'").get(draft.batch_id).count;
    if (remainingDrafts === 0) {
      db.prepare("UPDATE scheduled_batches SET status='scheduled' WHERE id=? AND status='drafted'").run(draft.batch_id);
      eventBus.publish({ type: 'scheduled_batch_approved', mode: 'scheduled', batchId: draft.batch_id });
    }
  }

  res.json({ success: true });
});

// Get scheduled template (normal or basic)
router.get('/template', (req, res) => {
  const mode = req.query.mode === 'basic_scheduled' ? 'basic_scheduled' : 'scheduled';
  const tpl = db.prepare('SELECT * FROM scheduled_template WHERE mode=?').get(mode);
  res.json(tpl || {});
});

// Update scheduled template
router.post('/template/raw', (req, res) => {
  const { raw_html, instructions, sample_subject, mode: bodyMode } = req.body;
  const mode = bodyMode === 'basic_scheduled' ? 'basic_scheduled' : 'scheduled';
  const existing = db.prepare('SELECT id FROM scheduled_template WHERE mode=?').get(mode);
  if (existing) {
    db.prepare(`
      UPDATE scheduled_template SET raw_html=COALESCE(?, raw_html), instructions=COALESCE(?, instructions), sample_subject=COALESCE(?, sample_subject) WHERE mode=?
    `).run(raw_html ?? null, instructions ?? null, sample_subject ?? null, mode);
  } else {
    db.prepare(`
      INSERT INTO scheduled_template (raw_html, instructions, sample_subject, last_name_placeholder, interest_line_placeholder, mode)
      VALUES (?,?,?,?,?,?)
    `).run(raw_html || '', instructions || '', sample_subject || '', '{{LAST_NAME}}', mode === 'basic_scheduled' ? null : '{{INTEREST_LINE}}', mode);
  }
  res.json({ success: true, template: db.prepare('SELECT * FROM scheduled_template WHERE mode=?').get(mode) });
});

// ── Scheduled Roster (global across all batches) ────────────────

function buildScheduledRosterRows() {
  return db.prepare(`
    SELECT sp.id, sp.email, sp.last_name, sp.university, sp.research_areas, sp.dossier, sp.source_url,
      sp.batch_id, b.status as batch_status, b.scheduled_at, b.batch_mode,
      d.id as draft_id, d.status as draft_status, d.subject, d.interest_line, d.error as draft_error
    FROM scheduled_professors sp
    LEFT JOIN scheduled_batches b ON b.id = sp.batch_id
    LEFT JOIN scheduled_drafts d ON d.professor_id = sp.id AND d.batch_id = sp.batch_id
    ORDER BY sp.batch_id, sp.id
  `).all().map(r => {
    let researchInfo = r.research_areas || '';
    let fullName = '';
    let department = '';
    let designation = '';
    let subjectKeyword = '';
    let profileUrl = r.source_url || '';
    try {
      const d = JSON.parse(r.dossier || '{}');
      fullName = d.name || d.roster?.full_name || '';
      department = d.department || d.roster?.department || '';
      designation = d.title || d.roster?.designation || '';
      subjectKeyword = d.subject_keyword || d.roster?.subject_keyword || '';
      profileUrl = d.profile_url || d.roster?.profile_url || profileUrl;
      if (d.profile_research_status === 'none_on_page') researchInfo = researchInfo || 'No info on page';
      else if (d.profile_research_status === 'profile_found') researchInfo = researchInfo || 'From page';
      else if (d.profile_research_status === 'web_complete') researchInfo = researchInfo || 'From web';
    } catch { /* ignore */ }
    const subjectKwFromDraft = (r.subject || '').match(/^\[([^\]]+)\]/)?.[1] || '';
    return {
      ...r,
      full_name: fullName,
      last_name: r.last_name || fullName.split(/\s+/).pop() || '',
      department,
      designation,
      subject_keyword: subjectKeyword || subjectKwFromDraft,
      interest_line: r.interest_line || '',
      queue_state: r.draft_status || r.batch_status || 'pending',
      profile_url: profileUrl,
      research_info: researchInfo,
    };
  });
}

router.get('/roster', (req, res) => {
  const rows = readRosterExcel().map((r, index) => ({
    id: r.id || index + 1,
    batch_id: r.batch_id || '',
    batch_mode: r.batch_mode || 'scheduled',
    batch_status: r.batch_status || 'pending',
    full_name: r.full_name || '',
    email: r.email || '',
    last_name: r.last_name || '',
    university: r.university || '',
    department: r.department || '',
    designation: r.designation || '',
    research_areas: r.research_areas || r.research_interest || '',
    subject_keyword: r.subject_keyword || '',
    draft_status: r.queue_state || 'pending',
    subject: r.subject || '',
    interest_line: r.interest_line || '',
    profile_url: r.profile_url || '',
    research_info: r.research_status || '',
    scheduled_at: r.scheduled_at || '',
    queue_state: r.queue_state || 'pending',
  }));
  res.json(rows);
});

router.get('/roster.csv', (req, res) => {
  const rows = readRosterExcel();
  const headers = ['batch_id', 'batch_mode', 'batch_status', 'full_name', 'email', 'last_name', 'university', 'department', 'designation', 'research_areas', 'subject_keyword', 'draft_status', 'subject', 'interest_line', 'profile_url', 'research_info', 'scheduled_at'];
  const escape = v => { const s = String(v ?? ''); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map(h => escape(r[h])).join(','));
  res.setHeader('Content-Disposition', 'attachment; filename="scheduled-roster.csv"');
  res.setHeader('Content-Type', 'text/csv');
  res.send(lines.join('\n'));
});

router.get('/roster.xlsx', (req, res) => {
  const rows = readRosterExcel();
  const headers = ['batch_id', 'batch_mode', 'batch_status', 'full_name', 'email', 'last_name', 'university', 'department', 'designation', 'research_areas', 'subject_keyword', 'draft_status', 'subject', 'interest_line', 'profile_url', 'research_info', 'scheduled_at'];
  const data = rows.map(r => { const out = {}; for (const h of headers) out[h] = r[h] ?? ''; return out; });
  const ws = XLSX.utils.json_to_sheet(data, { header: headers });
  ws['!cols'] = headers.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Scheduled Roster');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="scheduled-roster.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

export default router;
