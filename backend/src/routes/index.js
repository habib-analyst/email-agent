import { Router } from 'express';
import db, { getActiveWorkspace } from '../db/index.js';
import { detectPlaceholders, getTokenUsage, resetTokenUsage, getTotalQwenTokens, getApiStats, suggestReply, suggestFollowUp } from '../ai/index.js';
import {
  createReplyDraft,
  getEmailHtml,
  getMessageReplyHeaders,
  getSentEmailSnapshot,
  sendReplyEmail,
  sendEmail,
  isSendLimitError,
} from '../gmail/index.js';
import uploadRouter from './upload.js';
import authRouter from './auth.routes.js';
import sheetRouter from './sheet.routes.js';
import { PipelineService } from '../services/PipelineService.js';
import { eventBus } from '../core/EventBus.js';
import { startFacultyImport, getScrapeStatus, cancelScrapeJob, resetScrapeJob } from '../pipeline/scrapeJob.js';
import { prioritizeQueue, stopWorker, ensureWorkersRunning } from '../pipeline/index.js';
import { stopScheduler, cancelScheduledWork, clearScheduledAbort } from '../pipeline/scheduler.js';
import { getWeeklyDigest, runWeeklyDigest, getAnalytics } from '../learning/index.js';
import { getUniversityOutreach } from '../learning/universityOutreach.js';
import { basename, resolve } from 'path';
import { mkdirSync } from 'fs';
import { config } from '../config/index.js';
import { buildRosterRows, rosterToCsv } from '../learning/roster.js';
import { syncRosterFromDb, readRosterExcelBuffer, readRosterExcel, clearRosterExcel, rosterToXlsxBuffer, upsertRosterRow, removeRosterRow } from '../learning/rosterExcel.js';
import {
  runWebResearchForProfessor,
  getProfileResearchStatus,
  profileResearchStatusLabelForDossier,
  enrichProfessorFromEmailImport,
} from '../research/profileResearch.js';
import { lastNameFromEmail, lastNameFromFullName, fullNameFromEmail, universityFromEmail, sanitizeAIField } from '../utils/professor.js';
import { normalizeInterestLineKeywords } from '../utils/interestLine.js';
import { getEmptyStats, performFullReset, resetByMode } from '../db/resetSession.js';
import { getSessionEpoch, bumpSessionEpoch } from '../session/epoch.js';
import { AuthService } from '../services/AuthService.js';
import { buildOutreachSubject, buildBasicOutreachSubject, getBasicSubjectMode } from '../gmail/basicTemplate.js';
import { settingsForClient } from '../services/senderIdentity.js';
import {
  applyUserApiKeysFromDb,
  mergeUserApiKeys,
  serializeUserApiKeys,
  testApiKeyAuto,
} from '../services/userApiKeys.js';
import { GmailService } from '../services/GmailService.js';
import { requireGmail } from '../middleware/requireGmail.js';
import { saveTemplateForMode, repairBasicInstantTemplate, ensureTemplateForMode, syncBasicSubjectOptions } from '../db/templateStore.js';
import { findPriorOutreach, recordDuplicateBlocked } from '../db/duplicateCheck.js';
import { evaluateDuplicate } from '../db/duplicatePolicy.js';
import { autoStartBatchQueue, runBatchForMode, getQueueProgress } from '../services/batchRunner.js';
import { reconcileInstantQueue } from '../services/startupReconciliation.js';
import { validateEmailList, validateProfessorEntries } from '../validation/importValidation.js';
import { parseCampaignPresets, serializeCampaignPresets, DEFAULT_CAMPAIGN_PRESETS } from '../db/campaignPresets.js';
import { suggestScheduledAt } from '../utils/scheduleSuggest.js';
import archiveRouter from './archive.js';
import adminRouter from './admin.routes.js';
import attachmentRouter from './attachment.routes.js';
import { requireActiveTenant, requireFeature } from '../middleware/tenantAccess.js';
import { getAgentContext } from '../db/agentContext.js';
import { isBasicInstant, isBasicMode } from '../config/modes.js';
import { professorsFromRawImportInput } from '../utils/pasteImportParser.js';
import { getDeliveryFailureStats, recordDeliveryFailure } from '../db/deliveryFailures.js';
import { getOutboundSendBlock } from '../gmail/sendControl.js';
import { fetchUserReplyStyleSamples } from '../gmail/sentReplyStyle.js';
import {
  listFollowUpCandidates,
  getFollowUpDays,
  saveFollowUpDraft,
  markFollowUpSent,
  markFollowUpSkipped,
} from '../services/followUpService.js';
import { getInstantQueueGroupRows, latestInstantQueueGroup, listInstantQueueGroups } from '../services/instantQueueGroups.js';

const router = Router();
const BLOCKED_TEST_DOMAINS = ['example.com', 'example.edu'];

let rosterCache = { buffer: null, timestamp: 0, workspace: null };

function isBlockedTestEmail(email) {
  return BLOCKED_TEST_DOMAINS.some(domain => email.includes(domain));
}

function blockedTestEmailMessage(count) {
  const suffix = count === 1 ? 'email uses' : 'emails use';
  return `No valid email addresses found. ${count} ${suffix} example.com/example.edu, which are ignored for safety. Use a real university-style test domain.`;
}

async function createDbBackup(reason = 'manual') {
  const backupDir = resolve(import.meta.dirname, '../../exports/backups');
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeReason = String(reason || 'manual').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40);
  const backupPath = resolve(backupDir, `data-${safeReason}-${stamp}.db`);
  await db.backup(backupPath);
  return backupPath;
}

function enqueueSingleProfessorForReview(prof, mode, enriched = null) {
  const insert = db.prepare('INSERT OR IGNORE INTO professors (email, last_name, source_url, university, research_areas, dossier, mode) VALUES (?,?,?,?,?,?,?)');
  const insertQueue = db.prepare('INSERT INTO queue (professor_id, state, mode) VALUES (?,?,?)');
  const blockedStates = ['sent', 'researching', 'drafted', 'verified', 'sending'];
  const settings = db.prepare('SELECT * FROM settings WHERE id=1').get() || {};
  const isBasic = mode === 'basic_instant';

  const dossier = enriched?.dossier || {
    email: prof.email,
    last_name: prof.last_name,
    university: prof.university,
    research_areas: [],
    papers: [],
    verified: false,
    research_source: 'queued_for_agent',
  };
  const initialQueueState = enriched?.queueState === 'needs_web_research' && !isBasic
    ? 'needs_web_research'
    : 'awaiting_proceed';

  const result = db.transaction(() => {
    let added = 0;
    let skipped = 0;
    let singleQueueId = null;

    const existing = db.prepare('SELECT id FROM professors WHERE email=? AND mode=?').get(prof.email, mode);
    let profId;
    if (existing) {
      profId = existing.id;
      db.prepare('UPDATE professors SET last_name=COALESCE(NULLIF(?, ""), last_name), university=COALESCE(NULLIF(?, ""), university), research_areas=?, dossier=? WHERE id=?')
        .run(
          dossier.last_name || prof.last_name || '',
          dossier.university || prof.university || '',
          (dossier.research_areas || []).join(', '),
          JSON.stringify(dossier),
          profId,
        );
    } else {
      const info = insert.run(
        prof.email,
        dossier.last_name || prof.last_name,
        dossier.profile_url || '',
        dossier.university || prof.university,
        (dossier.research_areas || []).join(', '),
        JSON.stringify(dossier),
        mode,
      );
      profId = info.lastInsertRowid;
    }

    const queued = db.prepare('SELECT id, state, error FROM queue WHERE professor_id=? ORDER BY id DESC LIMIT 1').get(profId);
    if (queued) {
      if (blockedStates.includes(queued.state)) {
        skipped = 1;
      } else if (queued.state === 'skipped' && queued.error === 'duplicate_skipped') {
        db.prepare("UPDATE queue SET state='duplicate_review', error=NULL, retry_count=0, retry_after=NULL WHERE id=?").run(queued.id);
        added = 1;
      } else {
        db.prepare("UPDATE queue SET state=?, error=NULL, retry_count=0, retry_after=NULL WHERE id=? AND state NOT IN ('sent','researching','drafted','verified','sending','duplicate_review')")
          .run(initialQueueState, queued.id);
        if (initialQueueState === 'needs_web_research') {
          db.prepare("UPDATE queue SET error=? WHERE id=?").run('No research found — use Web Search', queued.id);
        }
        singleQueueId = queued.id;
        added = 1;
      }
      upsertRosterRow({
        email: prof.email,
        full_name: dossier.name || prof.name || prof.last_name || '',
        last_name: dossier.last_name || prof.last_name,
        research_interest: (dossier.research_areas || []).join(', ') || prof.research_interest || '',
        subject_keyword: dossier.subject_keyword || prof.subject_keyword || '',
        interest_line: dossier.interest_line || prof.interest_line || '',
        profile_research_status: getProfileResearchStatus(dossier),
        research_info: profileResearchStatusLabelForDossier(dossier),
        queue_state: initialQueueState,
      });
      return { added, skipped, singleQueueId, awaitingProceed: initialQueueState === 'awaiting_proceed' && !!singleQueueId };
    }

    const dup = evaluateDuplicate(prof.email, settings);
    if (dup.blocked) {
      if (dup.action === 'skip') {
        const qInfo = insertQueue.run(profId, 'skipped', mode);
        db.prepare("UPDATE queue SET error=? WHERE id=?").run('duplicate_skipped', qInfo.lastInsertRowid);
        recordDuplicateBlocked(prof.email, dup.prior, { mode, queue_id: qInfo.lastInsertRowid });
        return { added: 0, skipped: 1, singleQueueId: null, awaitingProceed: false };
      }
      const qInfo = insertQueue.run(profId, 'duplicate_review', mode);
      db.prepare('UPDATE queue SET error=? WHERE id=?').run(
        `duplicate_sent:${dup.prior?.sent_at || dup.prior?.created_at || ''}:${dup.prior?.subject || ''}`,
        qInfo.lastInsertRowid,
      );
      recordDuplicateBlocked(prof.email, dup.prior, { mode, queue_id: qInfo.lastInsertRowid });
      return { added: 1, skipped: 0, singleQueueId: null, awaitingProceed: false };
    }

    const qInfo = insertQueue.run(profId, initialQueueState, mode);
    if (initialQueueState === 'needs_web_research') {
      db.prepare("UPDATE queue SET error=? WHERE id=?").run('No research found — use Web Search', qInfo.lastInsertRowid);
    }
    singleQueueId = qInfo.lastInsertRowid;
    upsertRosterRow({
      email: prof.email,
      full_name: dossier.name || prof.name || prof.last_name || '',
      last_name: dossier.last_name || prof.last_name,
      research_interest: (dossier.research_areas || []).join(', ') || prof.research_interest || '',
      subject_keyword: dossier.subject_keyword || prof.subject_keyword || '',
      interest_line: dossier.interest_line || prof.interest_line || '',
      profile_research_status: getProfileResearchStatus(dossier),
      research_info: profileResearchStatusLabelForDossier(dossier),
      queue_state: initialQueueState,
    });
    return { added: 1, skipped: 0, singleQueueId, awaitingProceed: initialQueueState === 'awaiting_proceed' };
  })();
  syncRosterFromDb(mode);
  return result;
}

router.use('/auth', authRouter);
router.use(requireActiveTenant);
router.use('/archive', archiveRouter);

router.post('/template/raw', (req, res) => {
  const { html, instructions, sample_subject, mode: bodyMode } = req.body;
  const mode = bodyMode || req.query.mode || 'instant';
  if (!html && instructions == null && sample_subject == null) {
    return res.status(400).json({ error: 'HTML or instructions required' });
  }
  const tpl = saveTemplateForMode(mode, {
    raw_html: html,
    instructions,
    sample_subject,
  });
  res.json({ success: true, template: tpl });
});

router.post('/template/repair-basic', (req, res) => {
  const result = repairBasicInstantTemplate();
  const tpl = db.prepare("SELECT * FROM template WHERE mode='basic_instant'").get();
  res.json({ success: true, ...result, template: tpl });
});

router.post('/template/detect', async (req, res) => {
  const mode = req.body.mode || req.query.mode || 'instant';
  const tpl = db.prepare('SELECT raw_html FROM template WHERE mode=?').get(mode);
  if (!tpl?.raw_html) return res.status(404).json({ error: 'No template saved' });
  const placeholders = await detectPlaceholders(tpl.raw_html);

  let markedHtml = tpl.raw_html;
  if (placeholders.lastName && markedHtml.includes(placeholders.lastName)) {
    markedHtml = markedHtml.replaceAll(placeholders.lastName, '{{LAST_NAME}}');
  }
  if (!isBasicInstant(mode) && placeholders.interestLine && markedHtml.includes(placeholders.interestLine)) {
    markedHtml = markedHtml.replaceAll(placeholders.interestLine, '{{INTEREST_LINE}}');
  }

  const saved = saveTemplateForMode(mode, { raw_html: markedHtml });
  res.json({
    success: true,
    placeholders: isBasicInstant(mode)
      ? { lastName: '{{LAST_NAME}}', interestLine: null }
      : placeholders,
    template: saved,
  });
});

router.post('/template/load-latest', async (req, res) => {
  try {
    const mode = req.body.mode || req.query.mode || 'instant';
    const result = await GmailService.loadLatestAsTemplate(mode);
    if (!result.success) return res.status(404).json({ error: result.reason || 'Could not load template from Email_Template.txt' });
    const tpl = db.prepare('SELECT * FROM template WHERE mode=?').get(mode);
    res.json({ success: true, placeholders: result.placeholders, template: tpl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/template/load-by-recipient', requireGmail, async (req, res) => {
  try {
    const { recipient } = req.body;
    if (!recipient) return res.status(400).json({ error: 'recipient required' });
    const { searchSentByRecipient } = await import('../gmail/index.js');
    const html = await searchSentByRecipient(recipient);
    if (!html) return res.status(404).json({ error: `No sent email found to ${recipient}` });

    const mode = req.body.mode || req.query.mode || 'instant';

    let placeholders = { lastName: '{{LAST_NAME}}', interestLine: '{{INTEREST_LINE}}' };
    try { placeholders = await detectPlaceholders(html); } catch {}

    let markedHtml = html;
    if (placeholders.lastName && html.includes(placeholders.lastName))
      markedHtml = markedHtml.replaceAll(placeholders.lastName, '{{LAST_NAME}}');
    if (!isBasicInstant(mode) && placeholders.interestLine && markedHtml.includes(placeholders.interestLine))
      markedHtml = markedHtml.replaceAll(placeholders.interestLine, '{{INTEREST_LINE}}');

    const existing = db.prepare('SELECT instructions, sample_subject FROM template WHERE mode=?').get(mode);

    const saved = saveTemplateForMode(mode, {
      raw_html: markedHtml,
      instructions: existing?.instructions,
      sample_subject: existing?.sample_subject,
    });

    eventBus.publish({ type: 'template_loaded', mode, source: 'load_by_recipient' });
    res.json({ success: true, placeholders, template: saved });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, code: e.code });
  }
});

router.get('/gmail/sent', requireGmail, async (req, res) => {
  try {
    res.json(await GmailService.listSent(20));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, code: e.code });
  }
});

