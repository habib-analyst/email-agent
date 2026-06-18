import db from '../db/index.js';
import { eventBus } from '../core/EventBus.js';
import { scrapeFacultyPage } from '../research/index.js';
import { enrichProfessorFromScrape } from '../research/profileResearch.js';
import { generateEmail, resetTokenUsage, getTokenUsage } from '../ai/index.js';
import { sendEmail, isSendLimitError } from '../gmail/index.js';
import { withRetry } from './utils.js';
import { formatGreetingLastName, capitalizeWord, lastNameFromEmail, fullNameFromEmail } from '../utils/professor.js';
import { normalizeInterestLineKeywords } from '../utils/interestLine.js';
import { getAITargetingHints } from '../learning/index.js';
import { draftBasicScheduledProfessor } from './scheduledBasic.js';
import { filterDuplicateEmails, recordDuplicateBlocked, findPriorOutreach } from '../db/duplicateCheck.js';
import { ArchiveService } from '../services/ArchiveService.js';
import { isBasicScheduled } from '../config/modes.js';
import { verifyScheduledDraft, verifyScheduledBatchBeforeSend } from './scheduledVerify.js';
import { getScheduledBatchAgentContext } from '../db/scheduledAgentContext.js';
import { AuthService } from '../services/AuthService.js';
import { delay } from './utils.js';
import { buildBasicOutreachSubject, buildOutreachSubject, getBasicSubjectMode } from '../gmail/basicTemplate.js';
import { buildDossierFromPastedProfessor, professorsFromRawImportInput } from '../utils/pasteImportParser.js';

let schedulerRunning = false;
let schedulerInterval = null;
let healInterval = null;
const processingQueue = [];  // Batch IDs waiting to be processed sequentially
let currentlyProcessing = null;  // Batch ID currently being processed
let abortRequested = false;

/** Stop in-flight scheduled batch work (drafting + sending). Called from agent/stop. */
export function cancelScheduledWork() {
  abortRequested = true;
  processingQueue.length = 0;
  currentlyProcessing = null;
  db.prepare("UPDATE scheduled_batches SET status='drafted' WHERE status IN ('processing','sending')").run();
}

export function clearScheduledAbort() {
  abortRequested = false;
}

function shouldAbort() {
  return abortRequested;
}

export function enqueueBatch(batchId) {
  if (!processingQueue.includes(batchId) && currentlyProcessing !== batchId) {
    processingQueue.push(batchId);
    console.log(`[Scheduler] Batch #${batchId} queued (position ${processingQueue.length})`);
  }
  if (currentlyProcessing === null) processNextInQueue();
}

function processNextInQueue() {
  if (processingQueue.length === 0) { currentlyProcessing = null; return; }
  const batchId = processingQueue.shift();
  currentlyProcessing = batchId;
  db.prepare("UPDATE scheduled_batches SET status='processing' WHERE id=? AND status IN ('pending')").run(batchId);
  eventBus.publish({ type: 'scheduled_batch_processing_started', mode: 'scheduled', batchId });
  console.log(`[Scheduler] Processing batch #${batchId} from queue`);
  startScheduledBatchProcessing(batchId);
}

function advanceQueue() {
  currentlyProcessing = null;
  processNextInQueue();
}

// ── Heal stuck scheduled batches: reset processing >30min back to pending ──
const HEAL_THRESHOLD_MIN = 30;
const HEAL_MAX_COUNT = 3;

function healStuckScheduledBatches() {
  const stuck = db.prepare(`
    SELECT id, heal_count FROM scheduled_batches
    WHERE status = 'processing'
      AND created_at < datetime('now', '-${HEAL_THRESHOLD_MIN} minutes')
  `).all();

  for (const batch of stuck) {
    const healCount = (batch.heal_count || 0) + 1;
    if (healCount >= HEAL_MAX_COUNT) {
      console.log(`[Scheduler] Batch #${batch.id} exceeded ${HEAL_MAX_COUNT} heals — marking failed`);
      db.prepare("UPDATE scheduled_batches SET status='failed', heal_count=? WHERE id=?").run(healCount, batch.id);
      eventBus.publish({ type: 'scheduled_batch_error', mode: 'scheduled', batchId: batch.id, error: `Stuck batch failed after ${HEAL_MAX_COUNT} heal attempts` });
      // Remove from queue if present
      const idx = processingQueue.indexOf(batch.id);
      if (idx >= 0) processingQueue.splice(idx, 1);
      if (currentlyProcessing === batch.id) currentlyProcessing = null;
    } else {
      console.log(`[Scheduler] Healing stuck batch #${batch.id} (heal #${healCount}, stuck >${HEAL_THRESHOLD_MIN}min)`);
      db.prepare("UPDATE scheduled_batches SET status='pending', heal_count=? WHERE id=?").run(healCount, batch.id);
      eventBus.publish({ type: 'scheduled_batch_healed', mode: 'scheduled', batchId: batch.id, healCount });
      // Re-enqueue for processing
      if (!processingQueue.includes(batch.id)) enqueueBatch(batch.id);
    }
  }
}

