import db from './index.js';
import { getModeProfile, isBasicInstant } from '../config/modes.js';
import {
  applyBasicTemplateRules,
  basicTemplateNeedsRepair,
  getBasicSubjectMode,
  getBasicInstructionsForMode,
  getBasicSubjectForMode,
  getCanonicalBasicTemplate,
} from '../gmail/basicTemplate.js';
import { loadTemplateFromFile } from '../gmail/templateSeeder.js';
import { roleForEmail } from '../services/tenantRegistry.js';

function isAdminWorkspace(dbConn = db) {
  const email = dbConn.prepare('SELECT sender_email FROM settings WHERE id=1').get()?.sender_email;
  return roleForEmail(email) === 'admin';
}

function readBasicSubjectMode(dbConn = db) {
  const settings = dbConn.prepare('SELECT basic_subject_keyword, basic_search_subject_keyword FROM settings WHERE id=1').get() || {};
  return getBasicSubjectMode(settings);
}

/** Save template row with mode-specific rules applied. */
export function saveTemplateForMode(mode, fields) {
  const profile = getModeProfile(mode);
  let payload = { ...fields };

  if (isBasicInstant(mode)) {
    payload = applyBasicTemplateRules({
      raw_html: fields.raw_html,
      sample_subject: fields.sample_subject,
      instructions: fields.instructions,
    }, readBasicSubjectMode());
  }

  const existing = db.prepare('SELECT id FROM template WHERE mode=?').get(mode);
  if (existing) {
    db.prepare(`
      UPDATE template SET
        raw_html=COALESCE(?, raw_html),
        last_name_placeholder=COALESCE(?, last_name_placeholder),
        interest_line_placeholder=?,
        instructions=COALESCE(?, instructions),
        sample_subject=COALESCE(?, sample_subject)
      WHERE mode=?
    `).run(
      payload.raw_html ?? null,
      payload.last_name_placeholder ?? '{{LAST_NAME}}',
      payload.interest_line_placeholder ?? (isBasicInstant(mode) ? null : '{{INTEREST_LINE}}'),
      payload.instructions ?? null,
      payload.sample_subject ?? null,
      mode,
    );
  } else {
    db.prepare(`
      INSERT INTO template (raw_html, last_name_placeholder, interest_line_placeholder, instructions, sample_subject, mode)
      VALUES (?,?,?,?,?,?)
    `).run(
      payload.raw_html || '',
      payload.last_name_placeholder || '{{LAST_NAME}}',
      isBasicInstant(mode) ? null : (payload.interest_line_placeholder || '{{INTEREST_LINE}}'),
      payload.instructions || '',
      payload.sample_subject || profile.subjectPattern,
      mode,
    );
  }

  return db.prepare('SELECT * FROM template WHERE mode=?').get(mode);
}

/** Fix basic_instant template if it still has keyword subject or interest line. */
export function repairBasicInstantTemplate(dbConn = db) {
  const subjectMode = readBasicSubjectMode(dbConn);
  const tpl = dbConn.prepare("SELECT * FROM template WHERE mode='basic_instant'").get();
  if (!tpl) {
    if (!isAdminWorkspace(dbConn)) return { repaired: false, reason: 'user_template_required' };
    const canonical = getCanonicalBasicTemplate(subjectMode);
    dbConn.prepare(`
      INSERT INTO template (raw_html, last_name_placeholder, interest_line_placeholder, instructions, sample_subject, mode)
      VALUES (?,?,?,?,?, 'basic_instant')
    `).run(canonical.raw_html, canonical.last_name_placeholder, null, canonical.instructions, canonical.sample_subject);
    return { repaired: true, reason: 'seeded' };
  }

  if (!basicTemplateNeedsRepair(tpl, subjectMode)) {
    syncBasicSubjectOptions(dbConn);
    return { repaired: false };
  }

  const canonical = getCanonicalBasicTemplate(subjectMode);
  dbConn.prepare(`
    UPDATE template SET
      raw_html=?,
      last_name_placeholder=?,
      interest_line_placeholder=NULL,
      instructions=?,
      sample_subject=?
    WHERE mode='basic_instant'
  `).run(canonical.raw_html, canonical.last_name_placeholder, canonical.instructions, canonical.sample_subject);

  return { repaired: true, reason: `synced_${subjectMode}_subject` };
}

/** Return mode template — seed/repair so each mode always has correct sample + instructions. */
export function ensureTemplateForMode(mode = 'instant') {
  if (isBasicInstant(mode)) {
    repairBasicInstantTemplate();
  } else if (mode === 'instant') {
    const row = db.prepare("SELECT raw_html FROM template WHERE mode='instant'").get();
    if (!row?.raw_html && isAdminWorkspace()) loadTemplateFromFile('instant');
  }
  return db.prepare('SELECT * FROM template WHERE mode=?').get(mode);
}

/** Keep basic mode template sample subjects aligned with subject options. */
export function syncBasicSubjectOptions(dbConn = db, overrides = null) {
  const settings = dbConn.prepare('SELECT basic_subject_keyword, basic_search_subject_keyword FROM settings WHERE id=1').get() || {};
  if (overrides) {
    if (overrides.defaultSubject !== undefined) settings.basic_subject_keyword = overrides.defaultSubject ? 1 : 0;
    if (overrides.searchSubjectKeyword !== undefined) settings.basic_search_subject_keyword = overrides.searchSubjectKeyword ? 1 : 0;
  }
  const subjectMode = getBasicSubjectMode(settings);
  const instructions = getBasicInstructionsForMode(subjectMode);
  const basicSample = getBasicSubjectForMode(subjectMode);
  dbConn.prepare("UPDATE template SET instructions=?, sample_subject=? WHERE mode='basic_instant'").run(instructions, basicSample);
  dbConn.prepare("UPDATE scheduled_template SET instructions=?, sample_subject=? WHERE mode='basic_scheduled'").run(instructions, basicSample);
  return {
    basic_subject_keyword: settings.basic_subject_keyword ? 1 : 0,
    basic_search_subject_keyword: settings.basic_search_subject_keyword ? 1 : 0,
    subjectMode,
    instructions,
    sample_subject: basicSample,
  };
}

/** @deprecated */
export function syncBasicKeywordInstructions(dbConn = db, enabled = null) {
  const overrides = enabled === null ? null : { defaultSubject: !!enabled, searchSubjectKeyword: false };
  return syncBasicSubjectOptions(dbConn, overrides);
}
