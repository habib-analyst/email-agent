import db from '../db/index.js';
import { findPriorOutreach, recordDuplicateBlocked } from '../db/duplicateCheck.js';
import { evaluateDuplicate } from '../db/duplicatePolicy.js';
import { ArchiveService } from '../services/ArchiveService.js';
import { basicLastNameResearch, hasBasicLastName } from '../research/basicLastNameResearch.js';
import { generateEmail, verifyDraft, extractAccurateKeywords, keywordsFromProfileOnly, isGenericKeyword } from '../ai/index.js';
import { sendEmail, isSendLimitError } from '../gmail/index.js';
import { withRetry, delay, randomDelay } from './utils.js';
import { getAITargetingHints } from '../learning/index.js';
import { getSessionEpoch, isSessionEpoch } from '../session/epoch.js';
import { eventBus } from '../core/EventBus.js';
import { formatGreetingLastName } from '../utils/professor.js';
import { normalizeInterestLineKeywords } from '../utils/interestLine.js';
import { upsertRosterRow, syncRosterFromDb } from '../learning/rosterExcel.js';
import { repairBasicInstantTemplate } from '../db/templateStore.js';
import { basicTemplateNeedsRepair, buildBasicOutreachSubject, buildOutreachSubject, getBasicSubjectMode, DEFAULT_SUBJECT_KEYWORD } from '../gmail/basicTemplate.js';

// Debounced roster sync — only write Excel after 5s of no new sends, not per-send
let rosterSyncTimer = null;
function debouncedRosterSync(mode = 'instant') {
  clearTimeout(rosterSyncTimer);
  rosterSyncTimer = setTimeout(() => { syncRosterFromDb(mode); rosterSyncTimer = null; }, 5000);
}

let shouldRun = false;
let activeWorkers = 0;
let lastActivity = Date.now();
let preferredQueueId = null;
let lastHealAt = 0;
const HEAL_INTERVAL_MS = 30000;
const STUCK_THRESHOLD_MIN = 30;

const STEP_LABELS = {
  researching: 'Researching professor profile',
  drafted: 'Drafting personalized email',
  verified: 'Verified — sending email',
  sending: 'Sending via Gmail',
  sent: 'Email sent successfully',
};

export function getWorkerStatus() {
  const settings = getSettings();
  return {
    running: shouldRun,
    activeWorkers,
    lastActivity,
    queueWorkers: Number(settings?.queue_workers) || 2,
  };
}
export { eventBus };

// ── Self-healing: recover stuck queue items ──────────────────────────
function healStuckItems() {
  const now = Date.now();
  if (now - lastHealAt < HEAL_INTERVAL_MS) return;
  lastHealAt = now;

  // Reset items stuck in intermediate states for > STUCK_THRESHOLD_MIN
  const stuck = db.prepare(`
    SELECT id, state, professor_id FROM queue
    WHERE state IN ('researching','drafted','verified','sending')
      AND research_started_at IS NOT NULL
      AND research_started_at < datetime('now', '-${STUCK_THRESHOLD_MIN} minutes')
  `).all();

  if (stuck.length === 0) return;

  for (const item of stuck) {
    const healCount = db.prepare("SELECT heal_count FROM queue WHERE id=?").get(item.id)?.heal_count || 0;
    if (healCount >= 3) {
      console.log(`[Heal] Item #${item.id} already healed 3 times, marking as failed`);
      updateState(item.id, 'failed', { error: 'Stuck after 3 heal attempts' });
      continue;
    }
    console.log(`[Heal] Resetting stuck item #${item.id} (${item.state}) after ${STUCK_THRESHOLD_MIN}+ min (heal #${healCount + 1})`);
    db.prepare("UPDATE queue SET state='pending', retry_after=NULL, research_started_at=NULL, heal_count=heal_count+1 WHERE id=?").run(item.id);
    const modeRow = db.prepare('SELECT mode FROM queue WHERE id=?').get(item.id);
    eventBus.publish({ type: 'healed', id: item.id, prevState: item.state, healCount: healCount + 1, mode: modeRow?.mode || 'instant' });
  }

  // Mark items that exhausted retries as failed
  const expiredRetries = db.prepare(`
    SELECT id FROM queue
    WHERE state = 'pending'
      AND retry_after IS NOT NULL
      AND retry_after <= datetime('now')
      AND retry_count >= 3
  `).all();
  for (const item of expiredRetries) {
    console.log(`[Heal] Marking exhausted retries #${item.id} as failed`);
    updateState(item.id, 'failed', { error: 'Exhausted all retries' });
    const modeRow = db.prepare('SELECT mode FROM queue WHERE id=?').get(item.id);
    eventBus.publish({ type: 'skipped', id: item.id, error: 'exhausted_retries', mode: modeRow?.mode || 'instant' });
  }
}

export function prioritizeQueue(id) {
  preferredQueueId = Number(id) || null;
}

function publishStep(stage, item, extra = {}) {
  eventBus.publish({
    type: 'agent_step',
    stage,
    id: item.id,
    professor: item.prof_email,
    label: STEP_LABELS[stage] || stage,
    mode: item.mode || 'instant',
    ...extra,
  });
}

function publishCompose(item, prof, subject, interestLine, htmlPreview, state, extra = {}) {
  eventBus.publish({
    type: 'compose_update',
    id: item.id,
    professor: item.prof_email,
    professorName: prof.last_name,
    subject,
    interestLine: interestLine || '',
    state,
    htmlPreview,
    mode: item.mode || 'instant',
    ...extra,
  });
}

function getSettings() {
  return db.prepare('SELECT * FROM settings WHERE id=1').get();
}


function hasUsefulData(dossier) {
  if (!dossier) return false;
  if (typeof dossier === 'string') {
    try { dossier = JSON.parse(dossier); } catch { return false; }
  }

  if (!dossier.last_name || dossier.last_name.length < 2) return false;

  const hasResearch = (dossier.research_areas?.length > 0) ||
                      (dossier.papers?.length > 0) ||
                      (dossier.department?.length > 3);

  return hasResearch;
}

/** Uploaded Excel/CSV with verified last name — no web research required. */
function isRosterSheetImport(dossier) {
  if (!dossier) return false;
  const d = typeof dossier === 'string' ? JSON.parse(dossier) : dossier;
  return d.research_source === 'roster' && d.name_verified && d.last_name?.length >= 2;
}

function buildPreviewHtml(rawHtml, lastName, interestLine, stripInterest) {
  if (!rawHtml) return '';
  const keywords = stripInterest ? '' : normalizeInterestLineKeywords(interestLine || '');
  return rawHtml
    .replace(/\{\{LAST_NAME\}\}/g, formatGreetingLastName(lastName))
    .replace(/\{\{INTEREST_LINE\}\}/g, keywords);
}