export function startScheduler() {
  if (schedulerInterval) return;
  resetTokenUsage();  // Reset token counters on start — fresh quota each restart
  resumeCrashedBatches();
  // Re-queue any existing pending/processing batches
  const pending = db.prepare("SELECT id FROM scheduled_batches WHERE status IN ('pending','processing') ORDER BY id").all();
  for (const b of pending) {
    if (!processingQueue.includes(b.id)) processingQueue.push(b.id);
  }
  if (currentlyProcessing === null) processNextInQueue();
  schedulerInterval = setInterval(checkScheduledBatches, 5000);
  healInterval = setInterval(healStuckScheduledBatches, 60000);  // Check every 60s
  console.log('[Scheduler] Started - sequential processing, 5s send polling, 60s heal check');
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  if (healInterval) {
    clearInterval(healInterval);
    healInterval = null;
  }
}

// ── Crash recovery: resume batches stuck in 'sending' state ──
function resumeCrashedBatches() {
  const crashed = db.prepare(
    "SELECT * FROM scheduled_batches WHERE status = 'sending'"
  ).all();

  for (const batch of crashed) {
    console.log(`[Scheduler] Resuming crashed batch #${batch.id} (sending state)`);
    // Cross-reference sent_log to find already-sent drafts
    const alreadySent = db.prepare(
      "SELECT draft_id FROM scheduled_sent_log WHERE batch_id = ?"
    ).all(batch.id).map(r => r.draft_id);

    // Find drafts that were approved but not yet sent (not in sent_log)
    const remaining = db.prepare(`
      SELECT d.*, sp.email as professor_email, sp.last_name, sp.id as prof_id
      FROM scheduled_drafts d
      JOIN scheduled_professors sp ON d.professor_id = sp.id
      WHERE d.batch_id = ? AND d.status = 'approved'
        AND d.id NOT IN (${alreadySent.length ? alreadySent.join(',') : '0'})
      ORDER BY d.id
    `).all(batch.id);

    if (remaining.length === 0) {
      // All drafts already sent — mark batch as completed
      const sentCount = alreadySent.length;
      db.prepare("UPDATE scheduled_batches SET status='completed', sent=? WHERE id=?").run(sentCount, batch.id);
      console.log(`[Scheduler] Crashed batch #${batch.id} already fully sent — marking completed`);
      eventBus.publish({ type: 'scheduled_batch_complete', mode: 'scheduled', batchId: batch.id, sent: sentCount, total: batch.total });
    } else {
      // Resume sending remaining drafts
      console.log(`[Scheduler] Crashed batch #${batch.id}: ${alreadySent.length} already sent, ${remaining.length} remaining`);
      sendScheduledBatch(batch.id, remaining).catch(e => {
        console.error(`[Scheduler] Resume failed for batch #${batch.id}:`, e.message);
      });
    }
  }
}

