import { Router } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import mammoth from 'mammoth';
import { readFileSync, unlinkSync } from 'fs';
import { createRequire } from 'module';
import db from '../db/index.js';
import { findPriorOutreach, recordDuplicateBlocked } from '../db/duplicateCheck.js';
import { lastNameFromEmail, fullNameFromEmail, universityFromEmail } from '../utils/professor.js';
import { eventBus } from '../core/EventBus.js';
import { prioritizeQueue } from '../pipeline/index.js';
import { AuthService } from '../services/AuthService.js';
import { keywordsFromProfileOnly } from '../ai/index.js';
import { normalizeInterestLineKeywords } from '../utils/interestLine.js';
import {
  enrichProfessorFromEmailImport,
  getProfileResearchStatus,
  profileResearchStatusLabelForDossier,
} from '../research/profileResearch.js';
import { parseSpreadsheetRows, entriesToEmailList, entriesToNormalizedSheet, parseTextDocumentToEntries } from '../utils/spreadsheetParser.js';
import { evaluateDuplicate } from '../db/duplicatePolicy.js';
import { autoStartBatchQueue } from '../services/batchRunner.js';
import { writeRosterExcelFromImport, upsertRosterRow } from '../learning/rosterExcel.js';
import { buildOutreachSubject, buildBasicOutreachSubject, getBasicSubjectMode } from '../gmail/basicTemplate.js';
import { resolveRosterUniversityLocations } from '../learning/universityLocationResolver.js';
import { createInstantQueueGroup, removeEmptyInstantQueueGroup } from '../services/instantQueueGroups.js';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

const router = Router();
const upload = multer({ dest: 'uploads/', limits: { fileSize: 50 * 1024 * 1024 } });

const EMAIL_REGEX = /[\w.-]+@[\w.-]+\.[a-z]{2,}/gi;
const BLOCKED_TEST_DOMAINS = ['example.com', 'example.edu'];

function isBlockedTestEmail(email) {
  return BLOCKED_TEST_DOMAINS.some(domain => email.includes(domain));
}

function blockedTestEmailMessage(count) {
  const suffix = count === 1 ? 'email uses' : 'emails use';
  return `No importable email addresses found. ${count} ${suffix} example.com/example.edu, which are ignored for safety. Use a real university-style test domain.`;
}

function cleanEmails(raw) {
  return [...new Set(raw)].filter(e =>
    !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.gif') &&
    !isBlockedTestEmail(e) && !e.includes('noreply') && !e.includes('no-reply') &&
    e.length < 80
  );
}

function cleanupUpload(file) {
  if (!file?.path) return;
  try {
    unlinkSync(file.path);
  } catch (e) {
    console.warn(`[Upload] Temp cleanup failed: ${e.message}`);
  }
}

async function ocrExtract(buffer) {
  try {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    const { data: { text } } = await worker.recognize(buffer);
    await worker.terminate();
    return text;
  } catch (e) {
    console.log(`[OCR] Failed: ${e.message}`);
    return '';
  }
}

function splitKeywordText(text) {
  return String(text || '')
    .split(/[,;|]/)
    .map(s => s.trim())
    .filter(Boolean);
}

function rosterDossierFromEntry(entry) {
  const normalizedInterest = normalizeInterestLineKeywords(entry.interest_line || entry.research_interest || '');
  const research_areas = splitKeywordText(normalizedInterest);
  const last_name = String(entry.last_name || '').trim();
  const full_name = String(entry.full_name || '').trim();
  return {
    email: entry.email,
    last_name,
    name: full_name || last_name,
    university: entry.university || universityFromEmail(entry.email),
    university_country: entry.university_country || null,
    university_state: entry.university_state || null,
    research_areas,
    papers: [],
    profile_url: entry.profile_url || '',
    department: entry.department || '',
    interest_line: normalizedInterest,
    subject_keyword: entry.subject_keyword || '',
    verified: last_name.length >= 2,
    name_verified: last_name.length >= 2,
    research_source: 'roster',
    roster_import: true,
    profile_research_status: (entry.subject_keyword?.trim() && normalizedInterest) ? 'profile_found' : undefined,
    keyword_source: (entry.subject_keyword?.trim() && normalizedInterest) ? 'roster' : undefined,
    roster: {
      full_name: full_name || null,
      last_name,
      department: entry.department,
      research_interest: normalizedInterest,
      profile_url: entry.profile_url,
    },
  };
}