function getNext() {
  const settings = getSettings();
  if (settings.daily_cap > 0) {
    // Use local timezone for daily cap — SQLite date('now') is UTC
    const now = new Date();
    const todayLocal = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const todaySent = db.prepare("SELECT COUNT(*) as c FROM sent_log WHERE date(sent_at)=?").get(todayLocal).c;
    if (todaySent >= settings.daily_cap) return null;
  }

  const baseSql = `
    SELECT q.*, p.email as prof_email, p.last_name as prof_last_name, p.source_url
    FROM queue q
    JOIN professors p ON q.professor_id=p.id AND q.mode=p.mode
    WHERE q.state IN ('pending', 'needs_review')
      AND (q.retry_after IS NULL OR q.retry_after <= datetime('now'))
  `;

  // Atomically claim an item: select + update state in one transaction so no other worker can grab it
  const claimItem = db.transaction((selectSql) => {
    const item = db.prepare(selectSql).get();
    if (!item) return null;
    const updated = db.prepare("UPDATE queue SET state='researching', research_started_at=datetime('now') WHERE id=? AND state IN ('pending','needs_review')").run(item.id);
    if (updated.changes === 0) return null; // another worker claimed it first
    return item;
  });

  if (preferredQueueId) {
    const preferred = db.transaction((id) => {
      const item = db.prepare(`${baseSql} AND q.id=? LIMIT 1`).get(id);
      if (!item) return null;
      const updated = db.prepare("UPDATE queue SET state='researching', research_started_at=datetime('now') WHERE id=? AND state IN ('pending','needs_review')").run(item.id);
      if (updated.changes === 0) return null;
      return item;
    })(preferredQueueId);
    preferredQueueId = null;
    if (preferred) return preferred;
  }

  const fast = claimItem(`${baseSql} AND q.fast_track=1 ORDER BY q.id LIMIT 1`);
  if (fast) return fast;

  return claimItem(`${baseSql} ORDER BY q.id LIMIT 1`);
}

function updateState(id, state, data = {}) {
  const sets = ['state=?'];
  const vals = [state];

  if (state === 'researching') sets.push("research_started_at=datetime('now')");
  if (state === 'drafted') sets.push("drafted_at=datetime('now')");
  if (state === 'verified') sets.push("verified_at=datetime('now')");
  if (state === 'sent') sets.push("sent_at=datetime('now')");

  for (const [k, v] of Object.entries(data)) {
    sets.push(`${k}=?`);
    vals.push(v);
  }
  vals.push(id);
  db.prepare(`UPDATE queue SET ${sets.join(',')} WHERE id=?`).run(...vals);
  const modeRow = db.prepare('SELECT mode FROM queue WHERE id=?').get(id);
  eventBus.publish({ type: 'state_change', id, state, mode: modeRow?.mode || 'instant', ...data });
}

function isDupe(email) {
  return evaluateDuplicate(email, getSettings()).blocked;
}

function tryAutoAdvanceNext(mode, currentId) {
  const settings = getSettings();
  if ((settings?.approval_mode || 'manual') !== 'auto' || !settings?.auto_send) return;

  const remaining = db.prepare(`
    SELECT COUNT(*) as c FROM queue
    WHERE mode=? AND state IN ('pending','awaiting_proceed','researching','drafted','verified','sending')
  `).get(mode)?.c || 0;

  if (remaining === 0) {
    const sent = db.prepare("SELECT COUNT(*) as c FROM queue WHERE mode=? AND state='sent'").get(mode)?.c || 0;
    if (sent > 0) {
      eventBus.publish({ type: 'batch_complete', mode, sent, label: 'All queue items processed' });
    }
    return;
  }

  if (!settings?.auto_advance_queue) return;

  const next = db.prepare(`
    SELECT q.id FROM queue q
    WHERE q.mode=? AND q.state IN ('awaiting_proceed','pending') AND q.id != ?
    ORDER BY q.id LIMIT 1
  `).get(mode, currentId);
  if (next) {
    db.prepare("UPDATE queue SET state='pending', fast_track=1, error=NULL WHERE id=?").run(next.id);
    prioritizeQueue(next.id);
  }
}

function archiveSent({ prof, subject, messageId, mode, queueId, topic, summary }) {
  ArchiveService.recordOutreach({
    professor_email: prof.email,
    last_name: prof.last_name,
    university: prof.university,
    mode,
    status: 'sent',
    subject,
    message_id: messageId,
    queue_id: queueId,
    agent_summary: summary || `Sent via ${mode}`,
  });
  ArchiveService.logAgentEvent({
    professor_email: prof.email,
    last_name: prof.last_name,
    mode,
    queue_id: queueId,
    event_type: 'sent',
    label: 'Email sent',
    detail: { subject, topic, messageId },
  });
}

function lastNameFromEmail(email) {
  const local = (email || '').split('@')[0];
  const parts = local.split(/[._-]/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 1] : parts[0];
}

function normalizeBasicSubject(sampleSubject) {
  const raw = (sampleSubject || 'Seeking an MS/PhD Position in Your Lab').trim();
  return raw.replace(/^\[[^\]]+\]\s*/, '');
}

function shouldSendAfterDraft(settings, item) {
  const approvalMode = settings?.approval_mode || 'manual';
  return approvalMode === 'auto' && !!settings.auto_send;
}