// ── Check for due batches (find ALL, not just oldest) ──
async function checkScheduledBatches() {
  const readySoon = db.prepare(`
    SELECT * FROM scheduled_batches
    WHERE status IN ('scheduled','pending','drafted')
      AND scheduled_at > datetime('now')
      AND scheduled_at <= datetime('now', '+10 seconds')
      AND ready_notice_sent_at IS NULL
    ORDER BY scheduled_at, id
  `).all();

  for (const batch of readySoon) {
    db.prepare("UPDATE scheduled_batches SET ready_notice_sent_at=datetime('now') WHERE id=?").run(batch.id);
    eventBus.publish({
      type: 'scheduled_batch_ready_soon',
      mode: 'scheduled',
      batchId: batch.id,
      scheduledAt: batch.scheduled_at,
      label: `Batch #${batch.id} is ready and will run at its scheduled time`,
    });
  }

  const due = db.prepare(`
    SELECT * FROM scheduled_batches
    WHERE status IN ('scheduled','pending') AND auto_approve=1
      AND scheduled_at <= datetime('now')
      AND COALESCE(send_attempts, 0) < 5
    ORDER BY scheduled_at, id
  `).all();

  const manualDue = db.prepare(`
    SELECT * FROM scheduled_batches
    WHERE status='drafted' AND auto_approve=0 AND scheduled_at <= datetime('now')
      AND manual_due_notified_at IS NULL
    ORDER BY scheduled_at
  `).all();

  for (const batch of manualDue) {
    db.prepare("UPDATE scheduled_batches SET manual_due_notified_at=datetime('now') WHERE id=?").run(batch.id);
    eventBus.publish({
      type: 'scheduled_batch_manual_due',
      mode: 'scheduled',
      batchId: batch.id,
      scheduledAt: batch.scheduled_at,
      label: `Batch #${batch.id} is ready to review and send`,
    });
  }

  if (!due.length) return;

  // Send all due batches concurrently
  console.log(`[Scheduler] Found ${due.length} due batch(es) — sending sequentially`);
  for (const batch of due) {
    console.log(`[Scheduler] Batch #${batch.id} is due — sending`);
    // Send one batch at a time to preserve ordering and avoid overlap.
    // eslint-disable-next-line no-await-in-loop
    db.prepare("UPDATE scheduled_batches SET send_attempts=COALESCE(send_attempts,0)+1 WHERE id=?").run(batch.id);
    const outcome = await sendScheduledBatch(batch.id);
    if (outcome?.retry) {
      const attempts = db.prepare('SELECT COALESCE(send_attempts,0) as attempts FROM scheduled_batches WHERE id=?').get(batch.id)?.attempts || 0;
      if (attempts >= 5) {
        db.prepare("UPDATE scheduled_batches SET status='failed' WHERE id=?").run(batch.id);
        eventBus.publish({
          type: 'scheduled_batch_error',
          mode: 'scheduled',
          batchId: batch.id,
          error: `Batch stopped after ${attempts} failed send attempts`,
        });
      } else {
        db.prepare("UPDATE scheduled_drafts SET status='approved' WHERE batch_id=? AND status='failed'").run(batch.id);
        db.prepare(`
          UPDATE scheduled_batches
          SET status='scheduled', scheduled_at=datetime('now', '+30 seconds'), ready_notice_sent_at=NULL
          WHERE id=?
        `).run(batch.id);
        eventBus.publish({
          type: 'scheduled_batch_retry_scheduled',
          mode: 'scheduled',
          batchId: batch.id,
          attempts,
          retryInSeconds: 30,
          label: `Batch #${batch.id} will retry in 30 seconds`,
        });
      }
    }
  }
}