async function parseFile(filePath, ext) {
  let emails = [];
  let preview = null;
  let rosterEntries = null;

  if (['xlsx', 'xls', 'csv'].includes(ext)) {
    const workbook = XLSX.readFile(filePath);
    const allRows = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      allRows.push(...XLSX.utils.sheet_to_json(sheet, { header: 1 }));
    }

    const { entries, hasStructuredColumns } = parseSpreadsheetRows(allRows);
    await resolveRosterUniversityLocations(entries);
    rosterEntries = rosterEntries || entries;

    if (!rosterEntries.length) {
      for (const row of allRows) {
        for (const cell of row || []) {
          if (typeof cell === 'string') {
            const found = cell.match(EMAIL_REGEX);
            if (found) emails.push(...found);
          }
        }
      }
      rosterEntries = [...new Set(emails.map(e => e.toLowerCase()))].map(email => ({
        email,
        full_name: fullNameFromEmail(email) || null,
        last_name: lastNameFromEmail(email) || null,
        university: universityFromEmail(email),
        source: 'email_extract',
      }));
      emails = rosterEntries.map(e => e.email);
    } else {
      emails = entriesToEmailList(rosterEntries);
    }

    const normalized = entriesToNormalizedSheet(rosterEntries);
    preview = {
      type: 'spreadsheet',
      sheets: [normalized],
      organized: true,
      parseStats: {
        total: rosterEntries.length,
        withName: rosterEntries.filter(e => e.last_name?.length >= 2).length,
        withKeywords: rosterEntries.filter(e => (e.subject_keyword || e.interest_line || e.research_interest)?.trim()).length,
        structured: hasStructuredColumns,
      },
    };
    return { preview, emails, rosterEntries };
  } else if (ext === 'pdf') {
    const buffer = readFileSync(filePath);
    const data = await pdf(buffer);
    let text = data.text || '';
    if (text.replace(/\s/g, '').length < 50) {
      text = await ocrExtract(buffer);
    }
    const found = text.match(EMAIL_REGEX);
    if (found) emails.push(...found);
    rosterEntries = entriesFromExtractedText(text, [...new Set(emails.map(e => e.toLowerCase()))]);
    emails = rosterEntries.map(e => e.email);
    preview = buildRosterPreviewFromEntries(rosterEntries) || { type: 'document', content: text.slice(0, 5000) };
  } else if (['docx', 'doc'].includes(ext)) {
    const buffer = readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value || '';
    const found = text.match(EMAIL_REGEX);
    if (found) emails.push(...found);
    rosterEntries = entriesFromExtractedText(text, [...new Set(emails.map(e => e.toLowerCase()))]);
    emails = rosterEntries.map(e => e.email);
    preview = buildRosterPreviewFromEntries(rosterEntries) || { type: 'document', content: text.slice(0, 5000) };
  } else if (['txt', 'text'].includes(ext)) {
    const text = readFileSync(filePath, 'utf8');
    const found = text.match(EMAIL_REGEX);
    if (found) emails.push(...found);
    rosterEntries = entriesFromExtractedText(text, [...new Set(emails.map(e => e.toLowerCase()))]);
    emails = rosterEntries.map(e => e.email);
    preview = buildRosterPreviewFromEntries(rosterEntries) || { type: 'text', content: text.slice(0, 10000) };
  } else if (['png', 'jpg', 'jpeg', 'tiff', 'bmp'].includes(ext)) {
    const buffer = readFileSync(filePath);
    const text = await ocrExtract(buffer);
    const found = text.match(EMAIL_REGEX);
    if (found) emails.push(...found);
    rosterEntries = entriesFromExtractedText(text, [...new Set(emails.map(e => e.toLowerCase()))]);
    emails = rosterEntries.map(e => e.email);
    preview = buildRosterPreviewFromEntries(rosterEntries) || { type: 'document', content: text.slice(0, 5000) };
  } else {
    return { error: `Unsupported: ${ext}. Use xlsx, csv, pdf, docx, txt, or images.` };
  }

  const normalizedEmails = emails.map(e => e.toLowerCase());
  const blockedTestEmails = normalizedEmails.filter(isBlockedTestEmail);
  emails = cleanEmails(normalizedEmails);
  if (!emails.length && blockedTestEmails.length) {
    return { error: blockedTestEmailMessage(blockedTestEmails.length) };
  }

  if (!rosterEntries && emails.length) {
    rosterEntries = emails.map(email => ({
      email,
      full_name: fullNameFromEmail(email) || null,
      last_name: lastNameFromEmail(email) || null,
      university: universityFromEmail(email),
      source: 'email_extract',
    }));
  }

  return { preview, emails, rosterEntries: rosterEntries || null };
}