/** User approved a drafted email — send immediately without re-research. */
async function sendFastTrackedDraft(item, prof, tplRow, loopEpoch) {
  const itemMode = item.mode || 'instant';
  const isBasicInstant = itemMode === 'basic_instant';
  const subject = String(item.subject || '').trim();
  if (!subject) return false;

  let storedDossier = {};
  try { storedDossier = prof.dossier ? JSON.parse(prof.dossier) : {}; } catch { storedDossier = {}; }

  const lastName = storedDossier?.last_name || prof.last_name || '';
  const interestLine = normalizeInterestLineKeywords(item.interest_line || storedDossier?.interest_line || '');
  const htmlSource = item.custom_html || tplRow?.raw_html;
  if (!htmlSource) return false;

  const previewHtml = item.custom_html || buildPreviewHtml(tplRow.raw_html, lastName, interestLine, isBasicInstant);
  const topic = subject.match(/^\[([^\]]+)\]/)?.[1] || storedDossier?.subject_keyword || 'approved';

  publishStep('sending', item);
  publishCompose(item, prof, subject, interestLine, previewHtml, 'sending');
  try {
    const sendResult = await withRetry(() => sendEmail({
      ...item,
      professor_id: prof.id,
      subject,
      interest_line: interestLine,
      stripInterestLine: isBasicInstant,
      mode: itemMode,
    }));
    if (!isSessionEpoch(db, loopEpoch)) return true;

    updateState(item.id, 'sent', { sent_at: new Date().toISOString() });
    db.prepare('UPDATE queue SET fast_track=0 WHERE id=?').run(item.id);
    db.prepare("INSERT INTO sent_log (professor_email, subject, topic, message_id, sent_at, mode) VALUES (?,?,?,?,datetime('now'),?)")
      .run(prof.email, subject, topic, sendResult.id || null, itemMode);
    archiveSent({
      prof,
      subject,
      messageId: sendResult.id,
      mode: itemMode,
      queueId: item.id,
      topic,
      summary: 'Manual approval send',
    });
    if (!isBasicInstant) {
      db.prepare('INSERT OR IGNORE INTO learning_stats (topic) VALUES (?)').run(topic);
      db.prepare("UPDATE learning_stats SET sends=sends+1, last_used=datetime('now') WHERE topic=?").run(topic);
    }
    upsertRosterRow({
      email: prof.email,
      full_name: storedDossier?.name || storedDossier?.roster?.full_name || lastName,
      subject_keyword: topic,
      interest_line: interestLine,
      queue_state: 'sent',
    });
    debouncedRosterSync(itemMode);
    publishStep('sent', item, { subject, messageId: sendResult.id });
    publishCompose(item, prof, subject, interestLine, previewHtml, 'sent');
    eventBus.publish({ type: 'sent', professor: prof.email, subject, messageId: sendResult.id, id: item.id, mode: itemMode });
    lastActivity = Date.now();
    ArchiveService.cacheDossier(prof.email, storedDossier, { mode: itemMode, queue_id: item.id });
    tryAutoAdvanceNext(itemMode, item.id);
    console.log(`[Worker] Fast-track approved send to ${prof.email} — ${subject}`);
    return true;
  } catch (e) {
    console.error(`[Worker] Fast-track approved send failed for ${prof.email}:`, e.message);
    updateState(item.id, 'failed', { error: e.message });
    publishStep('failed', item, { label: `Send failed: ${e.message}`, error: true });
    return true;
  }
}

async function processBasicInstantItem(item, prof, tplRow, loopEpoch) {
  const itemMode = item.mode || 'basic_instant';
  const settings = getSettings();
  const subjectMode = getBasicSubjectMode(settings);
  let stageStart = Date.now();

  updateState(item.id, 'researching');
  eventBus.publish({ type: 'progress', id: item.id, stage: 'researching', professor: item.prof_email, mode: itemMode });

  const storedDossier = prof.dossier ? JSON.parse(prof.dossier) : null;
  const rosterLocked = storedDossier?.research_source === 'roster' && storedDossier?.name_verified;
  let lastName = storedDossier?.last_name || prof.last_name;
  let dossier = storedDossier;
  let subjectKeyword = '';

  if (subjectMode === 'search' && !rosterLocked) {
    publishStep('researching', item, { label: `Researching ${prof.email} for subject keyword`, phase: 'basic_keyword_research' });
    try {
      const profileUrl = prof.source_url || storedDossier?.profile_url || '';
      const scrapedProfileSources = new Set(['profile_data', 'profile_verified', 'directory_card', 'json_ld']);
      const hasScrapedKeywords = storedDossier && (
        scrapedProfileSources.has(storedDossier.research_source)
        || (storedDossier.research_areas?.length >= 1 && storedDossier.research_evidence)
      );

      if (hasScrapedKeywords) {
        dossier = storedDossier;
        publishStep('researching', item, { label: `Using scraped profile for keyword — ${prof.email}`, phase: 'profile_keyword' });
      } else if (storedDossier?.research_areas?.length || storedDossier?.papers?.length) {
        dossier = storedDossier;
        publishStep('researching', item, { label: `Combining scraped profile data for keyword — ${prof.email}`, phase: 'profile_keyword' });
      } else {
        updateState(item.id, 'needs_web_research', { error: 'No research on page — use Web Search for subject keyword' });
        publishStep('needs_web_research', item, { label: 'No profile keyword — use Web Search in queue' });
        upsertRosterRow({
          email: prof.email,
          queue_state: 'needs_web_research',
          research_info: 'No info on page',
          profile_research_status: 'none_on_page',
        });
        return;
      }
      if (!isSessionEpoch(db, loopEpoch)) return;

      if (dossier?.last_name && !rosterLocked) lastName = dossier.last_name;
      const canExtractKw = hasUsefulData(dossier) || hasScrapedKeywords || (dossier?.research_areas?.length >= 1);
      if (canExtractKw) {
        const fromProfile = keywordsFromProfileOnly(dossier);
        if (fromProfile?.subject_keyword && !isGenericKeyword(fromProfile.subject_keyword)) {
          subjectKeyword = fromProfile.subject_keyword;
        } else {
          const kw = await extractAccurateKeywords(dossier, dossier.papers || [], (dossier.research_areas || []).join(', '));
          if (kw.subject_keyword && !kw.error && !isGenericKeyword(kw.subject_keyword)) {
            subjectKeyword = kw.subject_keyword;
          }
        }
      }
      db.prepare('UPDATE professors SET last_name=?, dossier=?, research_areas=?, university=COALESCE(NULLIF(university,\'\'), ?) WHERE id=?').run(
        lastName,
        JSON.stringify(dossier),
        (dossier.research_areas || []).join(', '),
        dossier.university || '',
        prof.id,
      );
      prof.last_name = lastName;
    } catch (e) {
      console.error(`[Worker:Basic] Keyword research failed for ${prof.email}:`, e.message);
    }

    if (subjectMode === 'search' && !rosterLocked && !subjectKeyword) {
      updateState(item.id, 'needs_web_research', { error: 'No research on page — use Web Search for subject keyword' });
      publishStep('needs_web_research', item, { label: 'No profile keyword — use Web Search in queue' });
      upsertRosterRow({
        email: prof.email,
        queue_state: 'needs_web_research',
        research_info: 'No info on page',
        profile_research_status: 'none_on_page',
      });
      return;
    }
  }

  if (rosterLocked && storedDossier?.last_name) {
    lastName = storedDossier.last_name;
    prof.last_name = lastName;
  }

  if (!hasBasicLastName({ last_name: lastName }) && !rosterLocked) {
    try {
      publishStep('researching', item, { label: `Looking up last name for ${prof.email}`, phase: 'basic_lastname' });
      const nameDossier = await basicLastNameResearch(
        prof.email,
        prof.source_url || item.source_url || '',
        storedDossier?.profile_url || dossier?.profile_url || '',
      );
      if (!isSessionEpoch(db, loopEpoch)) return;

      lastName = nameDossier.last_name;
      db.prepare('UPDATE professors SET last_name=?, dossier=?, university=COALESCE(NULLIF(university,\'\'), ?) WHERE id=?').run(
        lastName,
        JSON.stringify({ ...(dossier || {}), ...nameDossier }),
        nameDossier.university || dossier?.university || '',
        prof.id,
      );
      prof.last_name = lastName;
      publishStep('researching', item, { label: `Last name resolved: ${lastName}` });
    } catch (e) {
      console.error(`[Worker:Basic] Last name lookup failed for ${prof.email}:`, e.message);
    }
  }

  if (!hasBasicLastName({ last_name: lastName })) {
    const errorMsg = 'Could not determine professor last name';
    updateState(item.id, 'failed', { error: errorMsg });
    publishStep('failed', item, { label: errorMsg, error: true });
    return;
  }

  prof.last_name = lastName;
  upsertRosterRow({
    email: prof.email,
    full_name: storedDossier?.name || storedDossier?.roster?.full_name || dossier?.name || lastName,
    subject_keyword: subjectMode === 'search' ? subjectKeyword : (subjectMode === 'default' ? DEFAULT_SUBJECT_KEYWORD : ''),
    queue_state: 'researching',
  });

  const subject = buildBasicOutreachSubject(subjectMode, subjectKeyword);
  const previewHtml = buildPreviewHtml(tplRow?.raw_html, lastName, '', true);

  publishCompose(item, prof, subject, '', previewHtml, 'drafted');
  updateState(item.id, 'drafted', { subject, interest_line: '' });
  publishStep('drafted', item, { subject, label: subjectMode === 'search' && subjectKeyword ? 'Draft ready (name + keyword)' : subjectMode === 'default' ? 'Draft ready (name + default subject)' : 'Draft ready (last name only)' });
  eventBus.publish({ type: 'progress', id: item.id, stage: 'drafted', professor: item.prof_email, subject, mode: itemMode, duration_ms: Date.now() - stageStart });
  stageStart = Date.now();

  updateState(item.id, 'verified');
  publishStep('verified', item);
  publishCompose(item, prof, subject, '', previewHtml, 'verified');
  eventBus.publish({ type: 'progress', id: item.id, stage: 'verified', professor: item.prof_email, mode: itemMode, duration_ms: Date.now() - stageStart });

  const approvalMode = settings.approval_mode || 'manual';
  const shouldSend = shouldSendAfterDraft(settings, item);

  if (!shouldSend) {
    updateState(item.id, 'awaiting_proceed');
    publishStep('awaiting_proceed', item, { label: approvalMode === 'manual' ? 'Awaiting manual approval' : 'Awaiting proceed command' });
    eventBus.publish({ type: 'awaiting_proceed', professor: item.prof_email, subject, id: item.id, mode: itemMode });
    return;
  }

  if (!isSessionEpoch(db, loopEpoch)) return;

  publishStep('sending', item);
  publishCompose(item, prof, subject, '', previewHtml, 'sending');
  const sendResult = await withRetry(() => sendEmail({
    ...item,
    professor_id: prof.id,
    subject,
    interest_line: '',
    stripInterestLine: true,
    mode: itemMode,
  }));
  if (!isSessionEpoch(db, loopEpoch)) return;

  updateState(item.id, 'sent', { sent_at: new Date().toISOString() });
  db.prepare('UPDATE queue SET fast_track=0 WHERE id=?').run(item.id);

  db.prepare("INSERT INTO sent_log (professor_email, subject, topic, message_id, sent_at, mode) VALUES (?,?,?,?,datetime('now'),?)")
    .run(prof.email, subject, 'basic', sendResult.id || null, itemMode);
  archiveSent({ prof, subject, messageId: sendResult.id, mode: itemMode, queueId: item.id, topic: 'basic', summary: 'Basic instant send' });

  upsertRosterRow({ email: prof.email, full_name: storedDossier?.name || storedDossier?.roster?.full_name || lastName, queue_state: 'sent' });
  debouncedRosterSync(itemMode);

  publishStep('sent', item, { subject, messageId: sendResult.id });
  publishCompose(item, prof, subject, '', previewHtml, 'sent');
  eventBus.publish({ type: 'sent', professor: prof.email, subject, messageId: sendResult.id, id: item.id, mode: itemMode });
  lastActivity = Date.now();
  ArchiveService.cacheDossier(prof.email, storedDossier || { last_name: lastName }, { mode: itemMode, queue_id: item.id });
  tryAutoAdvanceNext(itemMode, item.id);
  console.log(`[Worker:Basic] Sent to ${prof.email} — ${subject}`);
}