router.get('/gmail/sent/latest', requireGmail, async (req, res) => {
  try {
    const html = await GmailService.getLatestHtml(true);
    res.json({ html });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, code: e.code });
  }
});

router.post('/template', requireGmail, async (req, res) => {
  const { messageId, mode: bodyMode } = req.body;
  const mode = bodyMode || req.query.mode || 'instant';
  try {
    const html = await GmailService.getSentHtml(messageId);
    if (!html) return res.status(404).json({ error: 'No HTML body found in that email' });
    const existing = db.prepare('SELECT instructions, sample_subject FROM template WHERE mode=?').get(mode);
    const placeholders = await detectPlaceholders(html);

    let markedHtml = html;
    if (placeholders.lastName && markedHtml.includes(placeholders.lastName)) {
      markedHtml = markedHtml.replaceAll(placeholders.lastName, '{{LAST_NAME}}');
    }
    if (!isBasicInstant(mode) && placeholders.interestLine && markedHtml.includes(placeholders.interestLine)) {
      markedHtml = markedHtml.replaceAll(placeholders.interestLine, '{{INTEREST_LINE}}');
    }

    saveTemplateForMode(mode, {
      raw_html: markedHtml,
      instructions: existing?.instructions,
      sample_subject: existing?.sample_subject,
    });
    res.json({ success: true, placeholders });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/template', (req, res) => {
  try {
    const mode = req.query.mode || 'instant';
    const tpl = ensureTemplateForMode(mode);
    if (!tpl?.raw_html) return res.json(null);
    res.json(tpl);
  } catch (e) {
    console.error('[API] /template:', e.message);
    res.status(500).json({ error: e.message || 'Failed to load template' });
  }
});

router.put('/template/instructions', (req, res) => {
  const mode = req.body.mode || req.query.mode || 'instant';
  const { instructions, sample_subject } = req.body;
  const tpl = saveTemplateForMode(mode, { instructions, sample_subject });
  res.json({ success: true, template: tpl });
});

router.post('/professors', async (req, res) => {
  try {
  const { emails, url, mode: bodyMode, max_professors } = req.body;
  const mode = bodyMode || req.query.mode || 'instant';

  if (url) {
    const result = startFacultyImport(url, eventBus.publish.bind(eventBus), {
      max_professors,
      mode,
      skip_designations: req.body.skip_designations || [],
    });
    if (!result.started) return res.status(409).json(result);
    return res.json({ started: true, message: 'Scraping professors in background — watch live progress below' });
  }

  if (!emails) return res.status(400).json({ error: 'Provide emails or url' });

  const profs = professorsFromRawImportInput(emails).filter(p => p.email.includes('@') && !isBlockedTestEmail(p.email));
  const blockedTestEmails = (typeof emails === 'string'
    ? emails.split(/[\n,;]+/).map(e => e.trim().toLowerCase())
    : Array.isArray(emails) ? emails.map(e => String(e).trim().toLowerCase()) : []
  ).filter(isBlockedTestEmail);

  if (profs.length === 0) {
    return res.status(400).json({
      error: blockedTestEmails.length
        ? blockedTestEmailMessage(blockedTestEmails.length)
        : 'No valid email addresses found',
    });
  }

  // Apply max_professors limit
  const limitedProfs = max_professors ? profs.slice(0, max_professors) : profs;
  const isSingle = limitedProfs.length === 1;
  if (isSingle) {
    const enriched = await enrichProfessorFromEmailImport({ prof: limitedProfs[0], mode });
    const result = enqueueSingleProfessorForReview(limitedProfs[0], mode, enriched);
    const autoStart = result.singleQueueId
      ? await autoStartBatchQueue([result.singleQueueId], 'after_paste_import', mode)
      : { autoStarted: false, templateLoaded: false };
    return res.json({
      ...result,
      total: 1,
      started: false,
      isSingle: true,
      queuedImmediately: true,
      queueIds: result.singleQueueId ? [result.singleQueueId] : [],
      awaitingProceed: result.awaitingProceed && !autoStart.autoStarted,
      autoStarted: autoStart.autoStarted,
      templateLoaded: autoStart.templateLoaded,
    });
  }

  const isBasicInstant = mode === 'basic_instant';
  const RESEARCH_BATCH = 10;
  const researched = [];

  for (let b = 0; b < limitedProfs.length; b += RESEARCH_BATCH) {
    const batch = limitedProfs.slice(b, b + RESEARCH_BATCH);

    const results = await Promise.allSettled(
      batch.map(async p => {
        try {
          const enriched = await enrichProfessorFromEmailImport({
            prof: p,
            mode,
          });

          eventBus.publish({
            type: 'import_research_progress',
            mode,
            email: p.email,
            phase: 'complete',
            label: enriched.needsWebSearch
              ? `No page data for ${p.email} — Web Search available`
              : isBasicInstant
                ? `Last name ready for ${p.email}`
                : `Research ready for ${p.email}`,
            profile_research_status: enriched.dossier.profile_research_status,
          });

          return {
            ...p,
            dossier: enriched.dossier,
            queueState: enriched.queueState,
            success: true,
          };
        } catch (e) {
          console.error(`[Import] Research failed for ${p.email}:`, e.message);

          return {
            ...p,
            dossier: {
              email: p.email,
              last_name: p.last_name,
              university: p.university,
              research_areas: [],
              papers: [],
              verified: false,
              profile_research_status: 'none_on_page',
              research_source: 'fallback',
            },
            queueState: isBasicInstant ? 'pending' : 'needs_web_research',
            success: false,
          };
        }
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') researched.push(r.value);
    }
  }

  const settings = db.prepare('SELECT * FROM settings WHERE id=1').get() || {};
  const initialState = isSingle ? 'awaiting_proceed' : 'pending';

  const insert = db.prepare('INSERT OR IGNORE INTO professors (email, last_name, source_url, university, research_areas, dossier, mode) VALUES (?,?,?,?,?,?,?)');
  const insertQueue = db.prepare('INSERT INTO queue (professor_id, state, mode) VALUES (?,?,?)');
  const BLOCKED_STATES = ['sent', 'researching', 'drafted', 'verified', 'sending'];
  let added = 0;
  let skipped = 0;
  let singleQueueId = null;
  const queueIds = [];

  const insertAll = db.transaction((researchedProfs) => {
    for (const p of researchedProfs) {
    const university = p.dossier.university || universityFromEmail(p.email);
    let profId;
    const existing = db.prepare('SELECT id FROM professors WHERE email=? AND mode=?').get(p.email, mode);
    if (existing) {
      profId = existing.id;
      // Update with researched data
      db.prepare('UPDATE professors SET last_name=?, university=?, research_areas=?, dossier=? WHERE id=?').run(
        p.dossier.last_name || p.last_name,
        university,
        (p.dossier.research_areas || []).join(', '),
        JSON.stringify(p.dossier),
        profId
      );
    } else {
      const info = insert.run(
        p.email,
        p.dossier.last_name || p.last_name,
        p.dossier.profile_url || '',
        university,
        (p.dossier.research_areas || []).join(', '),
        JSON.stringify(p.dossier),
        mode
      );
      profId = info.lastInsertRowid;
    }

    const dup = evaluateDuplicate(p.email, settings);

    const queued = db.prepare('SELECT id, state, error FROM queue WHERE professor_id=? ORDER BY id DESC LIMIT 1').get(profId);
    if (queued) {
      // Don't re-queue items that are already sent or in active processing
      if (BLOCKED_STATES.includes(queued.state)) {
        skipped++;
        continue;
      }

      // Re-activate items that were duplicate_skipped or duplicate_review
      if (queued.state === 'skipped' && queued.error === 'duplicate_skipped') {
        db.prepare("UPDATE queue SET state='duplicate_review', error=NULL, retry_count=0, retry_after=NULL WHERE id=?").run(queued.id);
        added++;
        continue;
      }

      if (isSingle) {
        db.prepare("UPDATE queue SET state='awaiting_proceed', error=NULL, retry_count=0, retry_after=NULL WHERE id=? AND state NOT IN ('sent','researching','drafted','verified','sending','duplicate_review')").run(queued.id);
        singleQueueId = queued.id;
        added++;
      } else {
        db.prepare("UPDATE queue SET state='pending', error=NULL, retry_count=0, retry_after=NULL WHERE id=? AND state NOT IN ('sent','researching','drafted','verified','sending','duplicate_review')").run(queued.id);
        queueIds.push(queued.id);
        added++;
      }
      continue;
    }

    if (dup.blocked) {
      if (dup.action === 'skip') {
        const qInfo = insertQueue.run(profId, 'skipped', mode);
        db.prepare("UPDATE queue SET error=? WHERE id=?").run('duplicate_skipped', qInfo.lastInsertRowid);
        recordDuplicateBlocked(p.email, dup.prior, { mode, queue_id: qInfo.lastInsertRowid });
        skipped++;
        continue;
      }
      const qInfo = insertQueue.run(profId, 'duplicate_review', mode);
      db.prepare('UPDATE queue SET error=? WHERE id=?').run(
        `duplicate_sent:${dup.prior?.sent_at || dup.prior?.created_at || ''}:${dup.prior?.subject || ''}`,
        qInfo.lastInsertRowid,
      );
      recordDuplicateBlocked(p.email, dup.prior, { mode, queue_id: qInfo.lastInsertRowid });
      added++;
      continue;
    }

    const queueState = isSingle ? initialState : (p.queueState || 'pending');
    const qInfo = insertQueue.run(profId, queueState, mode);
    if (queueState === 'needs_web_research') {
      db.prepare("UPDATE queue SET error=? WHERE id=?").run('No research found — use Web Search', qInfo.lastInsertRowid);
    }
    added++;
    if (isSingle) singleQueueId = qInfo.lastInsertRowid;
    else queueIds.push(qInfo.lastInsertRowid);
    upsertRosterRow({
      email: p.email,
      full_name: p.dossier.name || p.name || p.last_name || '',
      last_name: p.dossier.last_name || p.last_name,
      research_interest: (p.dossier.research_areas || []).join(', ') || p.research_interest || '',
      subject_keyword: p.dossier.subject_keyword || p.subject_keyword || '',
      interest_line: p.dossier.interest_line || p.interest_line || '',
      profile_research_status: getProfileResearchStatus(p.dossier),
      research_info: profileResearchStatusLabelForDossier(p.dossier),
      queue_state: queueState,
    });
    }
  });

  insertAll(researched);
  syncRosterFromDb(mode);

  let autoStart = { autoStarted: false, templateLoaded: false };
  if (added > 0) {
    autoStart = await autoStartBatchQueue(queueIds, 'after_paste_import', mode);
  }

  res.json({
    added,
    skipped,
    total: limitedProfs.length,
    started: false,
    awaitingProceed: isSingle && !!singleQueueId,
    singleQueueId: isSingle ? singleQueueId : null,
    autoStarted: autoStart.autoStarted,
    templateLoaded: autoStart.templateLoaded,
  });
  } catch (e) {
    console.error('[Professors] Import failed:', e.message);
    res.status(500).json({ error: e.message || 'Professor import failed' });
  }
});

router.get('/professors', (req, res) => {
  const mode = req.query.mode || 'instant';
  const limit = Math.min(500, parseInt(req.query.limit) || 100);
  res.json(db.prepare('SELECT id, email, last_name, university, research_areas, source_url, created_at FROM professors WHERE mode=? ORDER BY created_at DESC LIMIT ?').all(mode, limit));
});

router.get('/scrape/status', (req, res) => {
  res.json(getScrapeStatus());
});

router.post('/scrape/cancel', (req, res) => {
  cancelScrapeJob();
  res.json({ success: true });
});

router.post('/agent/stop', (req, res) => {
  cancelScrapeJob();
  cancelScheduledWork();
  stopWorker();
  stopScheduler();
  PipelineService.stop();
  db.prepare("UPDATE queue SET state='pending' WHERE state IN ('researching','drafted','verified','sending')").run();
  eventBus.publish({ type: 'agent_stopped', label: 'All agent work stopped by user' });
  res.json({ success: true, message: 'All processes stopped' });
});

router.post('/roster/clear', (req, res) => {
  clearRosterExcel();
  res.json({ success: true });
});

router.post('/professors/:id/web-research', async (req, res) => {
  try {
    const mode = req.body.mode || req.query.mode || 'instant';
    const prof = db.prepare('SELECT * FROM professors WHERE id=? AND mode=?').get(req.params.id, mode);
    if (!prof) return res.status(404).json({ error: 'Professor not found' });

    let existing = {};
    try { existing = JSON.parse(prof.dossier || '{}'); } catch { existing = {}; }

    const dossier = await runWebResearchForProfessor(
      prof.email,
      prof.source_url || '',
      existing.profile_url || prof.source_url || '',
      existing,
    );

    db.prepare('UPDATE professors SET dossier=?, research_areas=?, last_name=?, university=COALESCE(NULLIF(university,\'\'), ?) WHERE id=?').run(
      JSON.stringify(dossier),
      (dossier.research_areas || []).join(', '),
      dossier.last_name || prof.last_name,
      dossier.university || prof.university || '',
      prof.id,
    );

    const queueRow = db.prepare("SELECT id FROM queue WHERE professor_id=? AND mode=? AND state='needs_web_research' ORDER BY id DESC LIMIT 1").get(prof.id, mode);
    if (queueRow) {
      db.prepare("UPDATE queue SET state='pending', error=NULL, fast_track=0 WHERE id=?").run(queueRow.id);
      prioritizeQueue(queueRow.id);
    }

    upsertRosterRow({
      email: prof.email,
      full_name: dossier.name || prof.last_name,
      research_interest: (dossier.research_areas || []).join(', '),
      subject_keyword: dossier.subject_keyword || '',
      interest_line: dossier.interest_line || '',
      profile_research_status: getProfileResearchStatus(dossier),
      research_info: profileResearchStatusLabelForDossier(dossier),
      queue_state: 'pending',
    });
    syncRosterFromDb(mode);

    eventBus.publish({ type: 'web_research_complete', professor: prof.email, mode, dossier });
    res.json({ success: true, dossier, profile_research_status: getProfileResearchStatus(dossier) });
  } catch (e) {
    console.error('[API] web-research professor:', e.message);
    res.status(500).json({ error: e.message || 'Web research failed' });
  }
});

router.post('/queue/:id/web-research', async (req, res) => {
  try {
    const row = db.prepare(`
      SELECT q.id as queue_id, q.mode, p.*
      FROM queue q JOIN professors p ON q.professor_id=p.id AND q.mode=p.mode
      WHERE q.id=?
    `).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Queue item not found' });

    let existing = {};
    try { existing = JSON.parse(row.dossier || '{}'); } catch { existing = {}; }

    const dossier = await runWebResearchForProfessor(
      row.email,
      row.source_url || '',
      existing.profile_url || row.source_url || '',
      existing,
    );

    db.prepare('UPDATE professors SET dossier=?, research_areas=?, last_name=? WHERE id=?').run(
      JSON.stringify(dossier),
      (dossier.research_areas || []).join(', '),
      dossier.last_name || row.last_name,
      row.id,
    );
    db.prepare("UPDATE queue SET state='pending', error=NULL, fast_track=0 WHERE id=?").run(row.queue_id);
    prioritizeQueue(row.queue_id);

    upsertRosterRow({
      email: row.email,
      full_name: dossier.name || row.last_name,
      research_interest: (dossier.research_areas || []).join(', '),
      subject_keyword: dossier.subject_keyword || '',
      interest_line: dossier.interest_line || '',
      profile_research_status: getProfileResearchStatus(dossier),
      research_info: profileResearchStatusLabelForDossier(dossier),
      queue_state: 'pending',
    });
    syncRosterFromDb(row.mode);

    eventBus.publish({ type: 'web_research_complete', professor: row.email, mode: row.mode, queueId: row.queue_id });
    res.json({ success: true, dossier });
  } catch (e) {
    console.error('[API] web-research queue:', e.message);
    res.status(500).json({ error: e.message || 'Web research failed' });
  }
});

router.post('/queue/web-research-bulk', async (req, res) => {
  try {
    const mode = req.body.mode || req.query.mode || 'instant';
    const limit = Math.min(Number(req.body.limit) || 50, 100);
    let rows;
    if (req.body.queueIds?.length) {
      const ph = req.body.queueIds.map(() => '?').join(',');
      rows = db.prepare(`
        SELECT q.id as queue_id, q.mode, p.*
        FROM queue q JOIN professors p ON q.professor_id=p.id AND q.mode=p.mode
        WHERE q.id IN (${ph}) AND q.state='needs_web_research'
      `).all(...req.body.queueIds);
    } else {
      rows = db.prepare(`
        SELECT q.id as queue_id, q.mode, p.*
        FROM queue q JOIN professors p ON q.professor_id=p.id AND q.mode=p.mode
        WHERE q.state='needs_web_research' AND q.mode=?
        ORDER BY q.id LIMIT ?
      `).all(mode, limit);
    }

    const results = [];
    for (const row of rows) {
      try {
        let existing = {};
        try { existing = JSON.parse(row.dossier || '{}'); } catch { existing = {}; }
        const dossier = await runWebResearchForProfessor(row.email, row.source_url || '', existing.profile_url || row.source_url || '', existing);
        db.prepare('UPDATE professors SET dossier=?, research_areas=?, last_name=? WHERE id=?').run(
          JSON.stringify(dossier), (dossier.research_areas || []).join(', '), dossier.last_name || row.last_name, row.id,
        );
        db.prepare("UPDATE queue SET state='pending', error=NULL, fast_track=0 WHERE id=?").run(row.queue_id);
        prioritizeQueue(row.queue_id);
        upsertRosterRow({
          email: row.email,
          full_name: dossier.name || row.last_name,
          research_interest: (dossier.research_areas || []).join(', '),
          subject_keyword: dossier.subject_keyword || '',
          interest_line: dossier.interest_line || '',
          profile_research_status: getProfileResearchStatus(dossier),
          research_info: profileResearchStatusLabelForDossier(dossier),
          queue_state: 'pending',
        });
        eventBus.publish({ type: 'web_research_complete', professor: row.email, mode: row.mode, queueId: row.queue_id });
        results.push({ email: row.email, success: true, queueId: row.queue_id });
      } catch (e) {
        results.push({ email: row.email, success: false, error: e.message });
      }
    }
    syncRosterFromDb(mode);
    res.json({ success: true, processed: results.length, results });
  } catch (e) {
    console.error('[API] web-research bulk:', e.message);
    res.status(500).json({ error: e.message || 'Bulk web research failed' });
  }
});

router.delete('/professors/:id', (req, res) => {
  db.prepare('DELETE FROM queue WHERE professor_id=?').run(req.params.id);
  db.prepare('DELETE FROM professors WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

router.put('/professor/:id', (req, res) => {
  const { full_name, last_name, university, interest_line, subject_keyword } = req.body;
  const mode = req.query.mode || 'instant';
  if (mode === 'scheduled' || mode === 'basic_scheduled') {
    const prof = db.prepare('SELECT id, dossier FROM scheduled_professors WHERE id=?').get(req.params.id);
    if (!prof) return res.status(404).json({ error: 'Scheduled professor not found' });
    let dossier = {};
    try { dossier = JSON.parse(prof.dossier || '{}'); } catch { dossier = {}; }
    const normalizedInterest = interest_line !== undefined ? normalizeInterestLineKeywords(interest_line || '') : undefined;
    const resolvedLastName = last_name || (full_name ? full_name.split(/\s+/).pop() : undefined);
    if (resolvedLastName !== undefined || university !== undefined || normalizedInterest !== undefined || subject_keyword !== undefined || full_name !== undefined) {
      dossier = {
        ...dossier,
        ...(full_name !== undefined ? { name: full_name } : {}),
        ...(resolvedLastName !== undefined ? { last_name: resolvedLastName } : {}),
        ...(university !== undefined ? { university } : {}),
        ...(subject_keyword !== undefined ? { subject_keyword } : {}),
        ...(normalizedInterest !== undefined ? {
          interest_line: normalizedInterest,
          research_areas: normalizedInterest ? normalizedInterest.split(/[,;|]/).map(s => s.trim()).filter(Boolean) : [],
        } : {}),
        roster: {
          ...(dossier.roster || {}),
          ...(full_name !== undefined ? { full_name } : {}),
          ...(resolvedLastName !== undefined ? { last_name: resolvedLastName } : {}),
          ...(university !== undefined ? { university } : {}),
          ...(subject_keyword !== undefined ? { subject_keyword } : {}),
          ...(normalizedInterest !== undefined ? { research_interest: normalizedInterest } : {}),
        },
      };
    }
    db.prepare('UPDATE scheduled_professors SET last_name=COALESCE(?, last_name), university=COALESCE(?, university), research_areas=COALESCE(?, research_areas), dossier=? WHERE id=?').run(
      resolvedLastName ?? null,
      university ?? null,
      normalizedInterest ?? null,
      JSON.stringify(dossier),
      req.params.id,
    );
    if (subject_keyword !== undefined || normalizedInterest !== undefined) {
      const draft = db.prepare("SELECT d.id, d.batch_id, b.batch_mode FROM scheduled_drafts d LEFT JOIN scheduled_batches b ON b.id=d.batch_id WHERE d.professor_id=? AND d.status IN ('draft','approved','needs_web_research') ORDER BY d.id DESC LIMIT 1").get(req.params.id);
      if (draft) {
        const isBasic = draft.batch_mode === 'basic_scheduled' || mode === 'basic_scheduled';
        const subject = subject_keyword
          ? (isBasic ? buildBasicOutreachSubject('search', subject_keyword) : buildOutreachSubject(subject_keyword, true))
          : undefined;
        const sets = [];
        const vals = [];
        if (subject !== undefined) { sets.push('subject=?'); vals.push(subject); }
        if (normalizedInterest !== undefined) { sets.push('interest_line=?'); vals.push(normalizedInterest); }
        if (sets.length) db.prepare(`UPDATE scheduled_drafts SET ${sets.join(', ')} WHERE id=?`).run(...vals, draft.id);
      }
    }
    return res.json(db.prepare('SELECT * FROM scheduled_professors WHERE id=?').get(req.params.id));
  }
  const prof = db.prepare('SELECT id, dossier FROM professors WHERE id=?').get(req.params.id);
  if (!prof) return res.status(404).json({ error: 'Professor not found' });
  let dossier = {};
  try { dossier = JSON.parse(prof.dossier || '{}'); } catch { dossier = {}; }
  if (full_name) {
    const ln = last_name || full_name.split(/\s+/).pop() || full_name;
    db.prepare('UPDATE professors SET last_name=? WHERE id=?').run(ln, req.params.id);
    dossier.name = full_name;
    dossier.last_name = ln;
    dossier.roster = { ...(dossier.roster || {}), full_name, last_name: ln };
  } else if (last_name) {
    db.prepare('UPDATE professors SET last_name=? WHERE id=?').run(last_name, req.params.id);
    dossier.last_name = last_name;
    dossier.roster = { ...(dossier.roster || {}), last_name };
  }
  if (university !== undefined) {
    db.prepare('UPDATE professors SET university=? WHERE id=?').run(university || '', req.params.id);
    dossier.university = university || '';
    dossier.roster = { ...(dossier.roster || {}), university: university || '' };
  }
  if (interest_line) {
    const normalizedInterest = normalizeInterestLineKeywords(interest_line);
    if (!normalizedInterest) return res.status(400).json({ error: 'Interest line is empty' });
    db.prepare('UPDATE professors SET research_areas=? WHERE id=?').run(normalizedInterest, req.params.id);
    dossier.interest_line = normalizedInterest;
    dossier.roster = { ...(dossier.roster || {}), research_interest: normalizedInterest };
    db.prepare('UPDATE queue SET interest_line=? WHERE professor_id=? AND mode=?').run(normalizedInterest, req.params.id, mode);
  }
  if (subject_keyword) {
    dossier.subject_keyword = subject_keyword;
    const settings = db.prepare('SELECT basic_subject_keyword, basic_search_subject_keyword FROM settings WHERE id=1').get() || {};
    const subjectMode = isBasicMode(mode) ? getBasicSubjectMode(settings) : 'search';
    const subject = isBasicMode(mode)
      ? buildBasicOutreachSubject(subjectMode, subject_keyword)
      : buildOutreachSubject(subject_keyword, true);
    db.prepare('UPDATE queue SET subject=? WHERE professor_id=? AND mode=?').run(
      subject,
      req.params.id,
      mode
    );
  }
  db.prepare('UPDATE professors SET dossier=? WHERE id=?').run(JSON.stringify(dossier), req.params.id);
  const updated = db.prepare('SELECT * FROM professors WHERE id=?').get(req.params.id);
  res.json(updated);
});

router.post('/roster/add', (req, res) => {
  try {
    const { email, full_name, last_name, university, subject_keyword, interest_line, mode = 'instant' } = req.body || {};
    const normalizedEmail = String(email || '').toLowerCase().trim();
    if (!normalizedEmail) return res.status(400).json({ error: 'email is required' });
    const normalizedInterest = normalizeInterestLineKeywords(interest_line || '');
    const resolvedLastName = String(last_name || full_name?.split(/\s+/).pop() || '').trim();
    const dossier = {
      email: normalizedEmail,
      name: full_name || resolvedLastName,
      last_name: resolvedLastName,
      university: String(university || '').trim() || universityFromEmail(normalizedEmail),
      subject_keyword: subject_keyword || '',
      interest_line: normalizedInterest,
      research_areas: normalizedInterest ? normalizedInterest.split(/[,;|]/).map(s => s.trim()).filter(Boolean) : [],
      research_source: 'roster',
      roster_import: true,
      name_verified: resolvedLastName.length >= 2,
      verified: resolvedLastName.length >= 2,
      roster: {
        full_name: full_name || '',
        last_name: resolvedLastName,
        university: String(university || '').trim(),
        research_interest: normalizedInterest,
      },
    };
    if (mode === 'scheduled' || mode === 'basic_scheduled') {
      const info = db.prepare(`
        INSERT INTO scheduled_professors (email, last_name, university, research_areas, dossier, batch_id)
        VALUES (?,?,?,?,?,NULL)
      `).run(normalizedEmail, resolvedLastName, dossier.university, normalizedInterest, JSON.stringify(dossier));
      return res.json({
        ok: true,
        mode,
        email: normalizedEmail,
        professor_id: info.lastInsertRowid,
        row: {
          id: info.lastInsertRowid,
          full_name: full_name || '',
          last_name: resolvedLastName,
          email: normalizedEmail,
          university: dossier.university,
          subject_keyword: subject_keyword || '',
          interest_line: normalizedInterest,
          queue_state: 'pending',
        },
      });
    }
    let prof = db.prepare('SELECT id FROM professors WHERE email=?').get(normalizedEmail);
    if (prof) {
      db.prepare('UPDATE professors SET last_name=?, university=?, research_areas=?, dossier=?, mode=? WHERE id=?').run(
        resolvedLastName,
        dossier.university,
        normalizedInterest,
        JSON.stringify(dossier),
        mode,
        prof.id,
      );
    } else {
      const info = db.prepare('INSERT INTO professors (email, last_name, university, research_areas, dossier, mode) VALUES (?,?,?,?,?,?)').run(
        normalizedEmail,
        resolvedLastName,
        dossier.university,
        normalizedInterest,
        JSON.stringify(dossier),
        mode,
      );
      prof = { id: info.lastInsertRowid };
    }
    const existingQueue = db.prepare("SELECT id FROM queue WHERE professor_id=? AND mode=? AND state NOT IN ('sent','skipped') ORDER BY id DESC LIMIT 1").get(prof.id, mode);
    if (!existingQueue) {
      db.prepare('INSERT INTO queue (professor_id, state, subject, interest_line, mode) VALUES (?,?,?,?,?)').run(
        prof.id,
        'pending',
        subject_keyword || null,
        normalizedInterest || null,
        mode,
      );
    }
    const row = upsertRosterRow({
      email: normalizedEmail,
      full_name: full_name || '',
      last_name: resolvedLastName,
      university: dossier.university,
      subject_keyword: subject_keyword || '',
      interest_line: normalizedInterest,
      queue_state: 'pending',
      research_status: 'manual',
      last_updated: new Date().toISOString(),
    }, { force: true });
    const saved = Array.isArray(row) ? row.find(r => String(r.email || '').toLowerCase() === normalizedEmail) : null;
    res.json({ ok: true, mode, email: normalizedEmail, professor_id: prof.id, row: saved || null });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not add roster row' });
  }
});

router.get('/queue', (req, res) => {
  try {
    const mode = req.query.mode || 'instant';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, parseInt(req.query.limit) || 500);
    const offset = (page - 1) * limit;
    res.json(db.prepare(`
      SELECT q.*, p.email as professor_email, p.last_name, p.university, p.dossier,
        COALESCE(json_extract(p.dossier, '$.roster.last_name'), json_extract(p.dossier, '$.last_name'), p.last_name, '') AS uploaded_last_name,
        COALESCE(json_extract(p.dossier, '$.subject_keyword'), '') AS uploaded_subject_keyword,
        COALESCE(json_extract(p.dossier, '$.interest_line'), json_extract(p.dossier, '$.roster.research_interest'), '') AS uploaded_interest_line,
        (SELECT df.failure_type FROM delivery_failures df
          WHERE (df.queue_id=q.id OR (df.queue_id IS NULL AND lower(df.professor_email)=lower(p.email) AND df.mode=q.mode))
          ORDER BY df.received_at DESC, df.id DESC LIMIT 1) AS failure_type,
        (SELECT df.reason FROM delivery_failures df
          WHERE (df.queue_id=q.id OR (df.queue_id IS NULL AND lower(df.professor_email)=lower(p.email) AND df.mode=q.mode))
          ORDER BY df.received_at DESC, df.id DESC LIMIT 1) AS failure_reason,
        (SELECT df.status FROM delivery_failures df
          WHERE (df.queue_id=q.id OR (df.queue_id IS NULL AND lower(df.professor_email)=lower(p.email) AND df.mode=q.mode))
          ORDER BY df.received_at DESC, df.id DESC LIMIT 1) AS failure_status,
        (SELECT seh.sent_at FROM sent_email_history seh
          WHERE seh.queue_id=q.id
          ORDER BY seh.sent_at DESC, seh.id DESC LIMIT 1) AS confirmed_sent_at,
        CASE WHEN EXISTS (
          SELECT 1 FROM sent_email_history seh
          WHERE lower(seh.professor_email)=lower(p.email)
            AND (seh.queue_id IS NULL OR seh.queue_id!=q.id)
        ) THEN 1 ELSE 0 END AS previously_contacted
      FROM queue q
      JOIN professors p ON q.professor_id=p.id AND q.mode=p.mode
      WHERE q.mode=?
        AND q.queue_group_id=(SELECT id FROM instant_queue_groups WHERE mode=? AND closed_at IS NULL ORDER BY queue_number DESC LIMIT 1)
      ORDER BY q.id DESC LIMIT ? OFFSET ?
    `).all(mode, mode, limit, offset));
  } catch (e) {
    console.error('[API] /queue:', e.message);
    res.status(500).json({ error: e.message || 'Failed to load queue' });
  }
});

router.post('/queue/clear-completed', (req, res) => {
  const mode = req.body.mode || req.query.mode || 'instant';
  res.json({ success: true, removed: 0, preserved: true });
  eventBus.publish({ type: 'queue_history_updated', mode, removed: 0 });
});

router.get('/instant-queues', (req, res) => {
  try {
    res.json(listInstantQueueGroups(req.query.mode || 'instant'));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load Instant queues' });
  }
});

router.get('/instant-queues/:id', (req, res) => {
  try {
    const result = getInstantQueueGroupRows(Number(req.params.id), req.query.mode || 'instant');
    if (!result) return res.status(404).json({ error: 'Instant queue not found' });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load Instant queue details' });
  }
});

router.post('/queue/:id/retry', (req, res) => {
  const item = db.prepare(`
    SELECT q.state, p.email
    FROM queue q JOIN professors p ON p.id=q.professor_id
    WHERE q.id=?
  `).get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Queue item not found' });
  if (item.state === 'sent') return res.status(400).json({ error: 'Cannot retry a sent item — would cause duplicate send' });
  if (findPriorOutreach(item.email)) {
    db.prepare("UPDATE queue SET state='skipped', error='duplicate_skipped', duplicate_override=0 WHERE id=?").run(req.params.id);
    return res.status(409).json({ error: 'Permanent duplicate protection: this professor was already contacted' });
  }
  db.prepare("UPDATE queue SET state='pending', error=NULL, retry_count=0 WHERE id=? AND state NOT IN ('sent','sending')").run(req.params.id);
  ensureWorkersRunning();
  res.json({ success: true });
});

router.post('/queue/:id/send', async (req, res) => {
  db.prepare("UPDATE queue SET state='pending', error=NULL WHERE id=? AND state IN ('verified','awaiting_proceed')").run(req.params.id);
  res.json({ success: true });
});

// ── Manual approval routes ────────────────────────────────────────
// Approve: mark as pending for immediate send
router.post('/queue/:id/approve', (req, res) => {
  const item = db.prepare('SELECT id, state FROM queue WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Queue item not found' });
  if (!['verified', 'awaiting_proceed', 'drafted'].includes(item.state)) {
    return res.status(400).json({ error: `Cannot approve item in '${item.state}' state` });
  }
  db.prepare("UPDATE queue SET state='pending', error=NULL, fast_track=1 WHERE id=?").run(req.params.id);
  prioritizeQueue(Number(req.params.id));
  eventBus.publish({ type: 'state_change', id: Number(req.params.id), state: 'pending', fast_track: true });
  res.json({ success: true });
});

// Reject: mark as failed (won't send)
router.post('/queue/:id/reject', (req, res) => {
  const item = db.prepare('SELECT id, state FROM queue WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Queue item not found' });
  if (item.state === 'sent') return res.status(400).json({ error: 'Cannot reject a sent item' });
  db.prepare("UPDATE queue SET state='skipped', error='rejected_by_user' WHERE id=?").run(req.params.id);
  eventBus.publish({ type: 'skipped', mode: 'instant', id: Number(req.params.id), error: 'rejected_by_user' });
  res.json({ success: true });
});

// Duplicate outreach is permanently blocked.
router.post('/queue/:id/process', (req, res) => {
  const item = db.prepare('SELECT id FROM queue WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Queue item not found' });
  db.prepare("UPDATE queue SET state='skipped', error='duplicate_skipped', duplicate_override=0 WHERE id=?").run(req.params.id);
  return res.status(409).json({ error: 'Permanent duplicate protection: duplicate emails cannot be processed again' });
});

// Delivery-failure resends use their separate one-time confirmed flow.
router.post('/queue/:id/send-again', (req, res) => {
  const item = db.prepare('SELECT id FROM queue WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Queue item not found' });
  db.prepare("UPDATE queue SET state='skipped', error='duplicate_skipped', duplicate_override=0 WHERE id=?").run(req.params.id);
  return res.status(409).json({ error: 'Permanent duplicate protection: this professor was already contacted' });
});

// Edit subject, interest line, professor email, and custom HTML body for a pending/awaiting item
router.put('/queue/:id/edit', (req, res) => {
  const { subject, interest_line, professor_email, custom_html } = req.body;
  const item = db.prepare('SELECT id, state, professor_id FROM queue WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Queue item not found' });
  if (!['verified', 'awaiting_proceed', 'drafted'].includes(item.state)) {
    return res.status(400).json({ error: `Cannot edit item in '${item.state}' state` });
  }

  const updates = [];
  const vals = [];
  if (subject) { updates.push('subject=?'); vals.push(subject); }
  if (interest_line) {
    const normalizedInterest = normalizeInterestLineKeywords(interest_line);
    if (!normalizedInterest) return res.status(400).json({ error: 'Interest line is empty' });
    updates.push('interest_line=?');
    vals.push(normalizedInterest);
  }
  if (custom_html) { updates.push('custom_html=?'); vals.push(custom_html); }
  if (professor_email && item.professor_id) {
    db.prepare('UPDATE professors SET email=? WHERE id=?').run(professor_email, item.professor_id);
  }
  if (updates.length === 0 && !professor_email) return res.status(400).json({ error: 'No fields to update' });

  if (updates.length > 0) {
    vals.push(req.params.id);
    db.prepare(`UPDATE queue SET ${updates.join(',')} WHERE id=?`).run(...vals);
  }
  const finalSubject = subject || (db.prepare('SELECT subject FROM queue WHERE id=?').get(req.params.id)?.subject);
  const finalInterest = interest_line || (db.prepare('SELECT interest_line FROM queue WHERE id=?').get(req.params.id)?.interest_line);
  const finalEmail = professor_email || (db.prepare('SELECT p.email FROM professors p WHERE p.id=?').get(item.professor_id)?.email);
  eventBus.publish({ type: 'compose_update', mode: 'instant', id: Number(req.params.id), subject: finalSubject, interest_line: finalInterest, professor_email: finalEmail, state: item.state });
  res.json({ success: true });
});