function rosterFieldsFromImport(p, queueState = 'pending') {
  const d = p.dossier || {};
  const roster = d.roster || {};
  const status = getProfileResearchStatus(d);
  return {
    email: p.email,
    full_name: d.name || roster.full_name || '',
    last_name: d.last_name || roster.last_name || '',
    university: d.university || '',
    research_interest: (d.research_areas || []).join(', ') || roster.research_interest || '',
    subject_keyword: p.subject_keyword || d.subject_keyword || '',
    interest_line: p.interest_line || d.interest_line || '',
    profile_research_status: d.profile_research_status || status,
    research_info: profileResearchStatusLabelForDossier(d),
    queue_state: queueState,
  };
}

function buildRosterPreviewFromEntries(rosterEntries) {
  if (!rosterEntries?.length) return null;
  const normalized = entriesToNormalizedSheet(rosterEntries);
  return {
    type: 'spreadsheet',
    sheets: [normalized],
    organized: true,
    parseStats: {
      total: rosterEntries.length,
      withName: rosterEntries.filter(e => e.last_name?.length >= 2).length,
      withKeywords: rosterEntries.filter(e => (e.research_interest || e.interest_line || e.subject_keyword)?.trim()).length,
      structured: rosterEntries.some(e => e.source === 'roster'),
    },
  };
}

function entriesFromExtractedText(text, fallbackEmails) {
  const parsed = parseTextDocumentToEntries(text);
  if (parsed.length) return parsed;
  return (fallbackEmails || []).map(email => ({
    email,
    full_name: fullNameFromEmail(email) || null,
    last_name: lastNameFromEmail(email) || null,
    university: universityFromEmail(email),
    source: 'email_extract',
  }));
}

function applyRosterQueueFields(queueId, row, mode = 'instant') {
  if (!queueId) return;
  const isBasic = mode === 'basic_instant' || mode === 'basic_scheduled';
  const settings = db.prepare('SELECT basic_subject_keyword, basic_search_subject_keyword FROM settings WHERE id=1').get() || {};
  const subjectMode = isBasic ? getBasicSubjectMode(settings) : 'search';
  const updates = [];
  const vals = [];
  if (row.interest_line) {
    updates.push('interest_line=?');
    vals.push(row.interest_line);
  }
  if (subjectMode === 'default') {
    updates.push('subject=?');
    vals.push(buildBasicOutreachSubject('default'));
  } else if (subjectMode === 'search' && row.subject_keyword) {
    updates.push('subject=?');
    vals.push(buildBasicOutreachSubject('search', row.subject_keyword));
  } else if (!isBasic && row.subject_keyword) {
    updates.push('subject=?');
    vals.push(buildOutreachSubject(row.subject_keyword, true));
  }
  if (!updates.length) return;
  vals.push(queueId);
  db.prepare(`UPDATE queue SET ${updates.join(', ')} WHERE id=?`).run(...vals);
}