function resolveRosterKeywords(dossier, item) {
  const subject_keyword = String(
    dossier?.subject_keyword
    || (item?.subject?.match(/^\[([^\]]+)\]/) || [])[1]
    || ''
  ).trim();
  const interest_line = normalizeInterestLineKeywords(dossier?.interest_line || item?.interest_line || '');
  return { subject_keyword, interest_line };
}

function rosterKeywordsReady(dossier, item) {
  if (!dossier || dossier.research_source !== 'roster') return false;
  const { subject_keyword, interest_line } = resolveRosterKeywords(dossier, item);
  return !!(subject_keyword && interest_line);
}

function buildDraftSubject(itemMode, item, subject_keyword) {
  const settings = getSettings();
  if (itemMode === 'basic_instant') {
    const subjectMode = getBasicSubjectMode(settings);
    if (item.subject && /^\[[^\]]+\]/.test(item.subject) && subjectMode !== 'fixed') {
      return item.subject;
    }
    return buildBasicOutreachSubject(subjectMode, subject_keyword);
  }
  if (item.subject && /^\[[^\]]+\]/.test(item.subject)) {
    return item.subject;
  }
  return buildOutreachSubject(subject_keyword, true);
}

/** Draft/send using subject + interest keywords uploaded in Excel/CSV roster. */
async function draftFromRosterKeywords(item, prof, tplRow, loopEpoch, storedDossier) {
  const itemMode = item.mode || 'instant';
  const { subject_keyword, interest_line: interestLine } = resolveRosterKeywords(storedDossier, item);
  const lastName = storedDossier.last_name || prof.last_name;
  const fullName = storedDossier.name || storedDossier.roster?.full_name || lastName;

  if (!hasBasicLastName({ last_name: lastName })) {
    updateState(item.id, 'failed', { error: 'Roster row missing valid last name' });
    publishStep('failed', item, { label: 'Roster missing last name', error: true });
    return;
  }

  prof.last_name = lastName;
  db.prepare('UPDATE professors SET last_name=?, name_verified=1 WHERE id=?').run(lastName, prof.id);

  const subject = buildDraftSubject(itemMode, item, subject_keyword);
  const previewHtml = buildPreviewHtml(tplRow?.raw_html, lastName, interestLine, false);

  publishCompose(item, prof, subject, interestLine, previewHtml, 'drafted', { model: 'roster', provider: 'roster' });
  updateState(item.id, 'drafted', { subject, interest_line: interestLine });
  publishStep('drafted', item, { subject, label: 'Draft from uploaded roster keywords', model: 'roster', provider: 'roster' });

  upsertRosterRow({
    email: prof.email,
    full_name: fullName,
    university: storedDossier.university || prof.university || '',
    subject_keyword,
    interest_line: interestLine,
    queue_state: 'drafted',
  });

  updateState(item.id, 'verified');
  publishStep('verified', item);
  publishCompose(item, prof, subject, interestLine, previewHtml, 'verified');

  const settings = getSettings();
  const approvalMode = settings.approval_mode || 'manual';
  const shouldSend = shouldSendAfterDraft(settings, item);

  if (!shouldSend) {
    updateState(item.id, 'awaiting_proceed');
    publishStep('awaiting_proceed', item, { label: 'Roster draft ready — proceed to send' });
    eventBus.publish({ type: 'awaiting_proceed', professor: prof.email, subject, id: item.id, interest_line: interestLine, mode: itemMode });
    return;
  }

  if (!isSessionEpoch(db, loopEpoch)) return;

  publishStep('sending', item);
  publishCompose(item, prof, subject, interestLine, previewHtml, 'sending');
  const sendResult = await withRetry(() => sendEmail({
    ...item,
    professor_id: prof.id,
    subject,
    interest_line: interestLine,
    mode: itemMode,
  }));
  if (!isSessionEpoch(db, loopEpoch)) return;

  updateState(item.id, 'sent', { sent_at: new Date().toISOString() });
  db.prepare('UPDATE queue SET fast_track=0 WHERE id=?').run(item.id);
  db.prepare("INSERT INTO sent_log (professor_email, subject, topic, message_id, sent_at, mode) VALUES (?,?,?,?,datetime('now'),?)")
    .run(prof.email, subject, subject_keyword, sendResult.id || null, itemMode);
  archiveSent({ prof, subject, messageId: sendResult.id, mode: itemMode, queueId: item.id, topic: subject_keyword, summary: 'Roster upload send' });
  upsertRosterRow({ email: prof.email, full_name: fullName, subject_keyword, interest_line: interestLine, queue_state: 'sent' });
  debouncedRosterSync(itemMode);
  publishStep('sent', item, { subject, messageId: sendResult.id });
  publishCompose(item, prof, subject, interestLine, previewHtml, 'sent');
  eventBus.publish({ type: 'sent', professor: prof.email, subject, messageId: sendResult.id, id: item.id, mode: itemMode });
  lastActivity = Date.now();
  ArchiveService.cacheDossier(prof.email, storedDossier, { mode: itemMode, queue_id: item.id });
  tryAutoAdvanceNext(itemMode, item.id);
  console.log(`[Worker:Roster] Sent to ${prof.email} — ${subject}`);
}

