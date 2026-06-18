import db from '../db/index.js';
import { scrapeFacultyPage } from '../research/index.js';
import { enrichProfessorFromScrape, buildScrapeRosterRow, getProfileResearchStatus, profileResearchStatusLabelForDossier } from '../research/profileResearch.js';
import { basicLastNameResearch, hasBasicLastName } from '../research/basicLastNameResearch.js';
import { AuthService } from '../services/AuthService.js';
import { GmailService } from '../services/GmailService.js';
import { getSessionEpoch, isSessionEpoch } from '../session/epoch.js';
import { prioritizeQueue } from '../pipeline/index.js';
import { delay } from './utils.js';
import { upsertRosterRow, syncRosterFromDb, readRosterExcel, hasSubstantiveRosterData, isSparseRosterRow } from '../learning/rosterExcel.js';
import { capitalizeWord } from '../utils/professor.js';

let activeJob = null;

function jobAborted(job) {
  if (!job || job.cancelled) return true;
  return !isSessionEpoch(db, job.sessionEpoch);
}

export function getScrapeStatus() {
  if (!activeJob?.running) return { running: false };
  return { ...activeJob, running: true };
}

export function cancelScrapeJob() {
  if (activeJob) activeJob.cancelled = true;
}

export function resetScrapeJob() {
  if (activeJob) activeJob.cancelled = true;
}

function hasUsefulData(dossier, mode = 'instant') {
  if (!dossier) return false;
  if (mode === 'basic_instant') return hasBasicLastName(dossier);
  return dossier.email_verified && (
    dossier.papers?.length > 0 ||
    dossier.research_areas?.length > 0 ||
    !!dossier.department
  );
}

export function startFacultyImport(url, publish, options = {}) {
  if (activeJob?.running && !activeJob.cancelled) {
    return { started: false, error: 'Import already in progress' };
  }

  const sessionEpoch = getSessionEpoch(db);

  const job = {
    running: true,
    cancelled: false,
    sessionEpoch,
    jobId: Date.now(),
    url,
    mode: options.mode || 'instant',
    max_professors: options.max_professors || null,
    skip_designations: options.skip_designations || [],
    phase: 'discovering',
    current: 0,
    total: 0,
    added: 0,
    skipped: 0,
    currentEmail: null,
    roster: [],
    queuedIds: [],
  };
  activeJob = job;

  runImport(job, url, publish).catch(e => {
    if (!jobAborted(job)) {
      console.error('[ScrapeJob] Failed:', e.message);
      publish({ type: 'scrape_error', error: e.message });
    }
  }).finally(() => {
    job.running = false;
    if (activeJob === job) activeJob = null;
  });

  return { started: true };
}