async function insertEmails(emailsOrEntries, mode = 'instant', queueGroupId = null) {
  const settings = db.prepare('SELECT * FROM settings WHERE id=1').get() || {};
  const isEntryObjects = emailsOrEntries?.length && typeof emailsOrEntries[0] === 'object';
  const entries = isEntryObjects ? emailsOrEntries : emailsOrEntries.map(e => ({ email: e, last_name: null }));
  if (isEntryObjects) await resolveRosterUniversityLocations(entries);
  const emails = entries.map(e => e.email);

  const RESEARCH_BATCH = 10;
  const researched = [];

  for (let b = 0; b < entries.length; b += RESEARCH_BATCH) {
    const batch = entries.slice(b, b + RESEARCH_BATCH);

    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        const email = entry.email;

        if (isEntryObjects) {
          const dossier = rosterDossierFromEntry(entry);
          if (!dossier.subject_keyword || !dossier.interest_line) {
            const fromProfile = keywordsFromProfileOnly(dossier);
            if (fromProfile?.subject_keyword) {
              dossier.subject_keyword = dossier.subject_keyword || fromProfile.subject_keyword;
              dossier.interest_line = dossier.interest_line || (fromProfile.interest_keywords || []).slice(0, 3).join(', ');
              dossier.keyword_source = fromProfile.source || 'roster';
            }
          }
          if (dossier.subject_keyword && (dossier.interest_line || dossier.research_areas?.length)) {
            dossier.profile_research_status = 'profile_found';
          }
          return {
            email,
            dossier,
            interest_line: entry.interest_line || dossier.interest_line || '',
            subject_keyword: entry.subject_keyword || dossier.subject_keyword || '',
            queueState: 'pending',
            success: true,
            skippedResearch: true,
          };
        }

        try {
          eventBus.publish({
            type: 'import_research_progress',
            email,
            phase: 'researching',
            label: `Organizing profile data for ${email}`,
          });
          const prof = {
            email,
            last_name: entry.last_name || lastNameFromEmail(email),
            university: entry.university || universityFromEmail(email),
            profile_url: entry.profile_url || '',
          };
          const enriched = await enrichProfessorFromEmailImport({
            prof,
            mode,
          });
          if (entry.last_name?.length >= 2 && enriched.dossier) {
            enriched.dossier.last_name = entry.last_name;
          }
          if (entry.research_interest && enriched.dossier) {
            enriched.dossier.research_areas = splitKeywordText(entry.research_interest);
          }
          return {
            email,
            dossier: enriched.dossier,
            interest_line: enriched.dossier.interest_line || entry.interest_line || '',
            subject_keyword: enriched.dossier.subject_keyword || entry.subject_keyword || '',
            queueState: enriched.queueState,
            success: true,
          };
        } catch (e) {
          const dossier = rosterDossierFromEntry(entry);
          if (!dossier.last_name) dossier.last_name = lastNameFromEmail(email);
          dossier.profile_research_status = 'none_on_page';
          return {
            email,
            dossier,
            interest_line: entry.interest_line || '',
            subject_keyword: entry.subject_keyword || '',
            queueState: 'needs_web_research',
            success: false,
          };
        }
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') researched.push(r.value);
    }
  }

  const isSingle = emails.length === 1;
  const initialState = isSingle ? 'awaiting_proceed' : 'pending';
  const insert = db.prepare('INSERT OR IGNORE INTO professors (email, last_name, university, research_areas, dossier, mode, name_verified) VALUES (?,?,?,?,?,?,?)');
  const insertQueue = db.prepare('INSERT INTO queue (professor_id, state, mode, queue_group_id) VALUES (?,?,?,?)');
  const BLOCKED_STATES = ['sent', 'researching', 'drafted', 'verified', 'sending'];
  let added = 0;
  let skipped = 0;
  let singleQueueId = null;
  const queueIds = [];

  const insertAll = db.transaction((researchedRows) => {
    for (const p of researchedRows) {
    let profId;
    const existing = db.prepare('SELECT id FROM professors WHERE email=? AND mode=?').get(p.email, mode);
    if (existing) {
      profId = existing.id;
      db.prepare('UPDATE professors SET last_name=?, university=?, research_areas=?, dossier=?, name_verified=?, source_url=? WHERE id=?').run(
        p.dossier.last_name || lastNameFromEmail(p.email),
        p.dossier.university || '',
        (p.dossier.research_areas || []).join(', '),
        JSON.stringify(p.dossier),
        p.dossier.name_verified ? 1 : 0,
        p.dossier.profile_url || '',
        profId
      );
    } else {
      const info = insert.run(
        p.email,
        p.dossier.last_name || lastNameFromEmail(p.email),
        p.dossier.university || '',
        (p.dossier.research_areas || []).join(', '),
        JSON.stringify(p.dossier),
        mode,
        p.dossier.name_verified ? 1 : 0
      );
      profId = info.lastInsertRowid;
      if (p.dossier.profile_url) {
        db.prepare('UPDATE professors SET source_url=? WHERE id=?').run(p.dossier.profile_url, profId);
      }
    }

    const dup = evaluateDuplicate(p.email, settings);

    const queued = db.prepare('SELECT id, state, error, queue_group_id FROM queue WHERE professor_id=? AND mode=? ORDER BY id DESC LIMIT 1').get(profId, mode);
    if (queued && (!queueGroupId || Number(queued.queue_group_id) === Number(queueGroupId))) {
      // Don't re-queue items that are already sent or in a terminal/active state
      if (BLOCKED_STATES.includes(queued.state) || queued.state === 'skipped' && queued.error === 'duplicate_skipped') {
        skipped++;
        continue;
      }
      if (isSingle) {
        db.prepare("UPDATE queue SET state='awaiting_proceed', error=NULL, retry_count=0, retry_after=NULL WHERE id=? AND state NOT IN ('sent','researching','drafted','verified','sending')").run(queued.id);
        singleQueueId = queued.id;
        applyRosterQueueFields(queued.id, p, mode);
        const qState = p.queueState || (isSingle ? 'awaiting_proceed' : 'pending');
        upsertRosterRow(rosterFieldsFromImport(p, qState));
        added++;
      } else {
        const qState = p.queueState || 'pending';
        db.prepare("UPDATE queue SET state=?, error=NULL, retry_count=0, retry_after=NULL WHERE id=? AND state NOT IN ('sent','researching','drafted','verified','sending')")
          .run(qState, queued.id);
        if (qState === 'needs_web_research') {
          db.prepare("UPDATE queue SET error=? WHERE id=?").run('No research found — use Web Search', queued.id);
        }
        queueIds.push(queued.id);
        applyRosterQueueFields(queued.id, p, mode);
        upsertRosterRow(rosterFieldsFromImport(p, qState));
        added++;
      }
      continue;
    }

    if (dup.blocked && dup.action === 'skip') {
      const qInfo = insertQueue.run(profId, 'skipped', mode, queueGroupId);
      db.prepare("UPDATE queue SET error='duplicate_skipped' WHERE id=?").run(qInfo.lastInsertRowid);
      queueIds.push(qInfo.lastInsertRowid);
      skipped++;
      continue;
    }

    if (dup.blocked && dup.action === 'review') {
      const qInfo = insertQueue.run(profId, 'duplicate_review', mode, queueGroupId);
      db.prepare("UPDATE queue SET error=? WHERE id=?").run(`duplicate_sent:${dup.prior?.sent_at}:${dup.prior?.subject || ''}`, qInfo.lastInsertRowid);
      recordDuplicateBlocked(p.email, dup.prior, { mode, queue_id: qInfo.lastInsertRowid });
      added++;
      continue;
    }

    const queueState = isSingle ? initialState : (p.queueState || initialState);
    const qInfo = insertQueue.run(profId, queueState, mode, queueGroupId);
    if (queueState === 'needs_web_research') {
      db.prepare("UPDATE queue SET error=? WHERE id=?").run('No research found — use Web Search', qInfo.lastInsertRowid);
    }
    added++;
    const queueId = qInfo.lastInsertRowid;
    if (isSingle) {
      singleQueueId = queueId;
    } else {
      queueIds.push(queueId);
    }
    applyRosterQueueFields(queueId, p, mode);
    upsertRosterRow(rosterFieldsFromImport(p, queueState));
    }
  });

  insertAll(researched);

  return { added, skipped, singleQueueId: isSingle ? singleQueueId : null, awaitingProceed: isSingle, queueIds, isSingle };
}