/** Instant-mode send using uploaded roster only (full name + last name + email from sheet). */
async function processRosterSheetItem(item, prof, tplRow, loopEpoch, storedDossier) {
  const itemMode = item.mode || 'instant';
  const settings = getSettings();
  const lastName = storedDossier.last_name || prof.last_name;
  const fullName = storedDossier.name || storedDossier.roster?.full_name || lastName;

  if (!hasBasicLastName({ last_name: lastName })) {
    updateState(item.id, 'failed', { error: 'Roster row missing valid last name' });
    publishStep('failed', item, { label: 'Roster missing last name', error: true });
    return;
  }

  updateState(item.id, 'researching');
  publishStep('researching', item, { label: `Using uploaded roster for ${prof.email}` });

  prof.last_name = lastName;
  db.prepare('UPDATE professors SET last_name=?, name_verified=1 WHERE id=?').run(lastName, prof.id);

  upsertRosterRow({
    email: prof.email,
    full_name: fullName,
    university: storedDossier.university || prof.university || '',
    research_interest: (storedDossier.research_areas || []).join(', '),
    queue_state: 'researching',
  });

  const subjectMode = itemMode === 'basic_instant'
    ? getBasicSubjectMode(settings)
    : 'search';
  const importedKw = storedDossier.subject_keyword
    || (item.subject?.match(/^\[([^\]]+)\]/) || [])[1]
    || '';
  const subject = item.subject && /^\[[^\]]+\]/.test(item.subject) && subjectMode !== 'fixed'
    ? item.subject
    : buildBasicOutreachSubject(subjectMode, importedKw);
  const previewHtml = buildPreviewHtml(tplRow?.raw_html, lastName, '', true);

  publishCompose(item, prof, subject, '', previewHtml, 'drafted');
  updateState(item.id, 'drafted', { subject, interest_line: '' });
  publishStep('drafted', item, { subject, label: 'Draft from roster (last name only)' });

  updateState(item.id, 'verified');
  publishStep('verified', item);
  publishCompose(item, prof, subject, '', previewHtml, 'verified');

  const approvalMode = settings.approval_mode || 'manual';
  const shouldSend = shouldSendAfterDraft(settings, item);

  if (!shouldSend) {
    updateState(item.id, 'awaiting_proceed');
    publishStep('awaiting_proceed', item, { label: 'Roster draft ready — proceed to send' });
    eventBus.publish({ type: 'awaiting_proceed', professor: prof.email, subject, id: item.id, mode: itemMode });
    return;
  }

  if (!isSessionEpoch(db, loopEpoch)) return;

  publishStep('sending', item);
  publishCompose(item, prof, subject, '', previewHtml, 'sending');
  const sendResult = await withRetry(() => sendEmail({
    ...item,
    professor_id: prof.id,
    subject,
    interest_line: '',
    stripInterestLine: true,
    mode: itemMode,
  }));
  if (!isSessionEpoch(db, loopEpoch)) return;

  updateState(item.id, 'sent', { sent_at: new Date().toISOString() });
  db.prepare('UPDATE queue SET fast_track=0 WHERE id=?').run(item.id);
  db.prepare("INSERT INTO sent_log (professor_email, subject, topic, message_id, sent_at, mode) VALUES (?,?,?,?,datetime('now'),?)")
    .run(prof.email, subject, 'roster', sendResult.id || null, itemMode);
  archiveSent({ prof, subject, messageId: sendResult.id, mode: itemMode, queueId: item.id, topic: 'roster', summary: 'Roster upload send' });
  upsertRosterRow({ email: prof.email, full_name: fullName, queue_state: 'sent' });
  debouncedRosterSync(itemMode);
  publishStep('sent', item, { subject, messageId: sendResult.id });
  publishCompose(item, prof, subject, '', previewHtml, 'sent');
  eventBus.publish({ type: 'sent', professor: prof.email, subject, messageId: sendResult.id, id: item.id, mode: itemMode });
  lastActivity = Date.now();
  tryAutoAdvanceNext(itemMode, item.id);
  console.log(`[Worker:Roster] Sent to ${prof.email} — ${subject}`);
}