// ── Send all approved drafts in a batch via Gmail ──
export async function sendScheduledBatch(batchId, preloadedDrafts = null) {
  if (!AuthService.isConnected()) {
    console.error('[Scheduler] Gmail not connected — cannot send batch');
    eventBus.publish({ type: 'scheduled_batch_error', mode: 'scheduled', batchId, error: 'Gmail not connected' });
    return { retry: true, reason: 'gmail_not_connected' };
  }

  db.prepare("UPDATE scheduled_batches SET status='sending' WHERE id=?").run(batchId);
  eventBus.publish({ type: 'scheduled_batch_sending', mode: 'scheduled', batchId });

  const drafts = preloadedDrafts || db.prepare(`
    SELECT d.*, sp.email as professor_email, sp.last_name, sp.id as prof_id
    FROM scheduled_drafts d
    JOIN scheduled_professors sp ON d.professor_id = sp.id
    WHERE d.batch_id = ? AND d.status = 'approved'
    ORDER BY d.id
  `).all(batchId);

  const batchRow = db.prepare('SELECT batch_mode, scheduled_at, stagger_send_min FROM scheduled_batches WHERE id=?').get(batchId);
  const isBasicBatch = batchRow?.batch_mode === 'basic_scheduled';
  const basicSettings = db.prepare('SELECT basic_subject_keyword, basic_search_subject_keyword FROM settings WHERE id=1').get() || {};
  const subjectMode = isBasicBatch ? getBasicSubjectMode(basicSettings) : 'fixed';
  const staggerMin = Number(batchRow?.stagger_send_min) || Number(db.prepare('SELECT stagger_send_min FROM settings WHERE id=1').get()?.stagger_send_min) || 0;

  const preSend = verifyScheduledBatchBeforeSend(batchId);
  if (!preSend.ok) {
    const msg = preSend.draftFailures?.length
      ? `Pre-send verification failed: ${preSend.draftFailures.map(f => `${f.email}: ${f.errors.join('; ')}`).join(' | ')}`
      : (preSend.errors?.join('; ') || 'Pre-send verification failed');
    console.error(`[Scheduler] Batch #${batchId} blocked: ${msg}`);
    db.prepare("UPDATE scheduled_batches SET status='drafted' WHERE id=?").run(batchId);
    eventBus.publish({
      type: 'scheduled_batch_error',
      mode: 'scheduled',
      batchId,
      error: msg,
      verification: preSend,
      agentContext: getScheduledBatchAgentContext(batchId),
    });
    return { retry: false, blocked: true };
  }

  eventBus.publish({
    type: 'scheduled_batch_verified',
    mode: 'scheduled',
    batchId,
    scheduledAt: batchRow?.scheduled_at,
    agentContext: getScheduledBatchAgentContext(batchId),
  });

  let sentCount = 0;
  let failedCount = 0;
  const BATCH_SIZE = 1;

  for (let b = 0; b < drafts.length; b += BATCH_SIZE) {
    if (shouldAbort()) {
      db.prepare("UPDATE scheduled_batches SET status='scheduled' WHERE id=?").run(batchId);
      console.log(`[Scheduler] Batch #${batchId} send aborted by user`);
      return { retry: false, aborted: true };
    }
    const chunk = drafts.slice(b, b + BATCH_SIZE);

    const results = await Promise.allSettled(
      chunk.map(async draft => {
        try {
          const result = await withRetry(() => sendEmail({
            professor_id: draft.prof_id,
            subject: draft.subject,
            interest_line: draft.interest_line,
            custom_html: draft.custom_html || draft.html_preview || null,
            mode: 'scheduled',
            batch_id: batchId,
            draft_id: draft.id,
            stripInterestLine: isBasicBatch,
            scheduledTemplateMode: isBasicBatch ? 'basic_scheduled' : 'scheduled',
            useSubjectKeyword: subjectMode !== 'fixed',
          }));
          return { draft, success: true, result };
        } catch (e) {
          return { draft, success: false, error: e.message };
        }
      })
    );

    for (const r of results) {
      const val = r.status === 'fulfilled' ? r.value : null;
      if (!val) continue;

      if (val.success) {
        db.prepare("UPDATE scheduled_drafts SET status='sent' WHERE id=?").run(val.draft.id);
        db.prepare(`
          INSERT INTO scheduled_sent_log (professor_email, subject, topic, message_id, sent_at, batch_id, draft_id)
          VALUES (?,?,?,?,datetime('now'),?,?)
        `).run(
          val.draft.professor_email,
          val.draft.subject,
          val.draft.subject?.match(/\[(.+?)\]/)?.[1] || '',
          val.result.id || null,
          batchId,
          val.draft.id
        );

        sentCount++;
        eventBus.publish({
          type: 'scheduled_draft_sent',
          mode: 'scheduled',
          batchId,
          draftId: val.draft.id,
          professor: val.draft.professor_email,
          subject: val.draft.subject,
        });
        ArchiveService.recordOutreach({
          professor_email: val.draft.professor_email,
          last_name: val.draft.last_name,
          mode: isBasicBatch ? 'basic_scheduled' : 'scheduled',
          status: 'sent',
          subject: val.draft.subject,
          message_id: val.result?.id,
          batch_id: batchId,
          draft_id: val.draft.id,
          agent_summary: `Scheduled batch #${batchId} sent via Gmail`,
        });
      } else {
        failedCount++;
        db.prepare("UPDATE scheduled_drafts SET status='failed', error=? WHERE id=?").run(val.error, val.draft.id);
        ArchiveService.recordOutreach({
          professor_email: val.draft.professor_email,
          last_name: val.draft.last_name,
          mode: isBasicBatch ? 'basic_scheduled' : 'scheduled',
          status: 'failed',
          subject: val.draft.subject,
          error: val.error,
          batch_id: batchId,
          draft_id: val.draft.id,
          agent_summary: `Send failed: ${val.error}`,
        });
        eventBus.publish({ type: 'scheduled_draft_failed', mode: 'scheduled', batchId, draftId: val.draft.id, error: val.error });
        if (isSendLimitError({ message: val.error })) {
          eventBus.publish({ type: 'scheduled_send_limit_reached', mode: 'scheduled', batchId, draftId: val.draft.id, error: val.error });
          cancelScheduledWork();
          stopScheduler();
          db.prepare(`
            UPDATE scheduled_batches
            SET status='scheduled', scheduled_at=datetime('now', '+30 minutes'), ready_notice_sent_at=NULL
            WHERE id=?
          `).run(batchId);
          console.error(`[Scheduler] Send limit reached in batch #${batchId} — stopping scheduled work`);
          return { retry: false, limit: true };
        }
      }
    }

    if (staggerMin > 0 && b + BATCH_SIZE < drafts.length) {
      await delay(staggerMin * 60 * 1000);
    }
  }

  if (drafts.length > 0 && sentCount === 0 && failedCount === drafts.length) {
    return { retry: true, reason: 'all_sends_failed' };
  }

  db.prepare("UPDATE scheduled_batches SET status='completed', sent=? WHERE id=?").run(sentCount, batchId);
  eventBus.publish({ type: 'scheduled_batch_complete', mode: 'scheduled', batchId, sent: sentCount, total: drafts.length, label: `Scheduled batch #${batchId} complete` });
  eventBus.publish({ type: 'batch_complete', mode: 'scheduled', batchId, sent: sentCount, total: drafts.length, label: `Scheduled batch #${batchId} complete` });
  console.log(`[Scheduler] Batch #${batchId} complete: ${sentCount}/${drafts.length} sent`);
  return { retry: false, sent: sentCount, failed: failedCount };
}

