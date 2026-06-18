import { bumpSessionEpoch, getSessionEpoch } from '../session/epoch.js';
import { clearRosterExcel } from '../learning/rosterExcel.js';
import {
  loadTemplateFromFile,
  seedBasicInstantTemplate,
  seedBasicScheduledTemplate,
  BASIC_INSTRUCTIONS,
  BASIC_SUBJECT,
} from '../gmail/templateSeeder.js';

const DEFAULT_INSTRUCTIONS = `ONLY change 3 things per email — the rest must stay EXACTLY as in the template:

1. SUBJECT: "[Single Keyword] Seeking an MS/PhD Position in Your Lab" — pick ONE research area (1-3 words) from the professor's actual work that aligns with my background (AI/ML, ViT, Perceiver IO, multimodal, deepfake detection, forecasting). Replace [Keyword] with that area.

2. GREETING: Replace {{LAST_NAME}} with the professor's actual last name. Format: "Dear Professor LastName," — use their real last name from research, not guessed from email.

3. INTEREST LINE: Replace {{INTEREST_LINE}} with EXACTLY 3 research keywords extracted from the professor's profile (comma-separated, e.g., "semantic web services, cloud computing, self-healing systems"). These must come from their REAL research areas found during research — NOT generic terms. MAXIMUM 30 words total. DO NOT mention paper titles, publications, or citation details — only research area keywords.

TEMPLATE STRUCTURE (do NOT change any other part):
- Opening: "Greetings!" — stays identical
- My background paragraph (AI/ML, medical imaging, multimodal, deepfake, forecasting) — stays identical
- My publications list (Medical Imaging ViT, GCViT, Multimodal-FNet, Photovoltaic) — stays identical
- My methods paragraph (CNNs, LSTM/GRU, ViT, Perceiver IO, GCViT, multimodal fusion, time-series, Python, PyTorch, TensorFlow, Scikit-learn, XGBoost) — stays identical
- Interest line: "I am particularly interested in your work in {{INTEREST_LINE}}" — ONLY change {{INTEREST_LINE}} with 3 keywords, max 30 words, NO paper titles
- Closing request: "I would be glad if you have any open MS/PhD or research assistant positions in your lab." — stays identical
- Thank you + signature (Habib Ur Rehman) — stays identical`;

const DEFAULT_SUBJECT = '[Keyword] Seeking an MS/PhD Position in Your Lab';

/** Permanent history/analytics tables — never cleared by reset (used across all modes). */
const ANALYTICS_TABLES = ['sent_email_history', 'sent_log', 'replies', 'learning_stats', 'scheduled_sent_log', 'scheduled_replies'];

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get().c;
}

function resetInstantTemplate(db, mode) {
  if (mode === 'basic_instant') {
    db.prepare(`UPDATE template SET
      raw_html=NULL,
      last_name_placeholder=NULL,
      interest_line_placeholder=NULL,
      instructions=?,
      sample_subject=?
      WHERE mode='basic_instant'`).run(BASIC_INSTRUCTIONS, BASIC_SUBJECT);
  } else {
    db.prepare(`UPDATE template SET
      raw_html=NULL,
      last_name_placeholder=NULL,
      interest_line_placeholder=NULL,
      instructions=?,
      sample_subject=?
      WHERE mode='instant'`).run(DEFAULT_INSTRUCTIONS, DEFAULT_SUBJECT);
  }
}

function clearScheduledSessionForMode(db, batchMode) {
  const batchIds = db.prepare('SELECT id FROM scheduled_batches WHERE batch_mode=?').all(batchMode).map(b => b.id);
  if (!batchIds.length) return;
  const ph = batchIds.map(() => '?').join(',');
  db.prepare(`DELETE FROM scheduled_drafts WHERE batch_id IN (${ph})`).run(...batchIds);
  db.prepare(`DELETE FROM scheduled_professors WHERE batch_id IN (${ph})`).run(...batchIds);
  db.prepare(`DELETE FROM scheduled_batches WHERE id IN (${ph})`).run(...batchIds);
}