async function runImport(job, url, publish) {
  if (!job) return;

  const existingRosterByEmail = new Map(
    readRosterExcel().map(r => [(r.email || '').toLowerCase(), r]),
  );
  publish({ type: 'scrape_progress', phase: 'discovering', current: 0, total: 0, mode: job.mode });

  const professors = await scrapeFacultyPage(url, {
    skipDesignations: job.skip_designations || [],
    onProgress: (p) => {
      if (jobAborted(job)) return;
      Object.assign(job, p);
      if (activeJob === job) publish({ type: 'scrape_progress', ...p });
    },
    onFound: (p) => {
      if (jobAborted(job)) return;
      publish({
        type: 'scrape_found',
        professorName: p.name || '',
        professorEmail: p.email,
        phase: 'discovering',
        step: p.step || 'page_fetch',
      });
    },
  });

  // Apply max_professors limit after scraping
  const limitedProfessors = job.max_professors ? professors.slice(0, job.max_professors) : professors;
  const rosterSkipped = limitedProfessors.filter(p => {
    const existing = existingRosterByEmail.get((p.email || '').toLowerCase());
    return existing && hasSubstantiveRosterData(existing);
  });
  const professorsToProcess = limitedProfessors.filter(p => {
    const existing = existingRosterByEmail.get((p.email || '').toLowerCase());
    return !existing || isSparseRosterRow(existing);
  });
  console.log(`[ScrapeJob] Found ${professors.length} professors, processing ${professorsToProcess.length} (${rosterSkipped.length} kept from existing roster)`);

  if (jobAborted(job)) {
    publish({ type: 'scrape_cancelled', reason: 'reset' });
    return;
  }

  job.phase = 'enriching';
  job.total = professorsToProcess.length;
  publish({ type: 'scrape_progress', phase: 'enriching', current: 0, total: professorsToProcess.length, mode: job.mode });

  const insertProf = db.prepare('INSERT OR IGNORE INTO professors (email, last_name, source_url, university, research_areas, dossier, mode) VALUES (?,?,?,?,?,?,?)');
  const insertQueue = db.prepare('INSERT INTO queue (professor_id, state, mode) VALUES (?,?,?)');
  const updateProf = db.prepare('UPDATE professors SET last_name=?, research_areas=?, dossier=?, source_url=?, university=? WHERE email=? AND mode=?');

  let added = 0;
  let skipped = rosterSkipped.length;
  job.skipped = skipped;
  const RESEARCH_BATCH = 10;
  const isBasicInstant = job.mode === 'basic_instant';

  for (let b = 0; b < professorsToProcess.length; b += RESEARCH_BATCH) {
    if (jobAborted(job)) break;

    const batch = professorsToProcess.slice(b, b + RESEARCH_BATCH);

    const dossiers = await Promise.allSettled(
      batch.map(async p => {
        try {
          if (isBasicInstant) {
            const dossier = await basicLastNameResearch(p.email, url, p.profile_url || p.source_url || '');
            const enriched = await enrichProfessorFromScrape({
              prof: { ...p, ...dossier, name: dossier.name || p.name },
              sourceUrl: url,
              mode: job.mode,
            });
            return enriched;
          }
          const enriched = await enrichProfessorFromScrape({
            prof: p,
            sourceUrl: url,
            mode: job.mode,
          });
          return enriched;
        } catch (e) {
          console.error(`[ScrapeJob] Dossier failed ${p.email}:`, e.message);
          return null;
        }
      })
    );

    for (let i = 0; i < batch.length; i++) {
      if (jobAborted(job)) break;

      const p = batch[i];
      const result = dossiers[i];
      const enrichResult = result.status === 'fulfilled' ? result.value : null;
      const dossier = enrichResult?.dossier || enrichResult || null;
      const queueState = enrichResult?.queueState || 'pending';

      const idx = b + i;
      job.current = idx + 1;
      job.currentEmail = p.email;
      job.currentName = p.name;

      const stepPhase = isBasicInstant ? 'lastname_lookup' : 'profile_scrape';
      publish({
        type: 'scrape_progress',
        phase: stepPhase,
        step: isBasicInstant ? 'enriching' : 'deep_scrape',
        current: idx + 1,
        total: professorsToProcess.length,
        email: p.email,
        name: p.name,
        mode: job.mode,
        label: isBasicInstant
          ? `Looking up last name ${idx + 1}/${professorsToProcess.length}`
          : `Profile ${idx + 1}/${professorsToProcess.length}: ${p.name || p.email}`,
      });

      const lastName = capitalizeWord(dossier?.last_name || p.last_name || '');
      const university = dossier?.university || p.email.split('@')[1]?.replace(/\.edu$/, '').replace(/\./g, ' ') || '';
      const researchAreas = (dossier?.research_areas || []).join(', ');
      const profileUrl = dossier?.profile_url || p.profile_url || p.source_url || url;
      const verified = hasUsefulData(dossier, job.mode);
      const needsWeb = queueState === 'needs_web_research';
      const researchStatus = getProfileResearchStatus(dossier);
      const statusLabel = profileResearchStatusLabelForDossier(dossier);

      if (!verified && !needsWeb) {
        skipped++;
        job.skipped = skipped;
        publish({
          type: 'scrape_skipped',
          email: p.email,
          mode: job.mode,
          reason: isBasicInstant ? 'Could not determine last name' : 'No verified profile — queued for fallback send',
        });
        if (isBasicInstant) continue;
      }

      let profId;
      const existing = db.prepare('SELECT id FROM professors WHERE email=? AND mode=?').get(p.email, job.mode);
      if (existing) {
        updateProf.run(lastName, researchAreas, JSON.stringify(dossier || {}), profileUrl, university, p.email, job.mode);
        profId = existing.id;
      } else {
        const info = insertProf.run(p.email, lastName, profileUrl, university, researchAreas, JSON.stringify(dossier || {}), job.mode);
        profId = info.lastInsertRowid;
      }

      const rosterRow = buildScrapeRosterRow({
        prof: p,
        dossier,
        queueState,
        mode: job.mode,
        statusLabel,
        researchStatus,
      });
      job.roster.push(rosterRow);
      publish({ type: 'roster_row', row: rosterRow, index: job.roster.length });

      const inQueue = db.prepare('SELECT id, state FROM queue WHERE professor_id=? AND mode=? ORDER BY id DESC LIMIT 1').get(profId, job.mode);
      const alreadySent = db.prepare('SELECT 1 FROM sent_log WHERE professor_email=? AND mode=?').get(p.email, job.mode);
      let queueId;

      if (alreadySent) {
        skipped++;
        job.skipped = skipped;
        publish({ type: 'scrape_skipped', email: p.email, reason: 'Already sent — skipping duplicate' });
        continue;
      }

      if (!inQueue) {
        const qInfo = insertQueue.run(profId, queueState, job.mode);
        queueId = qInfo.lastInsertRowid;
        added++;
      } else {
        queueId = inQueue.id;
        db.prepare("UPDATE queue SET state=?, retry_count=0, retry_after=NULL, error=NULL, fast_track=? WHERE id=?")
          .run(queueState, 0, queueId);
        added++;
      }
      job.queuedIds.push(queueId);

      job.added = added;
      job.skipped = skipped;
      publish({ type: 'scrape_progress', phase: 'enriching', current: idx + 1, total: professorsToProcess.length, email: p.email, name: dossier?.name || p.name, added, skipped });
    }
  }

  if (jobAborted(job)) {
    publish({ type: 'scrape_cancelled', reason: 'reset' });
    return;
  }

  for (const rosterRow of job.roster) {
    upsertRosterRow(rosterRow);
  }
  syncRosterFromDb(job.mode);

  job.phase = 'template';
  publish({ type: 'scrape_progress', phase: 'template', current: job.total, total: job.total, rosterCount: job.roster.length });

  let templateResult = { success: false };
  if (AuthService.isConnected()) {
    try {
      templateResult = await GmailService.tryAutoLoadTemplate('batch_scrape', job.mode);
    } catch (e) {
      console.error('[ScrapeJob] Template load failed:', e.message);
    }
  }

  if (jobAborted(job)) {
    publish({ type: 'scrape_cancelled', reason: 'reset' });
    return;
  }

  if (job.queuedIds.length > 0) {
    const placeholders = job.queuedIds.map(() => '?').join(',');
    db.prepare(`UPDATE queue SET fast_track=0, retry_after=NULL, error=NULL WHERE id IN (${placeholders}) AND state='pending'`).run(...job.queuedIds);
    for (const qid of job.queuedIds) prioritizeQueue(qid);
    publish({
      type: 'batch_auto_start',
      count: job.queuedIds.length,
      label: `Auto-starting outreach for ${job.queuedIds.length} professors`,
    });
  }

  syncRosterFromDb(job.mode);

  publish({
    type: 'scrape_complete',
    added,
    skipped,
    total: professorsToProcess.length,
    templateLoaded: templateResult.success,
    roster: job.roster,
    autoStarted: job.queuedIds.length > 0,
    mode: job.mode,
  });

  console.log(`[ScrapeJob] Done — ${added} queued, ${skipped} skipped, auto-start ${job.queuedIds.length}`);
}