// ── Background processing: scrape/import → research → generate drafts ──
export async function startScheduledBatchProcessing(batchId, { url, emails, max_professors, batch_mode } = {}) {
  const batchRow = db.prepare('SELECT source_url, source_emails, max_professors, batch_mode, skip_designations FROM scheduled_batches WHERE id=?').get(batchId);
  if (!url && !emails) {
    url = batchRow?.source_url || null;
    emails = batchRow?.source_emails ? JSON.parse(batchRow.source_emails) : null;
    max_professors = batchRow?.max_professors || null;
    batch_mode = batchRow?.batch_mode || 'scheduled';
  }

  const batchMode = batch_mode || db.prepare('SELECT batch_mode FROM scheduled_batches WHERE id=?').get(batchId)?.batch_mode || 'scheduled';
  const isBasic = isBasicScheduled(batchMode);
  const basicSettings = db.prepare('SELECT basic_subject_keyword, basic_search_subject_keyword FROM settings WHERE id=1').get() || {};
  const subjectMode = isBasic ? getBasicSubjectMode(basicSettings) : 'fixed';
  const batchSchedule = db.prepare('SELECT scheduled_at, target_countries FROM scheduled_batches WHERE id=?').get(batchId);

  try {
    db.prepare("UPDATE scheduled_batches SET status='processing' WHERE id=?").run(batchId);
    eventBus.publish({
      type: 'scheduled_batch_progress',
      mode: batchMode,
      batchId,
      phase: 'processing',
      scheduledAt: batchSchedule?.scheduled_at,
      agentContext: getScheduledBatchAgentContext(batchId),
    });

      let professors = [];

      if (shouldAbort()) {
        db.prepare("UPDATE scheduled_batches SET status='drafted' WHERE id=?").run(batchId);
        advanceQueue();
        return;
      }

      if (url) {
        let skipDesignations = [];
        try { skipDesignations = JSON.parse(batchRow?.skip_designations || '[]'); } catch { skipDesignations = []; }
        eventBus.publish({ type: 'scheduled_batch_progress', mode: 'scheduled', batchId, phase: 'scraping', label: 'Scraping faculty page…' });
        professors = await scrapeFacultyPage(url, {
          skipDesignations,
          onProgress: (p) => {
            eventBus.publish({ type: 'scheduled_batch_progress', mode: 'scheduled', batchId, phase: 'scraping', ...p });
          },
        });
      } else if (emails) {
        professors = professorsFromRawImportInput(emails);
      }

      // Apply max_professors limit
      if (max_professors && professors.length > max_professors) {
        console.log(`[Scheduler] Batch #${batchId}: Limiting ${professors.length} professors to ${max_professors}`);
        professors = professors.slice(0, max_professors);
      }

      // Deduplicate unless batch allows all (skip_duplicates=0)
      const batchDedup = db.prepare('SELECT skip_duplicates FROM scheduled_batches WHERE id=?').get(batchId);
      const skipDup = batchDedup?.skip_duplicates !== 0;
      const beforeDedup = professors.length;
      if (skipDup) {
        professors = professors.filter(p => {
          const prior = findPriorOutreach(p.email);
          if (prior) {
            recordDuplicateBlocked(p.email, prior, { mode: batchMode, batch_id: batchId });
            return false;
          }
          return true;
        });
      }
      if (beforeDedup !== professors.length) {
        console.log(`[Scheduler] Batch #${batchId}: Deduped ${beforeDedup - professors.length} already-sent professors`);
      }

      if (!professors.length) {
        db.prepare("UPDATE scheduled_batches SET status='failed' WHERE id=?").run(batchId);
        eventBus.publish({ type: 'scheduled_batch_error', mode: 'scheduled', batchId, error: 'No professors found' });
        return;
      }

      db.prepare('UPDATE scheduled_batches SET total=? WHERE id=?').run(professors.length, batchId);
      eventBus.publish({ type: 'scheduled_batch_progress', mode: 'scheduled', batchId, phase: 'researching', total: professors.length, current: 0, tokens: getTokenUsage().output });

      // Load template for batch mode
      const tpl = db.prepare("SELECT raw_html, instructions, sample_subject FROM scheduled_template WHERE mode=?").get(isBasic ? 'basic_scheduled' : 'scheduled');

      if (!tpl?.raw_html) {
        console.error(`[Scheduler] Batch ${batchId} failed: No template configured`);
        db.prepare("UPDATE scheduled_batches SET status='failed' WHERE id=?").run(batchId);
        return;
      }

      const hasLastName = tpl.raw_html.includes('{{LAST_NAME}}');
      const hasInterestLine = tpl.raw_html.includes('{{INTEREST_LINE}}');

      if (!hasLastName) {
        console.error(`[Scheduler] Batch ${batchId} failed: Template missing {{LAST_NAME}}`);
        db.prepare("UPDATE scheduled_batches SET status='failed' WHERE id=?").run(batchId);
        return;
      }

      if (!isBasic && !hasInterestLine) {
        console.error(`[Scheduler] Batch ${batchId} failed: Template missing {{INTEREST_LINE}}`);
        db.prepare("UPDATE scheduled_batches SET status='failed' WHERE id=?").run(batchId);
        return;
      }

      if (isBasic && hasInterestLine) {
        console.error(`[Scheduler] Batch ${batchId} failed: Basic template must not have interest line`);
        db.prepare("UPDATE scheduled_batches SET status='failed' WHERE id=?").run(batchId);
        return;
      }

      const targetingHints = getAITargetingHints()?.summary || '';

      const BATCH_SIZE = 10;
      let successfulDrafts = 0;

      const buildDraftFromRosterRow = (p, prof) => {
        const dossier = buildDossierFromPastedProfessor(p, batchMode);
        const lastName = formatGreetingLastName(dossier.last_name || p.last_name || prof.last_name);
        const subjectKeyword = String(p.subject_keyword || dossier.subject_keyword || '').trim();
        const interestLine = normalizeInterestLineKeywords(p.interest_line || dossier.interest_line || p.research_interest || '');
        if (!lastName || lastName.length < 2 || !subjectKeyword || (!isBasic && !interestLine)) return null;

        db.prepare(`
          UPDATE scheduled_professors
          SET dossier=?, last_name=?, research_areas=?, university=?, source_url=COALESCE(NULLIF(source_url,''), ?)
          WHERE id=?
        `).run(
          JSON.stringify(dossier),
          dossier.last_name || p.last_name || prof.last_name,
          (dossier.research_areas || []).join(', '),
          dossier.university || prof.university || '',
          dossier.profile_url || p.profile_url || p.source_url || '',
          prof.id,
        );

        const subject = isBasic
          ? buildBasicOutreachSubject(subjectMode, subjectKeyword)
          : buildOutreachSubject(subjectKeyword, true);
        const htmlPreview = isBasic
          ? tpl.raw_html.replace(/\{\{LAST_NAME\}\}/g, lastName)
          : tpl.raw_html
            .replace(/\{\{LAST_NAME\}\}/g, lastName)
            .replace(/\{\{INTEREST_LINE\}\}/g, interestLine);

        return { prof: { ...prof, last_name: dossier.last_name || prof.last_name }, subject, interestLine: isBasic ? '' : interestLine, htmlPreview };
      };

      for (let b = 0; b < professors.length; b += BATCH_SIZE) {
        if (shouldAbort()) {
          db.prepare("UPDATE scheduled_batches SET status='drafted' WHERE id=?").run(batchId);
          console.log(`[Scheduler] Batch #${batchId} processing aborted by user`);
          advanceQueue();
          return;
        }
        const batch = professors.slice(b, b + BATCH_SIZE);

        const results = await Promise.allSettled(
          batch.map(async (p, localIdx) => {
            if (shouldAbort()) return null;
            const idx = b + localIdx;
            eventBus.publish({
              type: 'scheduled_batch_progress',
              mode: 'scheduled',
              batchId,
              phase: 'researching',
              current: idx + 1,
              total: professors.length,
              email: p.email,
              label: isBasic
                ? (subjectMode === 'search' ? `Researching ${p.name || p.email} for keyword (${idx + 1}/${professors.length})` : `Looking up last name for ${p.email} (${idx + 1}/${professors.length})`)
                : `Researching ${p.name || p.email} (${idx + 1}/${professors.length})`,
            });

            // Insert into scheduled_professors (separate table, with batch_id)
            const insertProf = db.prepare(
              'INSERT OR IGNORE INTO scheduled_professors (email, last_name, source_url, batch_id) VALUES (?,?,?,?)'
            );
            insertProf.run(p.email, p.last_name || '', p.source_url || '', batchId);
            const prof = db.prepare('SELECT * FROM scheduled_professors WHERE email=? AND batch_id=?').get(p.email, batchId);
            if (!prof) return null;

            const rosterDraft = buildDraftFromRosterRow(p, prof);
            if (rosterDraft) return rosterDraft;

            if (isBasic) {
              const enriched = await enrichProfessorFromScrape({
                prof: { ...p, email: prof.email },
                sourceUrl: url || p.source_url || '',
                mode: batchMode,
              });
              const enrichedDossier = enriched.dossier;
              db.prepare(`
                UPDATE scheduled_professors
                SET dossier=?, last_name=?, research_areas=?, university=?, source_url=?
                WHERE id=?
              `).run(
                JSON.stringify(enrichedDossier),
                capitalizeWord(enrichedDossier.last_name || p.last_name || prof.last_name),
                (enrichedDossier.research_areas || []).join(', '),
                enrichedDossier.university || prof.university || '',
                enrichedDossier.profile_url || p.profile_url || p.source_url || url || '',
                prof.id,
              );
              prof.dossier = JSON.stringify(enrichedDossier);
              prof.last_name = enrichedDossier.last_name || prof.last_name;
              prof.research_areas = (enrichedDossier.research_areas || []).join(', ');
              return draftBasicScheduledProfessor(prof, tpl, subjectMode);
            }

            let dossier = null;
            let found = false;

            if (!isBasic) {
              try {
                const enriched = await enrichProfessorFromScrape({
                  prof: { ...p, email: prof.email },
                  sourceUrl: url || p.source_url || '',
                  mode: batchMode,
                });
                dossier = enriched.dossier;
                if (enriched.queueState === 'needs_web_research') {
                  db.prepare('UPDATE scheduled_professors SET dossier=?, research_areas=? WHERE id=?').run(
                    JSON.stringify(dossier),
                    (dossier.research_areas || []).join(', '),
                    prof.id,
                  );
                  return { needsWebResearch: true, prof };
                }
                found = !!(dossier?.last_name?.length >= 2 && (
                  (dossier.subject_keyword && dossier.interest_line)
                  || (dossier.research_areas?.length > 0)
                  || (dossier.papers?.length > 0)
                  || dossier.profile_research_status === 'profile_found'
                  || dossier.profile_research_status === 'web_complete'
                ));
                if (found) {
                  db.prepare('UPDATE scheduled_professors SET dossier=?, last_name=?, research_areas=?, university=? WHERE id=?').run(
                    JSON.stringify(dossier),
                    capitalizeWord(dossier.last_name || prof.last_name),
                    (dossier.research_areas || []).join(', '),
                    dossier.university || prof.university || '',
                    prof.id,
                  );
                }
              } catch (e) {
                console.error(`[Scheduler] Profile research failed for ${p.email}:`, e.message);
              }
            }

            if (!isBasic && !found) {
              return { error: 'Last name mandatory — could not verify professor surname from research', prof };
            }

            let subject = '';
            let interestLine = '';

            try {
              const result = await generateEmail(
                dossier,
                tpl?.instructions || '',
                tpl?.sample_subject || '',
                targetingHints,
                formatGreetingLastName(dossier.last_name || prof.last_name),
              );

              if (!result.pass || !result.interestLine || result.interestLine.length < 5) {
                const needsWeb = result.reasons?.some(r => /web search/i.test(r));
                if (needsWeb) return { needsWebResearch: true, prof };
                return { error: 'Weak personalization', prof };
              }

              subject = buildOutreachSubject(result.topic, true);
              interestLine = normalizeInterestLineKeywords(result.interestLine || '');
            } catch (e) {
              return { error: `Generate failed: ${e.message}`, prof };
            }

            const lastName = formatGreetingLastName(dossier.last_name);
            let htmlPreview = '';
            if (tpl?.raw_html) {
              htmlPreview = tpl.raw_html
                .replace(/\{\{LAST_NAME\}\}/g, lastName)
                .replace(/\{\{INTEREST_LINE\}\}/g, normalizeInterestLineKeywords(interestLine));
            }

            return { prof, subject, interestLine, htmlPreview };
          })
        );

        for (const r of results) {
          if (r.status !== 'fulfilled' || !r.value) continue;
          const val = r.value;

          if (val.needsWebResearch) {
            db.prepare(`
              INSERT INTO scheduled_drafts (batch_id, professor_id, subject, interest_line, html_preview, status, error)
              VALUES (?,?,?,?,?,?,?)
            `).run(batchId, val.prof.id, '', '', '', 'needs_web_research', 'No research found on faculty page — use Web Search');
            continue;
          }

          if (val.error) {
            db.prepare(`
              INSERT INTO scheduled_drafts (batch_id, professor_id, subject, interest_line, html_preview, status, error)
              VALUES (?,?,?,?,?,?,?)
            `).run(batchId, val.prof.id, '', '', '', 'failed', val.error);
            continue;
          }

          const { prof, subject, interestLine, htmlPreview } = val;
          const lastName = prof.last_name || db.prepare('SELECT last_name FROM scheduled_professors WHERE id=?').get(prof.id)?.last_name;

          const draftCheck = verifyScheduledDraft({
            subject,
            interest_line: interestLine,
            html_preview: htmlPreview,
            last_name: lastName,
          }, batchMode, subjectMode);

          if (!draftCheck.ok) {
            db.prepare(`
              INSERT INTO scheduled_drafts (batch_id, professor_id, subject, interest_line, html_preview, status, error)
              VALUES (?,?,?,?,?,?,?)
            `).run(batchId, prof.id, subject || '', interestLine || '', htmlPreview || '', 'failed', draftCheck.errors.join('; '));
            continue;
          }

          db.prepare(`
            INSERT INTO scheduled_drafts (batch_id, professor_id, subject, interest_line, html_preview, status)
            VALUES (?,?,?,?,?,?)
          `).run(batchId, prof.id, subject, interestLine, htmlPreview, 'draft');

          successfulDrafts++;
          const tokens = getTokenUsage();
          eventBus.publish({
            type: 'scheduled_draft_ready',
            mode: 'scheduled',
            batchId,
            professorEmail: prof.email,
            subject,
            interestLine,
            tokens: tokens.output,
            reasoningTokens: tokens.reasoning,
          });
        }
      }

      // ── Batch state transition after processing ──
      const batchInfo = db.prepare('SELECT auto_approve FROM scheduled_batches WHERE id=?').get(batchId);

      if (batchInfo?.auto_approve) {
        // Auto-approve: all drafts → approved, batch → 'scheduled' (awaiting send time)
        db.prepare("UPDATE scheduled_drafts SET status='approved' WHERE batch_id=? AND status='draft'").run(batchId);
        db.prepare("UPDATE scheduled_batches SET status='scheduled' WHERE id=?").run(batchId);
        eventBus.publish({ type: 'scheduled_batch_approved', mode: 'scheduled', batchId });
        console.log(`[Scheduler] Batch #${batchId}: auto-approved ${successfulDrafts} drafts, awaiting scheduled_at`);
      } else {
        // Manual: batch → 'drafted' (user must review)
        db.prepare("UPDATE scheduled_batches SET status='drafted' WHERE id=?").run(batchId);
        eventBus.publish({ type: 'scheduled_batch_drafted', mode: 'scheduled', batchId });
        console.log(`[Scheduler] Batch #${batchId}: ${successfulDrafts} drafts ready for review`);
      }

      eventBus.publish({ type: 'scheduled_batch_progress', mode: 'scheduled', batchId, phase: 'complete', total: professors.length });
    } catch (e) {
      console.error(`[Scheduler] Batch #${batchId} processing failed:`, e.message);
      db.prepare("UPDATE scheduled_batches SET status='failed' WHERE id=?").run(batchId);
      eventBus.publish({ type: 'scheduled_batch_error', mode: 'scheduled', batchId, error: e.message });
    }
    advanceQueue();  // Always advance queue so next batch can start
}