function resetScheduledTemplate(db, mode) {
  if (mode === 'basic_scheduled') {
    db.prepare(`UPDATE scheduled_template SET
      raw_html=NULL,
      last_name_placeholder=NULL,
      interest_line_placeholder=NULL,
      instructions=?,
      sample_subject=?
      WHERE mode='basic_scheduled'`).run(BASIC_INSTRUCTIONS, BASIC_SUBJECT);
  } else {
    db.prepare(`UPDATE scheduled_template SET
      raw_html=NULL,
      last_name_placeholder=NULL,
      interest_line_placeholder=NULL,
      instructions=?,
      sample_subject=?
      WHERE mode='scheduled'`).run(DEFAULT_INSTRUCTIONS, DEFAULT_SUBJECT);
  }
}

/** Full reset — clears active work for all modes; analytics + archive preserved. */
export function resetSessionData(db) {
  const wipe = db.transaction(() => {
    db.prepare('DELETE FROM queue').run();
    db.prepare('DELETE FROM professors').run();
    resetInstantTemplate(db, 'instant');
    resetInstantTemplate(db, 'basic_instant');
    try {
      db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('queue','professors','scheduled_batches','scheduled_drafts','scheduled_professors')").run();
    } catch { /* ignore */ }
  });
  wipe();

  loadTemplateFromFile('instant');
  seedBasicInstantTemplate();
  loadTemplateFromFile('scheduled');
  seedBasicScheduledTemplate();
  clearRosterExcel();
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
  try { db.pragma('optimize'); } catch { /* ignore */ }
}

export function resetByMode(db, mode) {
  const wipe = db.transaction(() => {
    if (mode === 'instant') {
      db.prepare('DELETE FROM queue WHERE mode=? OR mode IS NULL').run('instant');
      db.prepare('DELETE FROM professors WHERE mode=? OR mode IS NULL').run('instant');
      resetInstantTemplate(db, 'instant');
    } else if (mode === 'basic_instant') {
      db.prepare('DELETE FROM queue WHERE mode=?').run('basic_instant');
      db.prepare('DELETE FROM professors WHERE mode=?').run('basic_instant');
      resetInstantTemplate(db, 'basic_instant');
    } else if (mode === 'scheduled') {
      resetScheduledTemplate(db, 'scheduled');
    } else if (mode === 'basic_scheduled') {
      resetScheduledTemplate(db, 'basic_scheduled');
    }
  });
  wipe();

  if (mode === 'basic_instant') {
    seedBasicInstantTemplate();
  } else if (mode === 'instant') {
    loadTemplateFromFile('instant');
  } else if (mode === 'scheduled' || mode === 'basic_scheduled') {
    if (mode === 'basic_scheduled') seedBasicScheduledTemplate();
    else loadTemplateFromFile('scheduled');
  }

  if (mode === 'instant' || mode === 'basic_instant') clearRosterExcel();
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
}

export function verifySessionCleared(db) {
  return {
    queue: countRows(db, 'queue'),
    professors: countRows(db, 'professors'),
    sent_email_history: countRows(db, 'sent_email_history'),
    sent_log: countRows(db, 'sent_log'),
    replies: countRows(db, 'replies'),
    learning_stats: countRows(db, 'learning_stats'),
  };
}

export function isSessionCleared(db) {
  const c = verifySessionCleared(db);
  return c.queue === 0 && c.professors === 0
    ;
}

export function performFullReset(db) {
  const epoch = bumpSessionEpoch(db);
  resetSessionData(db);

  const counts = verifySessionCleared(db);
  if (!isSessionCleared(db)) {
    throw new Error(`Reset incomplete: ${JSON.stringify(counts)}`);
  }

  return { epoch, counts, cleared: true, preserved: ANALYTICS_TABLES };
}

export function getEmptyStats(db) {
  const sentHistory = countRows(db, 'sent_email_history');
  const uniqueSentEmails = db.prepare('SELECT COUNT(DISTINCT professor_email) as c FROM sent_email_history').get().c;
  return {
    total: 0,
    sent: 0,
    pending: 0,
    awaitingProceed: 0,
    failed: 0,
    researching: 0,
    drafted: 0,
    verified: 0,
    skipped: 0,
    replied: 0,
    todaySent: 0,
    totalSent: sentHistory,
    uniqueSentEmails,
    scraping: 0,
    scrapePhase: null,
    sessionEpoch: getSessionEpoch(db),
  };
}