router.post('/upload/preview', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const ext = req.file.originalname.split('.').pop().toLowerCase();

  try {
    const result = await parseFile(req.file.path, ext);
    if (result.error) return res.status(400).json({ error: result.error });
    if (result.rosterEntries?.length) {
      writeRosterExcelFromImport(result.rosterEntries, req.body?.mode || 'instant');
    }
    res.json({ ...result.preview, emails: result.emails, rosterEntries: result.rosterEntries, filename: req.file.originalname });
  } catch (e) {
    console.error('[Upload/Preview] Error:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    cleanupUpload(req.file);
  }
});

router.post('/upload/validate', async (req, res) => {
  const { emails, rosterEntries, mode, max_professors } = req.body;
  const list = rosterEntries?.length ? rosterEntries : emails;
  const { validateProfessorEntries, validateEmailList } = await import('../validation/importValidation.js');
  const result = rosterEntries?.length
    ? validateProfessorEntries(rosterEntries, { mode: mode || 'instant', maxProfessors: max_professors })
    : validateEmailList(list, { mode: mode || 'instant', maxProfessors: max_professors });
  res.json(result);
});

router.post('/upload/roster', (req, res) => {
  try {
    const { rosterEntries } = req.body;
    if (!rosterEntries?.length) return res.status(400).json({ error: 'rosterEntries array required' });
    const rows = writeRosterExcelFromImport(rosterEntries, req.body?.mode || 'instant');
    res.json({ ok: true, count: rows.length });
  } catch (e) {
    console.error('[Upload/Roster] Error:', e.message);
    res.status(500).json({ error: e.message || 'Failed to write roster' });
  }
});

