import db from '../db/index.js';
import { hasBasicLastName } from '../research/basicLastNameResearch.js';
import { isBasicScheduled } from '../config/modes.js';
import { BASIC_SUBJECT_WITH_DEFAULT } from '../gmail/basicTemplate.js';

/** Validate one scheduled draft matches mode rules before save or send. */
export function verifyScheduledDraft({ subject, interest_line, html_preview, last_name }, batchMode, subjectMode = 'fixed') {
  const errors = [];
  const isBasic = isBasicScheduled(batchMode);

  if (!hasBasicLastName({ last_name })) {
    errors.push('Last name is mandatory — agent must verify professor surname before draft/send');
  }

  if (!subject?.trim()) {
    errors.push('Subject is empty');
  } else if (isBasic) {
    if (subjectMode === 'default' && subject.trim() !== BASIC_SUBJECT_WITH_DEFAULT) {
      errors.push('Default subject mode requires [Machine Learning] prefix on every draft');
    }
    if (subjectMode === 'search' && !/^\[[^\]]+\]/.test(subject)) {
      errors.push('Search subject keyword mode requires [Keyword] prefix');
    }
    if (subjectMode === 'fixed' && /^\[[^\]]+\]/.test(subject)) {
      errors.push('Basic mode with subject options off must use fixed subject (no [Keyword])');
    }
  } else if (!/^\[[^\]]+\]/.test(subject)) {
    errors.push('Normal scheduled mode requires [Keyword] in subject');
  }

  if (isBasic) {
    if (interest_line?.trim()) {
      errors.push('Basic scheduled mode must not include interest line');
    }
  } else if (!interest_line?.trim() || interest_line.trim().length < 15) {
    errors.push('Interest line missing or too short (normal mode)');
  }

  const html = html_preview || '';
  if (html.includes('{{LAST_NAME}}')) {
    errors.push('Template still contains {{LAST_NAME}} placeholder');
  }
  if (isBasic) {
    if (html.includes('{{INTEREST_LINE}}') || /interested in your work/i.test(html)) {
      errors.push('Basic template must not contain interest line content');
    }
  } else if (html.includes('{{INTEREST_LINE}}')) {
    errors.push('Template still contains {{INTEREST_LINE}} placeholder');
  }

  return { ok: errors.length === 0, errors };
}

/** Pre-send gate: every approved draft + batch schedule metadata. */
export function verifyScheduledBatchBeforeSend(batchId) {
  const batch = db.prepare('SELECT * FROM scheduled_batches WHERE id=?').get(batchId);
  if (!batch) return { ok: false, errors: ['Batch not found'] };

  const batchMode = batch.batch_mode || 'scheduled';
  const isBasic = isBasicScheduled(batchMode);
  const settings = db.prepare('SELECT basic_subject_keyword, basic_search_subject_keyword FROM settings WHERE id=1').get() || {};
  const subjectMode = isBasic
    ? (settings.basic_search_subject_keyword ? 'search' : settings.basic_subject_keyword ? 'default' : 'fixed')
    : 'search';

  const tpl = db.prepare('SELECT raw_html FROM scheduled_template WHERE mode=?').get(isBasic ? 'basic_scheduled' : 'scheduled');
  if (!tpl?.raw_html) {
    return { ok: false, errors: [`No ${isBasic ? 'basic ' : ''}scheduled template configured`] };
  }

  const approved = db.prepare(`
    SELECT d.id, d.subject, d.interest_line, d.html_preview, d.custom_html, d.status,
           sp.email as professor_email, sp.last_name
    FROM scheduled_drafts d
    JOIN scheduled_professors sp ON d.professor_id = sp.id
    WHERE d.batch_id = ? AND d.status = 'approved'
    ORDER BY d.id
  `).all(batchId);

  if (!approved.length) {
    return { ok: false, errors: ['No approved drafts to send'] };
  }

  const draftFailures = [];
  for (const d of approved) {
    const html = d.custom_html || d.html_preview || '';
    const check = verifyScheduledDraft({
      subject: d.subject,
      interest_line: d.interest_line,
      html_preview: html,
      last_name: d.last_name,
    }, batchMode, subjectMode);
    if (!check.ok) {
      draftFailures.push({ draftId: d.id, email: d.professor_email, errors: check.errors });
    }
  }

  const batchErrors = [];
  if (draftFailures.length) {
    batchErrors.push(`${draftFailures.length} draft(s) failed verification`);
  }

  let targetCountries = [];
  try {
    targetCountries = batch.target_countries ? JSON.parse(batch.target_countries) : [];
  } catch { /* ignore */ }

  return {
    ok: draftFailures.length === 0,
    batchMode,
    scheduledAt: batch.scheduled_at,
    targetCountries,
    approvedCount: approved.length,
    draftFailures,
    errors: batchErrors,
  };
}

export function minutesUntilScheduled(scheduledAtIso) {
  if (!scheduledAtIso) return null;
  const t = new Date(scheduledAtIso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.round((t - Date.now()) / 60000);
}