// Delete queue item completely
router.delete('/queue/:id', (req, res) => {
  const item = db.prepare('SELECT id, state FROM queue WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Queue item not found' });
  if (item.state === 'sent') return res.status(400).json({ error: 'Cannot delete a sent item' });
  db.prepare('DELETE FROM queue WHERE id=?').run(req.params.id);
  eventBus.publish({ type: 'state_change', id: Number(req.params.id), state: 'deleted' });
  res.json({ success: true });
});

router.post('/queue/:id/proceed', async (req, res) => {
  const row = db.prepare('SELECT q.state, q.mode, p.email as professor_email FROM queue q JOIN professors p ON q.professor_id=p.id WHERE q.id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Queue item not found' });

  const ok = PipelineService.proceed(req.params.id);
  if (!ok) return res.status(400).json({ error: `Cannot proceed item in '${row.state}' state` });

  db.prepare("UPDATE settings SET auto_send=1 WHERE id=1").run();

  res.json({ success: true, message: 'Agent processing now', professor_email: row.professor_email });

  const itemMode = row.mode || 'instant';
  GmailService.tryAutoLoadTemplate('proceed_now', itemMode)
    .then(result => {
      if (result.success) eventBus.publish({ type: 'template_loaded', source: 'proceed_now', mode: itemMode });
    })
    .catch(e => console.error('[Proceed] Template load failed:', e.message));
});