async function processQueueItem(item, loopEpoch) {
  const itemMode = item.mode || 'instant';

  // Fast-track with custom_html: user already edited the email — send directly, skip research/draft
  if (item.fast_track && item.custom_html) {
    const prof = db.prepare('SELECT * FROM professors WHERE id=?').get(item.professor_id);
    if (!prof) {
      updateState(item.id, 'failed', { error: 'Professor not found' });
      return;
    }
    publishStep('sending', item);
    try {
      const sendResult = await withRetry(() => sendEmail({ ...item, professor_id: prof.id }));
      updateState(item.id, 'sent', { sent_at: new Date().toISOString() });
      db.prepare('UPDATE queue SET fast_track=0 WHERE id=?').run(item.id);
      db.prepare("INSERT INTO sent_log (professor_email, subject, topic, message_id, sent_at, mode) VALUES (?,?,?,?,datetime('now'),?)")
        .run(prof.email, item.subject, item.subject?.match(/^\[([^\]]+)\]/)?.[1] || 'custom', sendResult.id || null, itemMode);
      archiveSent({ prof, subject: item.subject, messageId: sendResult.id, mode: itemMode, queueId: item.id, topic: 'custom', summary: 'Fast-track resend (user-edited body)' });
      upsertRosterRow({ email: prof.email, subject_keyword: item.subject?.match(/^\[([^\]]+)\]/)?.[1] || 'custom', interest_line: item.interest_line, queue_state: 'sent' });
      debouncedRosterSync(itemMode);
      publishStep('sent', item, { subject: item.subject, messageId: sendResult.id });
      eventBus.publish({ type: 'sent', professor: prof.email, subject: item.subject, messageId: sendResult.id, id: item.id });
      console.log(`[Worker] Sent custom-edited email to ${prof.email} — ${item.subject}`);
    } catch (e) {
      console.error(`[Worker] Fast-track custom send failed for ${item.professor_email || item.id}:`, e.message);
      updateState(item.id, 'failed', { error: e.message });
      publishStep('failed', item, { label: `Send failed: ${e.message}`, error: true });
    }
    return;
  }

  let tplRow = db.prepare('SELECT raw_html, instructions, sample_subject FROM template WHERE mode=?').get(itemMode);

  // Validate template has required placeholders before processing
  if (!tplRow?.raw_html) {
    updateState(item.id, 'failed', { error: 'No email template configured' });
    return;
  }

  if (itemMode === 'basic_instant' && basicTemplateNeedsRepair(tplRow, getBasicSubjectMode(getSettings()))) {
    repairBasicInstantTemplate();
    tplRow = db.prepare('SELECT raw_html, instructions, sample_subject FROM template WHERE mode=?').get(itemMode);
  }

  const hasLastName = tplRow.raw_html.includes('{{LAST_NAME}}');
  const hasInterestLine = tplRow.raw_html.includes('{{INTEREST_LINE}}');
  const isBasicInstant = itemMode === 'basic_instant';
  const basicSubjectMode = isBasicInstant ? getBasicSubjectMode(getSettings()) : 'fixed';
  const basicUseSubjectKeyword = isBasicInstant && basicSubjectMode !== 'fixed';

  if (!hasLastName) {
    updateState(item.id, 'failed', { error: 'Template missing {{LAST_NAME}} placeholder' });
    return;
  }

  if (isBasicInstant && hasInterestLine) {
    updateState(item.id, 'failed', { error: 'Basic template must have fixed subject and no interest line — reload template or reset basic mode' });
    return;
  }

  if (isBasicInstant && basicSubjectMode === 'fixed' && /^\[[^\]]+\]/.test(tplRow.sample_subject || '')) {
    updateState(item.id, 'failed', { error: 'Basic template must have fixed subject — turn off subject options or reload template' });
    return;
  }

  if (!isBasicInstant && !hasInterestLine) {
    updateState(item.id, 'failed', {
      error: 'Template missing placeholders - Add {{LAST_NAME}} and {{INTEREST_LINE}} to your template'
    });
    return;
  }

  const prof = db.prepare('SELECT * FROM professors WHERE id=?').get(item.professor_id);
  if (!prof) {
    updateState(item.id, 'failed', { error: 'Professor not found' });
    return;
  }

  if (item.fast_track && item.subject?.trim()) {
    const sent = await sendFastTrackedDraft(item, prof, tplRow, loopEpoch);
    if (sent) return;
  }

  if (isBasicInstant) {
    return processBasicInstantItem(item, prof, tplRow, loopEpoch);
  }

  const rosterDossier = prof.dossier ? JSON.parse(prof.dossier) : null;
  if (rosterKeywordsReady(rosterDossier, item)) {
    return draftFromRosterKeywords(item, prof, tplRow, loopEpoch, rosterDossier);
  }
  if (isRosterSheetImport(rosterDossier) && !hasUsefulData(rosterDossier)) {
    return processRosterSheetItem(item, prof, tplRow, loopEpoch, rosterDossier);
  }

  if (item.state === 'needs_review') {
    publishStep('researching', item, { label: 'Auto-reviewing — retrying from email…' });
    updateState(item.id, 'pending');
    item.state = 'pending';
  }

  let stageStart = Date.now();
  updateState(item.id, 'researching');
  eventBus.publish({ type: 'progress', id: item.id, stage: 'researching', professor: item.prof_email, mode: itemMode });

  const storedDossier = prof.dossier ? JSON.parse(prof.dossier) : null;
  const profileUrl = prof.source_url || storedDossier?.profile_url || storedDossier?.roster?.profile_url || '';

  let dossier;
  let found = false;
  const MAX_RESEARCH_ATTEMPTS = 5;

  if (storedDossier && (hasUsefulData(storedDossier) || storedDossier.profile_research_status === 'profile_found' || storedDossier.profile_research_status === 'web_complete')) {
    console.log(`[Worker] Skipping research for ${item.professor_email} — dossier ready (${storedDossier.profile_research_status || 'verified'})`);
    dossier = storedDossier;
    found = true;
    publishStep('researching', item, { label: storedDossier.profile_research_status === 'profile_found' ? 'Using scraped profile for keywords' : 'Skipped research (dossier already verified)' });
  } else if (storedDossier?.profile_research_status === 'none_on_page') {
    updateState(item.id, 'needs_web_research', { error: 'No research found on faculty page' });
    publishStep('needs_web_research', item, { label: 'No info on page — use Web Search in queue' });
    upsertRosterRow({
      email: prof.email,
      queue_state: 'needs_web_research',
      research_info: 'No info on page',
      profile_research_status: 'none_on_page',
    });
    return;
  } else {
    const cached = ArchiveService.getCachedDossier(prof.email);
    if (cached?.last_name && (hasUsefulData(cached) || cached.research_areas?.length)) {
      dossier = cached;
      found = true;
      publishStep('researching', item, { label: 'Reused archived research dossier' });
    } else if (prof.last_name && prof.last_name.length >= 2 && prof.name_verified) {
      dossier = storedDossier || { email: prof.email, last_name: prof.last_name, university: prof.university, research_areas: [], papers: [], verified: true, research_source: 'roster' };
      found = hasUsefulData(dossier);
      publishStep('researching', item, { label: found ? 'Roster data — light research only' : `Using roster last name: ${prof.last_name}` });
    }
  }

  if (!found) {
    const partial = storedDossier || {};
    if (partial.research_areas?.length || partial.papers?.length) {
      const fromProfile = keywordsFromProfileOnly(partial);
      if (fromProfile?.subject_keyword && fromProfile.interest_keywords?.length >= 2) {
        dossier = {
          ...partial,
          subject_keyword: fromProfile.subject_keyword,
          interest_line: normalizeInterestLineKeywords(fromProfile.interest_keywords.slice(0, 3).join(', ')),
          profile_research_status: 'profile_found',
          keyword_source: fromProfile.source || 'profile_scrape',
        };
        found = true;
        publishStep('researching', item, { label: 'Keywords from scraped profile (no web search)' });
      } else {
        const kw = await extractAccurateKeywords(partial, partial.papers || [], (partial.research_areas || []).join(', '));
        if (kw.subject_keyword && kw.interest_keywords?.length >= 2 && !kw.error) {
          dossier = {
            ...partial,
            subject_keyword: kw.subject_keyword,
            interest_line: normalizeInterestLineKeywords(kw.interest_keywords.slice(0, 3).join(', ')),
            profile_research_status: 'profile_found',
            keyword_source: kw.source || 'profile_local',
          };
          found = true;
          publishStep('researching', item, { label: 'Keywords combined from profile data' });
        }
      }
    }

    if (!found) {
      updateState(item.id, 'needs_web_research', { error: 'No research found on faculty page' });
      publishStep('needs_web_research', item, { label: 'No info on page — use Web Search in queue' });
      upsertRosterRow({
        email: prof.email,
        queue_state: 'needs_web_research',
        research_info: 'No info on page',
        profile_research_status: 'none_on_page',
      });
      return;
    }
  }

  if (!isSessionEpoch(db, loopEpoch)) return;

  if (!found || !hasUsefulData(dossier)) {
    const errorMsg = `Research failed after ${MAX_RESEARCH_ATTEMPTS} attempts - no verified professor data found`;
    console.log(`[Worker] ${errorMsg} for ${prof.email}`);
    updateState(item.id, 'failed', { error: errorMsg });
    publishStep('failed', item, { label: errorMsg, error: true });

    upsertRosterRow({
      email: prof.email,
      queue_state: 'failed',
      error_reason: 'Research failed - no professor data found'
    });

    return;
  }

  db.prepare('UPDATE professors SET dossier=?, research_areas=?, university=?, last_name=?, source_url=COALESCE(NULLIF(source_url,\'\'), ?) WHERE id=?').run(
    JSON.stringify({ ...dossier, roster: storedDossier?.roster || dossier.roster }),
    (dossier.research_areas || []).join(', '),
    dossier.university || prof.university || '',
    dossier.last_name || prof.last_name,
    dossier.profile_url || prof.source_url || '',
    prof.id,
  );
  prof.last_name = dossier.last_name || prof.last_name;

  upsertRosterRow({
    email: prof.email,
    full_name: dossier.name || prof.last_name,
    university: dossier.university || prof.university || '',
    department: dossier.department || '',
    designation: dossier.title || '',
    research_interest: (dossier.research_areas || []).join(', '),
    profile_url: dossier.profile_url || profileUrl,
    email_verified: dossier.email_verified ? 'yes' : 'no',
    queue_state: 'researching',
  });

  const targetingHints = getAITargetingHints()?.summary || '';
  let email = await withRetry(() => generateEmail(
    dossier,
    tplRow?.instructions || '',
    tplRow?.sample_subject || '',
    targetingHints,
    formatGreetingLastName(dossier.last_name || prof.last_name),
  ));
  if (!isSessionEpoch(db, loopEpoch)) return;

  if (!email.pass || !email.interestLine || email.interestLine.length < 5 || email.interestLine.split(/\s+/).length > 30) {
    const needsWeb = email.reasons?.some(r => /web search/i.test(r));
    if (needsWeb) {
      updateState(item.id, 'needs_web_research', { error: 'No research found on faculty page' });
      publishStep('needs_web_research', item, { label: 'No info on page — use Web Search in queue' });
      upsertRosterRow({
        email: prof.email,
        queue_state: 'needs_web_research',
        research_info: 'No info on page',
        profile_research_status: 'none_on_page',
      });
      return;
    }
    const errorMsg = `Email generation failed self-check - weak personalization`;
    console.log(`[Worker] ${errorMsg} for ${prof.email}:`, { pass: email.pass, interestLine: email.interestLine });
    updateState(item.id, 'failed', { error: errorMsg });
    publishStep('failed', item, { label: errorMsg, error: true });
    return;
  }

  let { topic, interestLine, model: aiModel, provider: aiProvider } = email;
  interestLine = normalizeInterestLineKeywords(interestLine);
  const subject = buildOutreachSubject(topic, true);

  try {
    const verify = await verifyDraft(subject, dossier.last_name || prof.last_name, interestLine, dossier, prof.email);
    if (!verify.pass) {
      console.log(`[Worker] verifyDraft failed for ${prof.email}:`, verify.reasons);
      const retry = await generateEmail(dossier, tplRow?.instructions || '', tplRow?.sample_subject || '', targetingHints, formatGreetingLastName(dossier.last_name || prof.last_name));
      if (retry.pass && retry.interestLine) {
        topic = retry.topic;
        interestLine = retry.interestLine;
        subject = buildOutreachSubject(retry.topic, true);
        aiModel = retry.model;
        aiProvider = retry.provider;
      } else {
        const settings = getSettings();
        const errorMsg = `Draft verification failed: ${(verify.reasons || []).join('; ') || 'keywords not grounded in research'}`;
        if (settings?.confidence_auto_send) {
          updateState(item.id, 'needs_review', { error: errorMsg, subject, interest_line: interestLine });
          publishStep('needs_review', item, { label: errorMsg });
          eventBus.publish({ type: 'needs_review', id: item.id, professor: prof.email, mode: itemMode, reasons: verify.reasons });
          return;
        }
        updateState(item.id, 'failed', { error: errorMsg });
        publishStep('failed', item, { label: errorMsg, error: true });
        return;
      }
    }
  } catch (e) {
    console.error(`[Worker] verifyDraft error for ${prof.email}:`, e.message);
  }

  const previewHtml = buildPreviewHtml(tplRow?.raw_html, dossier.last_name || prof.last_name, interestLine, false);

  publishCompose(item, prof, subject, interestLine, previewHtml, 'drafted', { model: aiModel, provider: aiProvider });
  updateState(item.id, 'drafted', { subject, interest_line: interestLine });
  publishStep('drafted', item, { subject, label: `Drafted with ${aiModel}`, model: aiModel, provider: aiProvider });
  eventBus.publish({ type: 'progress', id: item.id, stage: 'drafted', professor: item.prof_email, subject, model: aiModel, provider: aiProvider, duration_ms: Date.now() - stageStart });
  stageStart = Date.now();

  updateState(item.id, 'verified');
  publishStep('verified', item);
  publishCompose(item, prof, subject, interestLine, previewHtml, 'verified');
  eventBus.publish({ type: 'progress', id: item.id, stage: 'verified', professor: item.prof_email, duration_ms: Date.now() - stageStart });

  const settings = getSettings();
  const approvalMode = settings.approval_mode || 'manual';
  const shouldSend = shouldSendAfterDraft(settings, item);

  if (!shouldSend) {
    updateState(item.id, 'awaiting_proceed');
    publishStep('awaiting_proceed', item, { label: approvalMode === 'manual' ? 'Awaiting manual approval' : 'Awaiting proceed command' });
    eventBus.publish({ type: 'awaiting_proceed', professor: item.prof_email, subject, id: item.id, interest_line: interestLine });
    return;
  }

  if (!isSessionEpoch(db, loopEpoch)) return;

  publishStep('sending', item);
  publishCompose(item, prof, subject, interestLine, previewHtml, 'sending');
  const sendResult = await withRetry(() => sendEmail({ ...item, professor_id: prof.id, subject, interest_line: interestLine }));
  if (!isSessionEpoch(db, loopEpoch)) return;

  updateState(item.id, 'sent', { sent_at: new Date().toISOString() });
  db.prepare('UPDATE queue SET fast_track=0 WHERE id=?').run(item.id);

  db.prepare("INSERT INTO sent_log (professor_email, subject, topic, message_id, sent_at, mode) VALUES (?,?,?,?,datetime('now'),?)")
    .run(prof.email, subject, topic, sendResult.id || null, itemMode);
  archiveSent({ prof, subject, messageId: sendResult.id, mode: itemMode, queueId: item.id, topic, summary: `Instant send — topic: ${topic}` });
  db.prepare('INSERT OR IGNORE INTO learning_stats (topic) VALUES (?)').run(topic);
  db.prepare("UPDATE learning_stats SET sends=sends+1, last_used=datetime('now') WHERE topic=?").run(topic);

  upsertRosterRow({
    email: prof.email,
    full_name: dossier.name,
    subject_keyword: topic,
    interest_line: interestLine,
    queue_state: 'sent',
  });
  debouncedRosterSync(itemMode);

  publishStep('sent', item, { subject, messageId: sendResult.id });
  publishCompose(item, prof, subject, interestLine, previewHtml, 'sent');
  eventBus.publish({ type: 'sent', professor: prof.email, subject, messageId: sendResult.id, id: item.id });
  lastActivity = Date.now();
  ArchiveService.cacheDossier(prof.email, dossier, { mode: itemMode, queue_id: item.id });
  tryAutoAdvanceNext(itemMode, item.id);
  console.log(`[Worker] Sent to ${prof.email} — ${subject}`);
}