router.post('/upload/confirm', async (req, res) => {
  let queueGroup = null;
  try {
    const { emails, rosterEntries, mode, max_professors, auto_start, approval_mode } = req.body;
    const payload = rosterEntries?.length ? rosterEntries : emails;
    if (!payload || !Array.isArray(payload)) return res.status(400).json({ error: 'emails or rosterEntries array required' });
    if (approval_mode === 'auto' || approval_mode === 'manual') {
      db.prepare('UPDATE settings SET approval_mode=?, auto_send=? WHERE id=1')
        .run(approval_mode, approval_mode === 'auto' ? 1 : 0);
    }
    const limited = max_professors ? payload.slice(0, max_professors) : payload;
    const isEntries = typeof limited[0] === 'object';
    if (isEntries) writeRosterExcelFromImport(limited, mode || 'instant');
    queueGroup = createInstantQueueGroup(mode || 'instant', 'file_import');
    const result = await insertEmails(limited, mode || 'instant', queueGroup.id);
    let autoStart = { autoStarted: false, templateLoaded: false };
    if (result.added > 0 || auto_start) {
      const ids = result.isSingle && result.singleQueueId ? [result.singleQueueId] : result.queueIds;
      autoStart = await autoStartBatchQueue(ids, 'file_import', mode || 'instant');
    }
    res.json({
      added: result.added,
      skipped: result.skipped,
      total: limited.length,
      singleQueueId: result.singleQueueId,
      awaitingProceed: result.awaitingProceed && !autoStart.autoStarted,
      autoStarted: autoStart.autoStarted,
      templateLoaded: autoStart.templateLoaded,
      queue: queueGroup,
    });
  } catch (e) {
    if (queueGroup?.id) removeEmptyInstantQueueGroup(queueGroup.id);
    console.error('[Upload/Confirm] Error:', e.message);
    res.status(500).json({ error: e.message || 'Upload confirm failed' });
  }
});

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const ext = req.file.originalname.split('.').pop().toLowerCase();
  let queueGroup = null;

  try {
    const parsed = await parseFile(req.file.path, ext);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    queueGroup = createInstantQueueGroup(req.body.mode || 'instant', 'file_import');
    const inserted = await insertEmails(parsed.emails, req.body.mode || 'instant', queueGroup.id);
    let autoStart = { autoStarted: false, templateLoaded: false };
    if (inserted.added > 0) {
      const ids = inserted.isSingle && inserted.singleQueueId ? [inserted.singleQueueId] : inserted.queueIds;
      autoStart = await autoStartBatchQueue(ids, 'file_import', req.body.mode || 'instant');
    }
    res.json({
      added: inserted.added,
      skipped: inserted.skipped,
      total: parsed.emails.length,
      emails: parsed.emails,
      autoStarted: autoStart.autoStarted,
      templateLoaded: autoStart.templateLoaded,
      queue: queueGroup,
    });
  } catch (e) {
    if (queueGroup?.id) removeEmptyInstantQueueGroup(queueGroup.id);
    console.error('[Upload] Error:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    cleanupUpload(req.file);
  }
});

export default router;