router.get('/queue/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write('data: {"type":"connected"}\n\n');
  eventBus.addClient(res);
  req.on('close', () => eventBus.removeClient(res));
});

router.get('/roster.xlsx', (req, res) => {
  try {
    const mode = req.query.mode || 'instant';
    let buffer;
    const now = Date.now();
    const workspace = getActiveWorkspace().key;
    if (mode === 'instant' && rosterCache.buffer && rosterCache.workspace === workspace && now - rosterCache.timestamp <= 30000) {
      buffer = rosterCache.buffer;
    } else {
      const rows = (mode === 'instant' || mode === 'basic_instant')
        ? readRosterExcel()
        : buildRosterRows(mode);
      buffer = rosterToXlsxBuffer(rows);
      if (mode === 'instant') {
        rosterCache.buffer = buffer;
        rosterCache.timestamp = now;
        rosterCache.workspace = workspace;
      }
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="professor-roster.xlsx"');
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/roster/sheet', (req, res) => {
  try {
    const mode = req.query.mode || 'instant';
    const sheetRows = readRosterExcel();
    if (!sheetRows.length) return res.json([]);
    const dbRows = buildRosterRows(mode);
    const byEmail = new Map(dbRows.map(r => [(r.email || '').toLowerCase(), r]));
    const preserved = sheetRows.map(r => {
      const dbRow = byEmail.get((r.email || '').toLowerCase());
      if (!dbRow) return r;
      return {
        ...r,
        id: dbRow.id,
      };
    });
    res.json(preserved);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/roster/:id', (req, res) => {
  const mode = req.query.mode || 'instant';
  const professor = db.prepare('SELECT id, email FROM professors WHERE id=? AND mode=?').get(req.params.id, mode);
  if (!professor) return res.status(404).json({ error: 'Roster row not found' });
  const sent = db.prepare("SELECT COUNT(*) AS c FROM queue WHERE professor_id=? AND mode=? AND state='sent'").get(professor.id, mode).c;
  if (sent) return res.status(400).json({ error: 'Sent history is permanent; this roster row cannot be deleted' });
  db.transaction(() => {
    db.prepare('DELETE FROM queue WHERE professor_id=? AND mode=?').run(professor.id, mode);
    db.prepare('DELETE FROM professors WHERE id=? AND mode=?').run(professor.id, mode);
  })();
  removeRosterRow(professor.email);
  eventBus.publish({ type: 'roster_row_deleted', mode, id: professor.id, email: professor.email });
  res.json({ success: true });
});

router.get('/roster', (req, res) => {
  try {
    const mode = req.query.mode || 'instant';
    res.json(buildRosterRows(mode));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/roster.csv', (req, res) => {
  try {
    const mode = req.query.mode || 'instant';
    const rows = buildRosterRows(mode);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="professor-roster.csv"');
    res.send(rosterToCsv(rows));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/agent-context', (req, res) => {
  const mode = req.query.mode || 'instant';
  res.json(getAgentContext(mode));
});

router.get('/analytics', (req, res) => {
  try {
    res.json(getAnalytics());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/university-outreach', (req, res) => {
  try {
    res.json(getUniversityOutreach());
  } catch (e) {
    console.error('[API] /university-outreach:', e.message);
    res.status(500).json({ error: e.message || 'Failed to load university outreach' });
  }
});

router.get('/delivery-failures', (req, res) => {
  try {
    const mode = req.query.mode || null;
    const rows = db.prepare(`
      SELECT df.*
      FROM delivery_failures df
      WHERE (? IS NULL OR mode=?)
      ORDER BY received_at DESC, id DESC
      LIMIT 200
    `).all(mode, mode);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load delivery failures' });
  }
});

router.post('/delivery-failures/scan', requireGmail, async (req, res) => {
  try {
    const before = db.prepare('SELECT COUNT(*) as c FROM delivery_failures').get().c;
    const result = await GmailService.classifyInboxReplies({ maxResults: 500 });
    const after = db.prepare('SELECT COUNT(*) as c FROM delivery_failures').get().c;
    res.json({
      success: true,
      imported: Math.max(0, after - before),
      scanned: result.scanned || 0,
      total: after,
      message: `Scanned ${result.scanned || 0} Gmail messages from the last 72 hours; imported ${Math.max(0, after - before)} new failure(s)`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Delivery failure scan failed' });
  }
});

async function sendDeliveryFailure(row) {
  if (!row) throw new Error('Failure not found');
  if (row.status !== 'pending') throw new Error(`Failure is already ${row.status}`);
  const claimed = db.prepare(
    "UPDATE delivery_failures SET status='sending' WHERE id=? AND status='pending'"
  ).run(row.id);
  if (!claimed.changes) throw new Error('Failure is already being processed');
  try {
  const linkedDraftId = row.draft_id || db.prepare(`
    SELECT d.id
    FROM scheduled_drafts d
    JOIN scheduled_professors sp ON sp.id=d.professor_id
    WHERE lower(sp.email)=lower(?)
    ORDER BY d.id DESC
    LIMIT 1
  `).get(row.professor_email)?.id;
  if (!linkedDraftId) throw new Error('No saved draft is linked to this failure');
  const draft = db.prepare(`
    SELECT d.*, sp.id as prof_id, sp.email as professor_email, b.batch_mode
    FROM scheduled_drafts d
    JOIN scheduled_professors sp ON sp.id=d.professor_id
    JOIN scheduled_batches b ON b.id=d.batch_id
    WHERE d.id=?
  `).get(linkedDraftId);
  if (!draft) throw new Error('Linked scheduled draft not found');
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
    confirmedFailureResend: true,
  });
  db.prepare("UPDATE scheduled_drafts SET status='sent', error=NULL WHERE id=?").run(draft.id);
  db.prepare(`
    INSERT INTO scheduled_sent_log (professor_email, subject, topic, message_id, sent_at, batch_id, draft_id)
    VALUES (?, ?, '', ?, datetime('now'), ?, ?)
  `).run(draft.professor_email, draft.subject, result?.id || null, draft.batch_id, draft.id);
  db.prepare(`
    UPDATE delivery_failures
    SET status='resent', resent_at=datetime('now'), resent_message_id=?
    WHERE id=? AND status='sending'
  `).run(result?.id || null, row.id);
  eventBus.publish({
    type: 'scheduled_draft_sent',
    mode: 'scheduled',
    batchId: draft.batch_id,
    draftId: draft.id,
    professor: draft.professor_email,
    subject: draft.subject,
  });
  return { id: row.id, email: draft.professor_email, messageId: result?.id || null };
  } catch (error) {
    db.prepare("UPDATE delivery_failures SET status='pending' WHERE id=? AND status='sending'").run(row.id);
    throw error;
  }
}

router.post('/delivery-failures/:id/send', requireGmail, async (req, res) => {
  const row = db.prepare('SELECT * FROM delivery_failures WHERE id=?').get(req.params.id);
  try {
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'Explicit resend confirmation is required' });
    clearScheduledAbort();
    const result = await sendDeliveryFailure(row);
    res.json({
      success: true,
      sent: 1,
      result,
      message: 'Email resent once; this failure is now closed',
    });
  } catch (e) {
    if (isSendLimitError(e)) {
      eventBus.publish({ type: 'scheduled_send_limit_reached', mode: 'scheduled', error: e.message });
    }
    res.status(500).json({ error: e.message || 'Send failed' });
  }
});

router.post('/delivery-failures/send-all', requireGmail, async (req, res) => {
  const failureType = req.body?.failure_type || null;
  const params = failureType ? [failureType] : [];
  const rows = db.prepare(`
    SELECT df.* FROM delivery_failures df
    WHERE status='pending' ${failureType ? 'AND failure_type=?' : ''}
    ORDER BY received_at ASC, id ASC
  `).all(...params);
  let sent = 0;
  const failed = [];
  clearScheduledAbort();
  for (const row of rows) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await sendDeliveryFailure(row);
      sent++;
    } catch (e) {
      failed.push({ id: row.id, email: row.professor_email, error: e.message });
      if (isSendLimitError(e)) {
        eventBus.publish({ type: 'scheduled_send_limit_reached', mode: 'scheduled', error: e.message });
        break;
      }
    }
  }
  res.json({ success: true, sent, failed, total: rows.length });
});

router.post('/delivery-failures/reject-all', (req, res) => {
  const failureType = req.body?.failure_type || null;
  const result = failureType
    ? db.prepare("UPDATE delivery_failures SET status='rejected', rejected_at=datetime('now') WHERE status='pending' AND failure_type=?").run(failureType)
    : db.prepare("UPDATE delivery_failures SET status='rejected', rejected_at=datetime('now') WHERE status='pending'").run();
  if (result.changes) eventBus.publish({ type: 'delivery_failure_updated', mode: 'scheduled' });
  res.json({ success: true, rejected: result.changes });
});

router.post('/delivery-failures/:id/reject', (req, res) => {
  const row = db.prepare('SELECT id, mode, status FROM delivery_failures WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Failure not found' });
  if (row.status !== 'pending') return res.status(409).json({ error: `Failure is already ${row.status}` });
  const result = db.prepare(`
    UPDATE delivery_failures
    SET status='rejected', rejected_at=datetime('now')
    WHERE id=? AND status='pending'
  `).run(row.id);
  if (!result.changes) return res.status(409).json({ error: 'Failure was already handled' });
  eventBus.publish({ type: 'delivery_failure_updated', mode: row.mode || 'scheduled', id: row.id, status: 'rejected' });
  return res.json({ success: true, rejected: 1, message: 'Failure rejected permanently' });
});

router.put('/delivery-failures/:id/email', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
  const row = db.prepare('SELECT * FROM delivery_failures WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Failure not found' });
  db.prepare('UPDATE delivery_failures SET professor_email=? WHERE id=?').run(email, row.id);
  if (row.draft_id) {
    db.prepare(`
      UPDATE scheduled_professors
      SET email=?
      WHERE id=(SELECT professor_id FROM scheduled_drafts WHERE id=?)
    `).run(email, row.draft_id);
  }
  res.json({ success: true, email });
});