export function startWorkers() {
  if (shouldRun) return;
  shouldRun = true;
  const n = Math.max(1, Math.min(5, Number(getSettings()?.queue_workers) || 2));
  console.log(`[Worker] Starting ${n} parallel worker(s)`);
  for (let i = 0; i < n; i++) {
    runWorker().catch(e => console.error(`[Worker #${i}] died:`, e.message));
  }
}

export async function runWorker() {
  activeWorkers++;
  console.log('[Worker] Loop started');

  const IDLE_DELAY = 3000;
  const ACTIVE_DELAY = 500;

  while (shouldRun) {
    try {
      healStuckItems();
      const loopEpoch = getSessionEpoch(db);
      const item = getNext();
      if (!item) { await delay(IDLE_DELAY); continue; }

      if (!isSessionEpoch(db, loopEpoch)) continue;

      if (!item.duplicate_override && isDupe(item.prof_email)) {
        const dup = evaluateDuplicate(item.prof_email, getSettings());
        const prior = dup.prior || findPriorOutreach(item.prof_email);
        const itemMode = item.mode || 'instant';
        if (dup.action === 'skip') {
          updateState(item.id, 'skipped', { error: 'duplicate_skipped' });
          eventBus.publish({ type: 'skipped', id: item.id, professor: item.prof_email, error: 'duplicate_skipped', mode: itemMode });
          continue;
        }
        const sentInfo = prior || db.prepare('SELECT sent_at, subject FROM sent_log WHERE professor_email=? AND mode=? ORDER BY sent_at DESC LIMIT 1').get(item.prof_email, itemMode);
        const errorMsg = `duplicate_sent:${sentInfo?.sent_at || ''}:${sentInfo?.subject || ''}`;
        updateState(item.id, 'duplicate_review', { error: errorMsg, duplicate_override: 0 });
        recordDuplicateBlocked(item.prof_email, prior || sentInfo, { mode: itemMode, queue_id: item.id });
        eventBus.publish({ type: 'duplicate_review', id: item.id, professor: item.prof_email, previous_sent_at: sentInfo?.sent_at, previous_subject: sentInfo?.subject, mode: itemMode });
        continue;
      }

      try {
        await processQueueItem(item, loopEpoch);
      } catch (e) {
        if (isSendLimitError(e)) {
          updateState(item.id, 'failed', { error: e.message });
          eventBus.publish({ type: 'send_limit_reached', id: item.id, mode: item.mode || 'instant', error: e.message });
          console.error(`[Worker] Gmail send limit: ${e.message}`);
          await delay(10000);
        } else {
          const retries = (item.retry_count || 0) + 1;
          if (retries >= 3) {
            updateState(item.id, 'failed', { error: e.message });
          } else {
            const cooldownMin = item.fast_track ? 0.5 : 2 ** retries * 2;
            db.prepare("UPDATE queue SET retry_count=?, retry_after=datetime('now', ? || ' minutes') WHERE id=?")
              .run(retries, String(cooldownMin), item.id);
            updateState(item.id, 'pending', { error: e.message });
          }
        }
      }
    } catch (e) {
      console.error('[Worker] Unexpected loop error:', e.message);
      await delay(1000);
    }
  }

  console.log('[Worker] Loop stopped');
  activeWorkers--;
}

export function stopWorker() { shouldRun = false; }

// Legacy single-worker entry — delegates to startWorkers
export function ensureWorkersRunning() {
  if (!shouldRun) startWorkers();
}