router.post('/delivery-failures/:id/inquire', async (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM delivery_failures WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Failure not found' });
    const existing = db.prepare(`
      SELECT email, university, source_url, dossier FROM professors WHERE lower(email)=lower(?)
      UNION ALL
      SELECT email, university, source_url, dossier FROM scheduled_professors WHERE lower(email)=lower(?)
      LIMIT 1
    `).get(row.professor_email, row.professor_email);
    let summary = '';
    try {
      const dossier = await runWebResearchForProfessor(
        row.professor_email,
        existing?.source_url || '',
        existing?.source_url || '',
        existing?.dossier ? JSON.parse(existing.dossier) : {},
      );
      summary = dossier?.profile_url
        ? `Profile found: ${dossier.profile_url}`
        : `Checked web profile signals for ${row.professor_email}`;
    } catch (e) {
      summary = `Inquiry completed, but no verified active profile was found: ${e.message}`;
    }
    db.prepare("UPDATE delivery_failures SET inquiry_status='checked', inquiry_summary=?, inquiry_checked_at=datetime('now') WHERE id=?").run(summary, row.id);
    res.json({ success: true, id: row.id, inquiry_status: 'checked', inquiry_summary: summary });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Inquiry failed' });
  }
});

router.get('/stats', (req, res) => {
  try {
    const mode = req.query.mode || 'instant';
    const scrape = getScrapeStatus();
    const activeQueueGroupId = latestInstantQueueGroup(mode)?.id || -1;
    const queueStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN state='sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN state='pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN state='awaiting_proceed' THEN 1 ELSE 0 END) as awaitingProceed,
      SUM(CASE WHEN state='duplicate_review' THEN 1 ELSE 0 END) as duplicateReview,
      SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN state='researching' THEN 1 ELSE 0 END) as researching,
      SUM(CASE WHEN state='drafted' THEN 1 ELSE 0 END) as drafted,
      SUM(CASE WHEN state='verified' THEN 1 ELSE 0 END) as verified,
      SUM(CASE WHEN state='skipped' THEN 1 ELSE 0 END) as skipped
    FROM queue WHERE mode=? AND queue_group_id=?
  `).get(mode, activeQueueGroupId);
    res.json({
      ...queueStats,
      ...getDeliveryFailureStats(mode),
      replied: db.prepare("SELECT COUNT(*) as c FROM replies WHERE mode=?").get(mode).c,
      todaySent: (() => {
        const now = new Date();
        const todayLocal = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        return db.prepare("SELECT COUNT(*) as c FROM sent_email_history WHERE date(sent_at)=?").get(todayLocal).c;
      })(),
      totalSent: db.prepare("SELECT COUNT(*) as c FROM sent_email_history").get().c,
      uniqueSentEmails: db.prepare("SELECT COUNT(DISTINCT professor_email) as c FROM sent_email_history").get().c,
      weekSent: db.prepare("SELECT COUNT(*) as c FROM sent_email_history WHERE sent_at >= datetime('now', '-7 days')").get().c,
      queueSize: db.prepare("SELECT COUNT(*) as c FROM queue WHERE queue_group_id=? AND state IN ('pending','awaiting_proceed','duplicate_review','researching','drafted','verified','sending')").get(activeQueueGroupId).c,
      scheduledBatches: db.prepare("SELECT COUNT(*) as c FROM scheduled_batches WHERE status IN ('pending','processing','drafted','scheduled','sending')").get().c,
      scraping: scrape.running ? 1 : 0,
      scrapePhase: scrape.phase || null,
      sessionEpoch: getSessionEpoch(db),
    });
  } catch (e) {
    console.error('[API] /stats:', e.message);
    res.status(500).json({ error: e.message || 'Failed to load stats' });
  }
});

// API usage monitoring endpoint
router.get('/api-usage', (req, res) => {
  try {
    const requestedMode = String(req.query.mode || 'instant');
    const mode = ['instant', 'basic_instant', 'scheduled', 'basic_scheduled'].includes(requestedMode)
      ? requestedMode
      : 'instant';
    const scheduledMode = mode === 'scheduled' || mode === 'basic_scheduled';
    const tokenUsage = getTokenUsage();
    const apiStats = getApiStats();
    const totalTokens = getTotalQwenTokens();

    const flatUsage = { ...(tokenUsage.output || {}), ...(tokenUsage.reasoning || {}) };

    const sourceTokens = {};
    for (const [key, tokens] of Object.entries(flatUsage)) {
      const source = key.includes('@') ? key.split('@').pop() : 'openai';
      sourceTokens[source] = (sourceTokens[source] || 0) + (Number(tokens) || 0);
    }
    const usedTokens = Object.values(sourceTokens).reduce((sum, value) => sum + value, 0);
    const activeSources = [
      ...config.qwenSources.map(source => source.source),
      ...config.geminiSources.map(source => source.source),
      ...(config.openaiApiKey ? ['openai'] : []),
    ];
    const sendBlock = getOutboundSendBlock();
    const activeQueueGroupId = scheduledMode ? -1 : (latestInstantQueueGroup(mode)?.id || -1);
    const queueCounts = scheduledMode ? null : db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN state='pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN state IN ('researching','drafted','verified','sending') THEN 1 ELSE 0 END) AS processing,
        SUM(CASE WHEN state IN ('awaiting_proceed','needs_review') THEN 1 ELSE 0 END) AS review,
        SUM(CASE WHEN state='duplicate_review' OR error='duplicate_skipped' THEN 1 ELSE 0 END) AS duplicates,
        SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) AS failed
      FROM queue WHERE mode=? AND queue_group_id=?
    `).get(mode, activeQueueGroupId);
    const failureCounts = db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status='pending' AND failure_type='not_found' THEN 1 ELSE 0 END) AS notFound,
        SUM(CASE WHEN status='pending' AND failure_type='send_limit' THEN 1 ELSE 0 END) AS sendLimit
      FROM delivery_failures
      WHERE mode=?
    `).get(scheduledMode ? 'scheduled' : mode);
    const modeReplyCounts = db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN classification='positive' THEN 1 ELSE 0 END) AS positive,
        SUM(CASE WHEN classification='negative' THEN 1 ELSE 0 END) AS negative,
        SUM(CASE WHEN classification='auto_reply' THEN 1 ELSE 0 END) AS autoReply
      FROM replies WHERE mode=?
    `).get(scheduledMode ? 'scheduled' : mode);
    const modeBatchCounts = db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status='scheduled' THEN 1 ELSE 0 END) AS scheduled,
        SUM(CASE WHEN status IN ('pending','processing') THEN 1 ELSE 0 END) AS processing,
        SUM(CASE WHEN status='drafted' THEN 1 ELSE 0 END) AS review,
        SUM(CASE WHEN status='sending' THEN 1 ELSE 0 END) AS sending,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
      FROM scheduled_batches
      WHERE status!='cancelled' AND COALESCE(batch_mode, 'scheduled')=?
    `).get(scheduledMode ? mode : 'scheduled');

    res.json({
      keyMode: config.aiKeyMode || 'global',
      activeSources,
      apiCalls: apiStats,
      tokens: {
        bySource: sourceTokens,
        total: usedTokens,
        available: totalTokens,
        usage: tokenUsage,
      },
      balance: {
        callDifference: 0,
        tokenDifference: 0,
        isBalanced: true,
      },
      operational: {
        mode,
        queue: queueCounts,
        failures: {
          total: Number(failureCounts.total) || 0,
          pending: Number(failureCounts.pending) || 0,
          notFound: Number(failureCounts.notFound) || 0,
          sendLimit: Number(failureCounts.sendLimit) || 0,
        },
        replies: {
          total: Number(modeReplyCounts.total) || 0,
          positive: Number(modeReplyCounts.positive) || 0,
          negative: Number(modeReplyCounts.negative) || 0,
          autoReply: Number(modeReplyCounts.autoReply) || 0,
        },
        batches: {
          scheduled: Number(modeBatchCounts.scheduled) || 0,
          total: Number(modeBatchCounts.total) || 0,
          processing: Number(modeBatchCounts.processing) || 0,
          review: Number(modeBatchCounts.review) || 0,
          sending: Number(modeBatchCounts.sending) || 0,
          completed: Number(modeBatchCounts.completed) || 0,
          failed: Number(modeBatchCounts.failed) || 0,
        },
        gmail: {
          available: !sendBlock,
          code: sendBlock?.code || null,
          reason: sendBlock?.reason || null,
          resetAt: sendBlock?.retryAt || null,
        },
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    console.error('[API] /api-usage:', e.message);
    res.status(500).json({ error: e.message || 'Failed to load API usage' });
  }
});

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function textTemplateToHtml(template) {
  return String(template || '')
    .split(/\n{2,}/)
    .map(block => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function resolveReplyLastName(reply) {
  const stored = db.prepare(`
    SELECT last_name FROM (
      SELECT last_name, 1 AS priority FROM sent_email_history
      WHERE lower(professor_email)=lower(?) AND last_name IS NOT NULL AND last_name!=''
      UNION ALL
      SELECT last_name, 2 AS priority FROM professors
      WHERE lower(email)=lower(?) AND last_name IS NOT NULL AND last_name!=''
      UNION ALL
      SELECT last_name, 3 AS priority FROM scheduled_professors
      WHERE lower(email)=lower(?) AND last_name IS NOT NULL AND last_name!=''
    ) ORDER BY priority LIMIT 1
  `).get(reply.professor_email, reply.professor_email, reply.professor_email);
  return stored?.last_name || lastNameFromEmail(reply.professor_email) || '';
}

function personalizeScenario(reply, scenario) {
  const lastName = resolveReplyLastName(reply);
  const originalSubject = String(reply.original_subject || 'Your Email').replace(/^(?:Re:\s*)+/i, '');
  const subject = String(scenario.subject_template || 'Re: {{ORIGINAL_SUBJECT}}')
    .replace(/\{\{ORIGINAL_SUBJECT\}\}/g, originalSubject)
    .replace(/\[Original Subject\]/gi, originalSubject);
  const body = String(scenario.body_template || '')
    .replace(/\[Last Name\]|\{\{LAST_NAME\}\}/gi, lastName);
  return { subject, html: textTemplateToHtml(body), lastName };
}

router.get('/reply-scenarios', (req, res) => {
  res.json(db.prepare(`
    SELECT rs.*,
      (SELECT COUNT(*) FROM replies r WHERE r.scenario_id=rs.id) AS reply_count
    FROM reply_scenarios rs
    ORDER BY rs.sort_order, rs.id
  `).all());
});

router.post('/reply-scenarios', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const bodyTemplate = String(req.body?.body_template || '').trim();
  if (!name || !bodyTemplate) return res.status(400).json({ error: 'Scenario name and body template are required' });
  try {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM reply_scenarios').get().value;
    const info = db.prepare(`
      INSERT INTO reply_scenarios
        (name, description, subject_template, body_template, active, built_in, sort_order)
      VALUES (?, ?, ?, ?, 1, 0, ?)
    `).run(
      name,
      String(req.body?.description || '').trim(),
      String(req.body?.subject_template || 'Re: {{ORIGINAL_SUBJECT}}').trim(),
      bodyTemplate,
      maxOrder + 1,
    );
    eventBus.publish({ type: 'reply_scenarios_updated' });
    res.json({ success: true, scenario: db.prepare('SELECT * FROM reply_scenarios WHERE id=?').get(info.lastInsertRowid) });
  } catch (e) {
    res.status(400).json({ error: e.message.includes('UNIQUE') ? 'A scenario with this name already exists' : e.message });
  }
});

router.put('/reply-scenarios/:id', (req, res) => {
  const scenario = db.prepare('SELECT * FROM reply_scenarios WHERE id=?').get(req.params.id);
  if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
  const name = String(req.body?.name ?? scenario.name).trim();
  const bodyTemplate = String(req.body?.body_template ?? scenario.body_template).trim();
  if (!name || !bodyTemplate) return res.status(400).json({ error: 'Scenario name and body template are required' });
  db.prepare(`
    UPDATE reply_scenarios
    SET name=?, description=?, subject_template=?, body_template=?, active=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    name,
    String(req.body?.description ?? scenario.description ?? '').trim(),
    String(req.body?.subject_template ?? scenario.subject_template ?? 'Re: {{ORIGINAL_SUBJECT}}').trim(),
    bodyTemplate,
    req.body?.active === undefined ? scenario.active : (req.body.active ? 1 : 0),
    scenario.id,
  );
  eventBus.publish({ type: 'reply_scenarios_updated' });
  res.json({ success: true, scenario: db.prepare('SELECT * FROM reply_scenarios WHERE id=?').get(scenario.id) });
});

router.get('/replies', (req, res) => {
  const mode = req.query.mode || 'instant';
  res.json(db.prepare(`
    WITH recent_replies AS (
      SELECT *
      FROM replies
      WHERE mode=?
      ORDER BY received_at DESC, id DESC
      LIMIT 500
    )
    SELECT r.*,
      COALESCE(r.original_subject, (
        SELECT sl.subject FROM sent_log sl
        WHERE lower(sl.professor_email)=lower(r.professor_email) AND sl.mode=r.mode
        ORDER BY sl.sent_at DESC LIMIT 1
      )) AS original_subject,
      rs.name AS scenario_name,
      rs.body_template AS scenario_body_template,
      rs.subject_template AS scenario_subject_template,
      COALESCE((
        SELECT seh.last_name FROM sent_email_history seh
        WHERE lower(seh.professor_email)=lower(r.professor_email)
          AND seh.last_name IS NOT NULL AND seh.last_name!=''
        ORDER BY seh.sent_at DESC LIMIT 1
      ), (
        SELECT p.last_name FROM professors p
        WHERE lower(p.email)=lower(r.professor_email) LIMIT 1
      ), '') AS professor_last_name
    FROM recent_replies r
    LEFT JOIN reply_scenarios rs ON rs.id=r.scenario_id
    ORDER BY r.received_at DESC, r.id DESC
  `).all(mode));
});

router.post('/replies/scan', requireGmail, async (req, res) => {
  try {
    const result = await GmailService.classifyInboxReplies({
      maxResults: Number(req.body?.maxResults) || 250,
    });
    eventBus.publish({ type: 'reply_scan_complete', ...result });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/replies/:id/suggest', async (req, res) => {
  try {
    const reply = db.prepare('SELECT * FROM replies WHERE id=?').get(req.params.id);
    if (!reply) return res.status(404).json({ error: 'Reply not found' });
    if (['sending', 'sent', 'rejected'].includes(reply.workflow_status)) {
      return res.status(400).json({ error: `Cannot draft a ${reply.workflow_status} reply` });
    }

    const sentLog = db.prepare('SELECT subject FROM sent_log WHERE professor_email=? AND mode=? ORDER BY sent_at DESC LIMIT 1').get(reply.professor_email, reply.mode);
    const original_subject = sentLog?.subject || reply.original_subject || '';

    const scenario = reply.scenario_id
      ? db.prepare('SELECT * FROM reply_scenarios WHERE id=? AND active=1').get(reply.scenario_id)
      : null;
    const result = scenario
      ? (() => {
        const draft = personalizeScenario({ ...reply, original_subject }, scenario);
        return { suggested_reply_html: draft.html, reply_subject: draft.subject };
      })()
      : await suggestReply({
        professor_email: reply.professor_email,
        original_subject,
        reply_classification: reply.classification,
        reply_summary: reply.summary,
        original_email_html: reply.reply_body,
        style_samples: await fetchUserReplyStyleSamples({ maxSamples: 3 }).catch(() => []),
      });

    db.prepare("UPDATE replies SET suggested_reply=?, reply_subject=?, original_subject=?, workflow_status='drafted' WHERE id=?")
      .run(result.suggested_reply_html, result.reply_subject, original_subject, req.params.id);
    eventBus.publish({ type: 'reply_updated', id: reply.id, mode: reply.mode });

    res.json({
      success: true,
      suggested_reply: result.suggested_reply_html,
      reply_subject: result.reply_subject,
      original_subject,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/replies/:id/scenario', (req, res) => {
  const reply = db.prepare('SELECT * FROM replies WHERE id=?').get(req.params.id);
  if (!reply) return res.status(404).json({ error: 'Reply not found' });
  const scenario = db.prepare('SELECT * FROM reply_scenarios WHERE id=? AND active=1').get(req.body?.scenario_id);
  if (!scenario) return res.status(404).json({ error: 'Active scenario not found' });
  if (['sending', 'sent', 'rejected'].includes(reply.workflow_status)) {
    db.prepare(`
      UPDATE replies SET scenario_id=?, scenario_confidence=1 WHERE id=?
    `).run(scenario.id, reply.id);
  } else {
    const draft = personalizeScenario(reply, scenario);
    db.prepare(`
      UPDATE replies
      SET scenario_id=?, scenario_confidence=1, suggested_reply=?, reply_subject=?, workflow_status='drafted'
      WHERE id=?
    `).run(scenario.id, draft.html, draft.subject, reply.id);
  }
  eventBus.publish({ type: 'reply_updated', id: reply.id, mode: reply.mode });
  res.json({ success: true, reply: db.prepare('SELECT * FROM replies WHERE id=?').get(reply.id) });
});

router.post('/replies/:id/send', requireGmail, async (req, res) => {
  let claimedReplyId = null;
  try {
    const reply = db.prepare('SELECT * FROM replies WHERE id=?').get(req.params.id);
    if (!reply) return res.status(404).json({ error: 'Reply not found' });
    if (reply.reply_sent || reply.workflow_status === 'sent') return res.status(400).json({ error: 'Already sent' });
    if (reply.workflow_status === 'rejected') return res.status(400).json({ error: 'Rejected replies cannot be sent' });

    const html = req.body.html || reply.suggested_reply;
    if (!html) return res.status(400).json({ error: 'No reply content to send — generate or provide a draft first' });

    const subject = req.body.subject || reply.reply_subject || `Re: ${reply.original_subject || 'Your Email'}`;
    const attachmentPath = req.body.attachment || null;
    const claimed = db.prepare(`
      UPDATE replies SET workflow_status='sending'
      WHERE id=? AND workflow_status NOT IN ('sending','sent','rejected') AND reply_sent=0
    `).run(reply.id);
    if (!claimed.changes) return res.status(409).json({ error: 'Reply is already being processed' });
    claimedReplyId = reply.id;

    const result = await sendReplyEmail({
      to: reply.professor_email,
      subject,
      html,
      attachmentPath,
      threadId: reply.thread_id,
      replyHeaders: await getMessageReplyHeaders(reply.gmail_message_id),
    });

    db.prepare(`
      UPDATE replies
      SET reply_sent=1, replied_by_user=1, workflow_status='sent',
          reply_sent_at=datetime('now'), sent_message_id=?,
          suggested_reply=?, reply_subject=?
      WHERE id=?
    `).run(result.id || null, html, subject, req.params.id);
    eventBus.publish({ type: 'reply_updated', id: reply.id, mode: reply.mode });

    res.json({ success: true, messageId: result.id });
  } catch (e) {
    if (claimedReplyId) {
      db.prepare(`
        UPDATE replies SET workflow_status=CASE WHEN suggested_reply IS NULL THEN 'new' ELSE 'drafted' END
        WHERE id=? AND workflow_status='sending'
      `).run(claimedReplyId);
    }
    res.status(e.status || 500).json({ error: e.message, code: e.code });
  }
});

router.put('/replies/:id/draft', (req, res) => {
  const reply = db.prepare('SELECT * FROM replies WHERE id=?').get(req.params.id);
  if (!reply) return res.status(404).json({ error: 'Reply not found' });

  const { suggested_reply, reply_subject } = req.body;
  if (['sending', 'sent', 'rejected'].includes(reply.workflow_status)) {
    return res.status(400).json({ error: `Cannot edit a ${reply.workflow_status} reply` });
  }
  db.prepare(`
    UPDATE replies
    SET suggested_reply=COALESCE(?, suggested_reply),
        reply_subject=COALESCE(?, reply_subject),
        workflow_status='drafted'
    WHERE id=?
  `)
    .run(suggested_reply, reply_subject, req.params.id);

  const updated = db.prepare('SELECT * FROM replies WHERE id=?').get(req.params.id);
  eventBus.publish({ type: 'reply_updated', id: reply.id, mode: reply.mode });
  res.json({ success: true, reply: updated });
});

router.post('/replies/:id/gmail-draft', requireGmail, async (req, res) => {
  try {
    const reply = db.prepare('SELECT * FROM replies WHERE id=?').get(req.params.id);
    if (!reply) return res.status(404).json({ error: 'Reply not found' });
    if (['sending', 'sent', 'rejected'].includes(reply.workflow_status)) {
      return res.status(400).json({ error: `Cannot draft a ${reply.workflow_status} reply` });
    }
    const html = req.body?.html || reply.suggested_reply;
    const subject = req.body?.subject || reply.reply_subject || `Re: ${reply.original_subject || 'Your Email'}`;
    if (!html) return res.status(400).json({ error: 'No reply content to save' });
    const draft = await createReplyDraft({
      to: reply.professor_email,
      subject,
      html,
      threadId: reply.thread_id,
      replyHeaders: await getMessageReplyHeaders(reply.gmail_message_id),
    });
    db.prepare(`
      UPDATE replies
      SET gmail_draft_id=?, suggested_reply=?, reply_subject=?, workflow_status='drafted'
      WHERE id=?
    `).run(draft.id || null, html, subject, reply.id);
    eventBus.publish({ type: 'reply_updated', id: reply.id, mode: reply.mode });
    res.json({ success: true, draftId: draft.id });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/replies/:id/resend-original', requireGmail, async (req, res) => {
  let claimedReplyId = null;
  try {
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'Explicit resend confirmation is required' });
    const reply = db.prepare('SELECT * FROM replies WHERE id=?').get(req.params.id);
    if (!reply) return res.status(404).json({ error: 'Reply not found' });
    if (reply.original_resent_at) return res.status(400).json({ error: 'Original outreach was already resent for this reply' });
    if (reply.workflow_status === 'rejected') return res.status(400).json({ error: 'Rejected replies cannot be resent' });
    const claimed = db.prepare(`
      UPDATE replies SET original_resent_at=datetime('now')
      WHERE id=? AND original_resent_at IS NULL AND workflow_status!='rejected'
    `).run(reply.id);
    if (!claimed.changes) return res.status(409).json({ error: 'Original outreach resend is already being processed' });
    claimedReplyId = reply.id;
    const original = db.prepare(`
      SELECT subject, message_id, sent_at FROM (
        SELECT subject, message_id, sent_at FROM sent_email_history
        WHERE lower(professor_email)=lower(?)
        UNION ALL
        SELECT subject, message_id, sent_at FROM sent_log
        WHERE lower(professor_email)=lower(?)
      )
      WHERE message_id IS NOT NULL AND message_id!=''
      ORDER BY sent_at DESC LIMIT 1
    `).get(reply.professor_email, reply.professor_email);
    if (!original) return res.status(400).json({ error: 'Original sent email could not be found' });
    const html = await getEmailHtml(original.message_id);
    if (!html) return res.status(400).json({ error: 'Original email body could not be loaded from Gmail' });
    const result = await sendReplyEmail({
      to: reply.professor_email,
      subject: original.subject || 'MS/PhD Position Inquiry',
      html,
    });
    db.prepare('UPDATE replies SET original_resent_message_id=? WHERE id=?')
      .run(result.id || null, reply.id);
    eventBus.publish({ type: 'reply_updated', id: reply.id, mode: reply.mode });
    res.json({ success: true, messageId: result.id });
  } catch (e) {
    if (claimedReplyId) {
      db.prepare(`
        UPDATE replies SET original_resent_at=NULL
        WHERE id=? AND original_resent_message_id IS NULL
      `).run(claimedReplyId);
    }
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/replies/:id/reject', (req, res) => {
  const reply = db.prepare('SELECT * FROM replies WHERE id=?').get(req.params.id);
  if (!reply) return res.status(404).json({ error: 'Reply not found' });
  if (['sending', 'sent'].includes(reply.workflow_status)) return res.status(400).json({ error: 'Sending or sent replies cannot be rejected' });
  db.prepare(`
    UPDATE replies SET workflow_status='rejected', rejected_at=datetime('now') WHERE id=?
  `).run(reply.id);
  eventBus.publish({ type: 'reply_updated', id: reply.id, mode: reply.mode });
  res.json({ success: true });
});

router.delete('/replies/:id', (req, res) => {
  const reply = db.prepare('SELECT * FROM replies WHERE id=?').get(req.params.id);
  if (!reply) return res.status(404).json({ error: 'Reply not found' });
  if (['sending', 'sent'].includes(reply.workflow_status)) return res.status(400).json({ error: 'Sending or sent replies cannot be rejected' });
  db.prepare("UPDATE replies SET workflow_status='rejected', rejected_at=datetime('now') WHERE id=?").run(reply.id);
  eventBus.publish({ type: 'reply_updated', id: reply.id, mode: reply.mode });
  res.json({ success: true, preserved: true });
});

// --- Follow-ups (non-responder nudges; draft-first, manual send only) ---
router.get('/follow-ups', (req, res) => {
  try {
    const days = req.query.days ? Number(req.query.days) : undefined;
    const candidates = listFollowUpCandidates({ days });
    res.json({ days: days || getFollowUpDays(), candidates });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function findFollowUpCandidate(email) {
  return listFollowUpCandidates({ days: 0 }).find(
    item => item.professor_email.toLowerCase() === String(email || '').toLowerCase(),
  );
}

router.post('/follow-ups/draft', async (req, res) => {
  try {
    const email = String(req.body?.professor_email || '').trim();
    if (!email) return res.status(400).json({ error: 'professor_email is required' });
    const candidate = findFollowUpCandidate(email);
    if (!candidate) return res.status(404).json({ error: 'No pending follow-up found for this recipient' });

    let originalHtml = null;
    let threadId = null;
    if (candidate.original_message_id) {
      try {
        const snapshot = await getSentEmailSnapshot(candidate.original_message_id);
        originalHtml = snapshot?.html || null;
        threadId = snapshot?.threadId || null;
      } catch { /* original lookup is best-effort */ }
    }

    const result = await suggestFollowUp({
      last_name: candidate.last_name,
      original_subject: candidate.original_subject,
      original_email_html: originalHtml,
      days_since: candidate.days_since,
      stage: 1,
      style_samples: await fetchUserReplyStyleSamples({ maxSamples: 3 }).catch(() => []),
    });

    saveFollowUpDraft(candidate, { body: result.follow_up_html, subject: result.subject, threadId });
    eventBus.publish({ type: 'follow_up_updated', professor_email: email });
    res.json({ success: true, follow_up_html: result.follow_up_html, subject: result.subject });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/follow-ups/send', requireGmail, async (req, res) => {
  try {
    const email = String(req.body?.professor_email || '').trim();
    if (!email) return res.status(400).json({ error: 'professor_email is required' });
    const candidate = findFollowUpCandidate(email);
    if (!candidate) return res.status(404).json({ error: 'No pending follow-up found for this recipient' });

    const html = req.body?.html || candidate.suggested_body;
    if (!html) return res.status(400).json({ error: 'No follow-up content to send — generate or provide a draft first' });
    const subject = req.body?.subject
      || candidate.follow_up_subject
      || `Re: ${String(candidate.original_subject || 'Your Email').replace(/^(?:Re:\s*)+/i, '')}`;

    let threadId = candidate.thread_id || null;
    let replyHeaders = {};
    if (candidate.original_message_id) {
      try {
        if (!threadId) {
          const snapshot = await getSentEmailSnapshot(candidate.original_message_id);
          threadId = snapshot?.threadId || null;
        }
        replyHeaders = await getMessageReplyHeaders(candidate.original_message_id);
      } catch { /* thread linkage is best-effort; falls back to a fresh message */ }
    }

    const result = await sendReplyEmail({ to: email, subject, html, threadId, replyHeaders });
    markFollowUpSent(email, { body: html, subject, sentMessageId: result.id });
    eventBus.publish({ type: 'follow_up_updated', professor_email: email });
    res.json({ success: true, messageId: result.id });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/follow-ups/skip', (req, res) => {
  const email = String(req.body?.professor_email || '').trim();
  if (!email) return res.status(400).json({ error: 'professor_email is required' });
  markFollowUpSkipped(email, findFollowUpCandidate(email) || {});
  eventBus.publish({ type: 'follow_up_updated', professor_email: email });
  res.json({ success: true });
});

router.post('/queue/reconcile', (req, res) => {
  const mode = req.body?.mode || req.query.mode || 'instant';
  const result = reconcileInstantQueue(mode);
  eventBus.publish({ type: 'queue_reconciled', mode, ...result });
  res.json({ success: true, ...result });
});

router.post('/queue/send-all-safe', async (req, res) => {
  try {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ error: 'Explicit Send All confirmation is required' });
    }
    const mode = req.body?.mode || 'instant';
    const reconciliation = reconcileInstantQueue(mode);
    const rows = db.prepare(`
      SELECT q.id
      FROM queue q
      JOIN professors p ON p.id=q.professor_id AND p.mode=q.mode
      WHERE q.mode=?
        AND q.queue_group_id=(SELECT id FROM instant_queue_groups WHERE mode=? AND closed_at IS NULL ORDER BY queue_number DESC LIMIT 1)
        AND q.state IN ('pending','failed','sending','needs_review')
        AND COALESCE(q.error,'')!='rejected_by_user'
        AND NOT EXISTS (
          SELECT 1 FROM sent_email_history seh
          WHERE seh.queue_id=q.id OR lower(seh.professor_email)=lower(p.email)
        )
        AND NOT EXISTS (
          SELECT 1 FROM delivery_failures df
          WHERE (df.queue_id=q.id OR (df.queue_id IS NULL AND lower(df.professor_email)=lower(p.email) AND df.mode=q.mode))
            AND df.failure_type IN ('not_found','delivery_failed')
        )
      ORDER BY q.id
    `).all(mode, mode);

    if (!rows.length) {
      return res.json({
        success: true,
        affected: 0,
        reconciliation,
        message: 'No safe pending emails are available to send',
      });
    }

    const ids = rows.map(row => row.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`
      UPDATE queue
      SET state='pending', retry_count=0, research_started_at=NULL,
          auto_send_requested=1, fast_track=1
      WHERE id IN (${placeholders})
    `).run(...ids);
    const result = await runBatchForMode(mode, {
      queueIds: ids,
      source: 'processing_send_all',
      forceAutoSend: true,
    });
    eventBus.publish({ type: 'queue_safe_send_all_started', mode, count: ids.length });
    return res.json({ success: true, affected: ids.length, reconciliation, ...result });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Safe Send All failed' });
  }
});

router.post('/queue/run-batch', async (req, res) => {
  const mode = req.body.mode || 'instant';
  const result = await runBatchForMode(mode, { queueIds: req.body.queueIds, source: 'run_batch' });
  res.json(result);
});

router.get('/queue/progress', (req, res) => {
  try {
    const mode = req.query.mode || 'instant';
    res.json(getQueueProgress(mode));
  } catch (e) {
    console.error('[API] /queue/progress:', e.message);
    res.status(500).json({ error: e.message || 'Failed to load queue progress' });
  }
});

router.post('/queue/bulk', async (req, res) => {
  const { action, mode = 'instant', ids } = req.body;
  if (!action) return res.status(400).json({ error: 'action required' });

  let affected = 0;
  const activeQueueGroupId = latestInstantQueueGroup(mode)?.id || -1;
  const idFilter = ids?.length ? `AND id IN (${ids.map(() => '?').join(',')})` : '';
  const params = ids?.length ? [mode, activeQueueGroupId, ...ids] : [mode, activeQueueGroupId];

  if (action === 'retry_failed') {
    affected = db.prepare(`UPDATE queue SET state='pending', retry_count=0, error=NULL, fast_track=1 WHERE mode=? AND queue_group_id=? AND state='failed' ${idFilter}`).run(...params).changes;
  } else if (action === 'skip_duplicates') {
    affected = db.prepare(`UPDATE queue SET state='skipped', error='duplicate_skipped' WHERE mode=? AND queue_group_id=? AND state='duplicate_review' ${idFilter}`).run(...params).changes;
  } else if (action === 'process_duplicates') {
    affected = db.prepare(`UPDATE queue SET state='skipped', error='duplicate_skipped', duplicate_override=0 WHERE mode=? AND queue_group_id=? AND state='duplicate_review' ${idFilter}`).run(...params).changes;
    return res.status(409).json({
      error: 'Permanent duplicate protection: duplicate emails cannot be processed again',
      affected,
    });
  } else if (action === 'start_all') {
    const rows = db.prepare(`SELECT id FROM queue WHERE mode=? AND queue_group_id=? AND state IN ('pending','awaiting_proceed','failed','needs_review') ${idFilter}`).all(...params);
    const result = await runBatchForMode(mode, { queueIds: rows.map(r => r.id) });
    return res.json({ ...result, affected: rows.length });
  } else if (action === 'approve_all') {
    const rows = db.prepare(`SELECT id FROM queue WHERE mode=? AND queue_group_id=? AND state IN ('awaiting_proceed','verified','drafted') ${idFilter}`).all(...params);
    if (!rows.length) return res.json({ success: true, affected: 0 });
    affected = db.prepare(`UPDATE queue SET state='pending', error=NULL, fast_track=1 WHERE mode=? AND queue_group_id=? AND state IN ('awaiting_proceed','verified','drafted') ${idFilter}`).run(...params).changes;
    if (rows[0]?.id) prioritizeQueue(rows[0].id);
    for (const row of rows) {
      eventBus.publish({ type: 'state_change', id: row.id, state: 'pending', fast_track: true, mode });
    }
    eventBus.publish({ type: 'queue_bulk_approved', mode, count: affected });
  } else if (action === 'reject_all') {
    const rows = db.prepare(`SELECT id FROM queue WHERE mode=? AND queue_group_id=? AND state IN ('awaiting_proceed','verified','drafted') ${idFilter}`).all(...params);
    if (!rows.length) return res.json({ success: true, affected: 0 });
    affected = db.prepare(`UPDATE queue SET state='skipped', error='rejected_by_user', fast_track=0 WHERE mode=? AND queue_group_id=? AND state IN ('awaiting_proceed','verified','drafted') ${idFilter}`).run(...params).changes;
    for (const row of rows) {
      eventBus.publish({ type: 'state_change', id: row.id, state: 'skipped', error: 'rejected_by_user', mode });
    }
    eventBus.publish({ type: 'queue_bulk_rejected', mode, count: affected });
  } else {
    return res.status(400).json({ error: 'Unknown action' });
  }
  res.json({ success: true, affected });
});

router.post('/import/validate', (req, res) => {
  const { emails, rosterEntries, mode, max_professors } = req.body;
  const result = rosterEntries?.length
    ? validateProfessorEntries(rosterEntries, { mode: mode || 'instant', maxProfessors: max_professors })
    : validateEmailList(emails, { mode: mode || 'instant', maxProfessors: max_professors });
  res.json(result);
});

router.get('/campaign-presets', (req, res) => {
  const s = db.prepare('SELECT campaign_presets FROM settings WHERE id=1').get();
  res.json({ presets: parseCampaignPresets(s) });
});

router.post('/campaign-presets/apply', async (req, res) => {
  const { presetId } = req.body;
  const s = db.prepare('SELECT * FROM settings WHERE id=1').get();
  const presets = parseCampaignPresets(s);
  const preset = presets.find(p => p.id === presetId) || DEFAULT_CAMPAIGN_PRESETS.find(p => p.id === presetId);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });

  db.prepare(`UPDATE settings SET approval_mode=?, auto_send=?, basic_subject_keyword=?, duplicate_policy=?, duplicate_cooldown_days=?, auto_advance_queue=?, wave_batch_size=?, draft_first_scheduled=? WHERE id=1`)
    .run(
      preset.approval_mode || 'auto',
      preset.auto_send ?? 1,
      preset.basic_subject_keyword ?? 0,
      preset.duplicate_policy || 'review_always',
      preset.duplicate_cooldown_days ?? 30,
      preset.auto_advance_queue ?? 1,
      preset.wave_batch_size ?? 0,
      preset.draft_first ?? 0,
    );

  res.json({ success: true, preset, mode: preset.mode });
});

router.get('/schedule/suggest', (req, res) => {
  const countries = req.query.countries ? String(req.query.countries).split(',') : [];
  res.json(suggestScheduledAt(countries));
});

router.post('/settings/test-api-key', async (req, res) => {
  try {
    const { api_key, base_url } = req.body || {};
    const result = await testApiKeyAuto(api_key, base_url);
    res.json(result);
  } catch (e) {
    console.error('[API] /settings/test-api-key:', e.message);
    res.status(400).json({ ok: false, error: e.message || 'API key test failed' });
  }
});

router.get('/settings', (req, res) => {
  try {
    const s = db.prepare('SELECT * FROM settings WHERE id=1').get();
    if (!s) {
      return res.status(404).json({ error: 'Settings not initialized — restart the backend' });
    }
    res.json(settingsForClient(s));
  } catch (e) {
    console.error('[API] /settings:', e.message);
    res.status(500).json({ error: e.message || 'Failed to load settings' });
  }
});

/** Basic mode only — toggle default subject or search subject keyword (mutually exclusive). */
router.post('/settings/basic-subject-options', (req, res) => {
  const defaultSubject = !!req.body.defaultSubject;
  const searchSubjectKeyword = !!req.body.searchSubjectKeyword;
  let nextDefault = defaultSubject;
  let nextSearch = searchSubjectKeyword;
  if (defaultSubject && searchSubjectKeyword) {
    if (req.body.activeToggle === 'search') nextDefault = false;
    else nextSearch = false;
  }
  db.prepare('UPDATE settings SET basic_subject_keyword=?, basic_search_subject_keyword=? WHERE id=1')
    .run(nextDefault ? 1 : 0, nextSearch ? 1 : 0);
  syncBasicSubjectOptions(undefined, { defaultSubject: nextDefault, searchSubjectKeyword: nextSearch });
  const updated = db.prepare('SELECT * FROM settings WHERE id=1').get();
  const template = db.prepare("SELECT * FROM template WHERE mode='basic_instant'").get();
  res.json({
    success: true,
    basic_subject_keyword: nextDefault ? 1 : 0,
    basic_search_subject_keyword: nextSearch ? 1 : 0,
    settings: settingsForClient(updated),
    template,
  });
});

/** @deprecated use /settings/basic-subject-options */
router.post('/settings/basic-subject-keyword', (req, res) => {
  const enabled = !!req.body.enabled;
  db.prepare('UPDATE settings SET basic_subject_keyword=?, basic_search_subject_keyword=? WHERE id=1')
    .run(enabled ? 1 : 0, 0);
  syncBasicSubjectOptions(undefined, { defaultSubject: enabled, searchSubjectKeyword: false });
  const updated = db.prepare('SELECT * FROM settings WHERE id=1').get();
  const template = db.prepare("SELECT * FROM template WHERE mode='basic_instant'").get();
  res.json({
    success: true,
    basic_subject_keyword: enabled ? 1 : 0,
    basic_search_subject_keyword: 0,
    settings: settingsForClient(updated),
    template,
  });
});

/** Duplicate policy — saved immediately when user changes handling in Settings. */
router.post('/settings/duplicate-policy', (req, res) => {
  const existing = db.prepare('SELECT * FROM settings WHERE id=1').get() || {};
  const duplicate_policy = req.body.duplicate_policy ?? existing.duplicate_policy ?? 'review_always';
  const duplicate_cooldown_days = req.body.duplicate_cooldown_days ?? existing.duplicate_cooldown_days ?? 30;
  db.prepare('UPDATE settings SET duplicate_policy=?, duplicate_cooldown_days=? WHERE id=1')
    .run(duplicate_policy, duplicate_cooldown_days);
  const updated = db.prepare('SELECT * FROM settings WHERE id=1').get();
  res.json({ success: true, settings: settingsForClient(updated) });
});

router.put('/settings', (req, res) => {
  const existing = db.prepare('SELECT * FROM settings WHERE id=1').get() || {};
  const daily_cap = req.body.daily_cap ?? existing.daily_cap;
  const min_delay_min = req.body.min_delay_min ?? existing.min_delay_min;
  const max_delay_min = req.body.max_delay_min ?? existing.max_delay_min;
  const auto_send = req.body.auto_send !== undefined ? (req.body.auto_send ? 1 : 0) : existing.auto_send;
  const approval_mode = req.body.approval_mode ?? existing.approval_mode ?? 'manual';
  const basic_subject_keyword = req.body.basic_subject_keyword !== undefined
    ? (req.body.basic_subject_keyword ? 1 : 0)
    : (existing.basic_subject_keyword ?? 0);
  const basic_search_subject_keyword = req.body.basic_search_subject_keyword !== undefined
    ? (req.body.basic_search_subject_keyword ? 1 : 0)
    : (existing.basic_search_subject_keyword ?? 0);
  const duplicate_policy = req.body.duplicate_policy ?? existing.duplicate_policy ?? 'review_always';
  const duplicate_cooldown_days = req.body.duplicate_cooldown_days ?? existing.duplicate_cooldown_days ?? 30;
  const queue_workers = req.body.queue_workers ?? existing.queue_workers ?? 2;
  const auto_advance_queue = req.body.auto_advance_queue !== undefined ? (req.body.auto_advance_queue ? 1 : 0) : (existing.auto_advance_queue ?? 1);
  const confidence_auto_send = req.body.confidence_auto_send !== undefined ? (req.body.confidence_auto_send ? 1 : 0) : (existing.confidence_auto_send ?? 1);
  const draft_first_scheduled = req.body.draft_first_scheduled !== undefined ? (req.body.draft_first_scheduled ? 1 : 0) : (existing.draft_first_scheduled ?? 0);
  const stagger_send_min = req.body.stagger_send_min ?? existing.stagger_send_min ?? 0;
  const wave_batch_size = req.body.wave_batch_size ?? existing.wave_batch_size ?? 0;
  const campaign_presets = req.body.campaign_presets !== undefined
    ? (typeof req.body.campaign_presets === 'string' ? req.body.campaign_presets : serializeCampaignPresets(req.body.campaign_presets))
    : existing.campaign_presets;
  let user_api_keys = existing.user_api_keys;
  if (req.body.user_api_keys !== undefined) {
    user_api_keys = serializeUserApiKeys(mergeUserApiKeys(existing.user_api_keys, req.body.user_api_keys));
  }

  db.prepare(`UPDATE settings SET daily_cap=?, min_delay_min=?, max_delay_min=?, auto_send=?, approval_mode=?, basic_subject_keyword=?, basic_search_subject_keyword=?,
    duplicate_policy=?, duplicate_cooldown_days=?, queue_workers=?, auto_advance_queue=?, confidence_auto_send=?,
    draft_first_scheduled=?, stagger_send_min=?, wave_batch_size=?, campaign_presets=?, user_api_keys=? WHERE id=1`)
    .run(daily_cap, min_delay_min, max_delay_min, auto_send, approval_mode, basic_subject_keyword, basic_search_subject_keyword,
      duplicate_policy, duplicate_cooldown_days, queue_workers, auto_advance_queue, confidence_auto_send,
      draft_first_scheduled, stagger_send_min, wave_batch_size, campaign_presets, user_api_keys);
  if (req.body.basic_subject_keyword !== undefined || req.body.basic_search_subject_keyword !== undefined) {
    syncBasicSubjectOptions(undefined, {
      defaultSubject: !!basic_subject_keyword,
      searchSubjectKeyword: !!basic_search_subject_keyword,
    });
  }
  applyUserApiKeysFromDb();
  const updated = db.prepare('SELECT * FROM settings WHERE id=1').get();
  res.json({
    success: true,
    settings: settingsForClient(updated),
  });
});

router.get('/session', (req, res) => {
  try {
    res.json({
      epoch: getSessionEpoch(db),
      stats: {
        total: db.prepare('SELECT COUNT(*) as c FROM queue').get().c,
        professors: db.prepare('SELECT COUNT(*) as c FROM professors').get().c,
      },
    });
  } catch (e) {
    console.error('[API] /session:', e.message);
    res.status(500).json({ error: e.message || 'Failed to load session' });
  }
});

router.get('/bootstrap', async (req, res) => {
  try {
    const mode = req.query.mode || 'instant';
    const scrape = getScrapeStatus();
    const authStatus = await AuthService.validateConnection();
    const settingsRow = db.prepare('SELECT * FROM settings WHERE id=1').get();
    const worker = PipelineService.status();

    let dbOk = false;
    try { db.pragma('user_version'); dbOk = true; } catch {}

    const commonData = {
      settings: settingsForClient(settingsRow),
      auth: authStatus,
      health: {
        status: dbOk ? 'ok' : 'degraded',
        workerRunning: worker.running,
        running: worker.running,
        activeWorkers: worker.activeWorkers,
        queueWorkers: worker.queueWorkers,
        lastActivity: new Date(worker.lastActivity).toISOString(),
        db: dbOk,
        gmail: authStatus,
        authenticated: authStatus.authenticated,
        scrapeRunning: scrape.running || false,
        aiFallback: config.aiFallbackEnabled,
      },
      analytics: getAnalytics(),
      session: { epoch: getSessionEpoch(db) },
    };

    if (mode === 'scheduled') {
      const sTplNormal = db.prepare("SELECT * FROM scheduled_template WHERE mode='scheduled'").get();
      const sTplBasic = db.prepare("SELECT * FROM scheduled_template WHERE mode='basic_scheduled'").get();

      const batches = db.prepare(`
        SELECT b.*,
          (SELECT COUNT(*) FROM scheduled_drafts WHERE batch_id=b.id) as draft_count,
          (SELECT COUNT(*) FROM scheduled_drafts WHERE batch_id=b.id AND status='draft') as pending_count,
          (SELECT COUNT(*) FROM scheduled_drafts WHERE batch_id=b.id AND status='approved') as approved_count,
          (SELECT COUNT(*) FROM scheduled_drafts WHERE batch_id=b.id AND status='sent') as sent_count,
          (SELECT COUNT(*) FROM scheduled_drafts WHERE batch_id=b.id AND status='failed') as failed_count
        FROM scheduled_batches b WHERE b.status != 'cancelled' ORDER BY b.created_at DESC
      `).all();

      const drafts = db.prepare(`
        SELECT d.*, sp.email as professor_email, sp.last_name, sp.university, sp.research_areas
        FROM scheduled_drafts d
        JOIN scheduled_professors sp ON d.professor_id = sp.id
        ORDER BY d.id LIMIT 200
      `).all();

      const scheduledStats = {
        batches: {
          total: db.prepare("SELECT COUNT(*) as count FROM scheduled_batches WHERE status != 'cancelled'").get().count,
          pending: db.prepare("SELECT COUNT(*) as count FROM scheduled_batches WHERE status IN ('pending','processing')").get().count,
          drafted: db.prepare("SELECT COUNT(*) as count FROM scheduled_batches WHERE status='drafted'").get().count,
          scheduled: db.prepare("SELECT COUNT(*) as count FROM scheduled_batches WHERE status='scheduled'").get().count,
          sending: db.prepare("SELECT COUNT(*) as count FROM scheduled_batches WHERE status='sending'").get().count,
          completed: db.prepare("SELECT COUNT(*) as count FROM scheduled_batches WHERE status='completed'").get().count,
        },
        drafts: {
          total: db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts").get().count,
          draft: db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts WHERE status='draft'").get().count,
          approved: db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts WHERE status='approved'").get().count,
          sent: db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts WHERE status='sent'").get().count,
          failed: db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts WHERE status='failed'").get().count,
        },
        total: db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts").get().count,
        sent: db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts WHERE status='sent'").get().count,
        pending: db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts WHERE status='draft'").get().count,
        approved: db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts WHERE status='approved'").get().count,
        failed: db.prepare("SELECT COUNT(*) as count FROM scheduled_drafts WHERE status='failed'").get().count,
        todaySent: db.prepare("SELECT COUNT(*) as c FROM sent_email_history WHERE date(sent_at)=date('now')").get().c,
        totalSent: db.prepare("SELECT COUNT(*) as count FROM sent_email_history").get().count,
        uniqueSentEmails: db.prepare("SELECT COUNT(DISTINCT professor_email) as count FROM sent_email_history").get().count,
        sessionEpoch: getSessionEpoch(db),
      };

      res.json({
        ...commonData,
        stats: scheduledStats,
        batches,
        drafts,
        template: sTplNormal?.raw_html ? sTplNormal : null,
        basicScheduledTemplate: sTplBasic?.raw_html ? sTplBasic : null,
        agentContext: getAgentContext('scheduled'),
        basicScheduledAgentContext: getAgentContext('basic_scheduled'),
      });
    } else {
      const tpl = ensureTemplateForMode(mode);
      const activeQueueGroup = latestInstantQueueGroup(mode);
      const activeQueueGroupId = activeQueueGroup?.id || -1;

      const queueStats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN state='sent' THEN 1 ELSE 0 END) as sent,
          SUM(CASE WHEN state='pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN state='awaiting_proceed' THEN 1 ELSE 0 END) as awaitingProceed,
          SUM(CASE WHEN state='duplicate_review' THEN 1 ELSE 0 END) as duplicateReview,
          SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN state='researching' THEN 1 ELSE 0 END) as researching,
          SUM(CASE WHEN state='drafted' THEN 1 ELSE 0 END) as drafted,
          SUM(CASE WHEN state='verified' THEN 1 ELSE 0 END) as verified,
          SUM(CASE WHEN state='skipped' THEN 1 ELSE 0 END) as skipped
        FROM queue WHERE mode=? AND queue_group_id=?
      `).get(mode, activeQueueGroupId);

      res.json({
        ...commonData,
        stats: {
          ...queueStats,
          replied: db.prepare('SELECT COUNT(*) as c FROM replies WHERE mode=?').get(mode).c,
          todaySent: db.prepare("SELECT COUNT(*) as c FROM sent_email_history WHERE date(sent_at)=date('now')").get().c,
          totalSent: db.prepare("SELECT COUNT(*) as c FROM sent_email_history").get().c,
          uniqueSentEmails: db.prepare("SELECT COUNT(DISTINCT professor_email) as c FROM sent_email_history").get().c,
          scraping: scrape.running ? 1 : 0,
          scrapePhase: scrape.phase || null,
          sessionEpoch: getSessionEpoch(db),
        },
        queue: db.prepare(`
          SELECT q.*, p.email as professor_email, p.last_name, p.university, p.dossier,
            COALESCE(json_extract(p.dossier, '$.roster.last_name'), json_extract(p.dossier, '$.last_name'), p.last_name, '') AS uploaded_last_name,
            COALESCE(json_extract(p.dossier, '$.subject_keyword'), '') AS uploaded_subject_keyword,
            COALESCE(json_extract(p.dossier, '$.interest_line'), json_extract(p.dossier, '$.roster.research_interest'), '') AS uploaded_interest_line,
            (SELECT df.failure_type FROM delivery_failures df
              WHERE (df.queue_id=q.id OR (df.queue_id IS NULL AND lower(df.professor_email)=lower(p.email) AND df.mode=q.mode))
              ORDER BY df.received_at DESC, df.id DESC LIMIT 1) AS failure_type,
            (SELECT df.reason FROM delivery_failures df
              WHERE (df.queue_id=q.id OR (df.queue_id IS NULL AND lower(df.professor_email)=lower(p.email) AND df.mode=q.mode))
              ORDER BY df.received_at DESC, df.id DESC LIMIT 1) AS failure_reason,
            (SELECT df.status FROM delivery_failures df
              WHERE (df.queue_id=q.id OR (df.queue_id IS NULL AND lower(df.professor_email)=lower(p.email) AND df.mode=q.mode))
              ORDER BY df.received_at DESC, df.id DESC LIMIT 1) AS failure_status,
            (SELECT seh.sent_at FROM sent_email_history seh
              WHERE seh.queue_id=q.id ORDER BY seh.sent_at DESC, seh.id DESC LIMIT 1) AS confirmed_sent_at,
            CASE WHEN EXISTS (
              SELECT 1 FROM sent_email_history seh
              WHERE lower(seh.professor_email)=lower(p.email)
                AND (seh.queue_id IS NULL OR seh.queue_id!=q.id)
            ) THEN 1 ELSE 0 END AS previously_contacted
          FROM queue q
          JOIN professors p ON q.professor_id=p.id AND q.mode=p.mode
          WHERE q.mode=? AND q.queue_group_id=?
          ORDER BY q.id LIMIT 500
        `).all(mode, activeQueueGroupId),
        activeQueue: activeQueueGroup,
        template: tpl?.raw_html ? tpl : null,
        agentContext: getAgentContext(mode),
      });
    }
  } catch (e) {
    console.error('[Bootstrap]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post('/backup', async (req, res) => {
  try {
    const mode = req.body?.mode || req.query.mode || 'manual';
    const backupPath = await createDbBackup(mode);
    res.json({ success: true, backupPath });
  } catch (e) {
    console.error('[Backup] Failed:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/reset', async (req, res) => {
  try {
    const mode = req.body.mode || 'instant';
    const backupPath = await createDbBackup(`before-reset-${mode}`);
    cancelScrapeJob();
    resetScrapeJob();
    GmailService.clearCache();

    if (mode === 'all') {
      const { epoch } = performFullReset(db);
      const stats = getEmptyStats(db);
      eventBus.publish({ type: 'reset', at: Date.now(), stats, sessionEpoch: epoch });
      res.json({
        success: true,
        stats,
        sessionEpoch: epoch,
        backupPath,
        cleared: ['queue', 'professors', 'template', 'scheduled_batches'],
          preserved: ['sent_email_history', 'sent_log', 'replies', 'reply_scenarios', 'delivery_failures', 'learning_stats', 'scheduled_sent_log', 'archive'],
      });
    } else {
      const epoch = bumpSessionEpoch(db);
      resetByMode(db, mode);
      const stats = getEmptyStats(db);
      eventBus.publish({ type: 'reset', at: Date.now(), stats, sessionEpoch: epoch, mode });
      res.json({
        success: true,
        stats,
        sessionEpoch: epoch,
        backupPath,
        cleared: [mode],
          preserved: ['sent_email_history', 'sent_log', 'replies', 'reply_scenarios', 'delivery_failures', 'learning_stats', 'scheduled_sent_log', 'archive'],
      });
    }
  } catch (e) {
    console.error('[Reset] Failed:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/digest', (req, res) => res.json(getWeeklyDigest()));
router.post('/digest/run', (req, res) => res.json(runWeeklyDigest(eventBus.publish.bind(eventBus))));

router.get('/health', (req, res) => {
  try {
    const worker = PipelineService.status();
    const scrape = getScrapeStatus();

    let dbOk = false;
    try { db.pragma('user_version'); dbOk = true; } catch {}

    const gmailStatus = AuthService.getStatus();

    res.json({
      status: dbOk ? 'ok' : 'degraded',
      workerRunning: worker.running,
      running: worker.running,
      activeWorkers: worker.activeWorkers,
      queueWorkers: worker.queueWorkers,
      lastActivity: new Date(worker.lastActivity).toISOString(),
      db: dbOk,
      gmail: gmailStatus,
      authenticated: AuthService.isConnected(),
      scrapeRunning: scrape.running || false,
      aiFallback: config.aiFallbackEnabled,
    });
  } catch (e) {
    console.error('[API] /health:', e.message);
    res.status(500).json({ error: e.message || 'Health check failed', status: 'error' });
  }
});

router.use('/sheet', requireFeature('instant'), sheetRouter);
router.use('/admin', adminRouter);
router.use('/settings/attachment', requireFeature('customAttachments'));
router.use(uploadRouter);
router.use(attachmentRouter);

export default router;
