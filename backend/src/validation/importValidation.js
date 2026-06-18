import { AuthService } from '../services/AuthService.js';
import db from '../db/index.js';
import { evaluateDuplicate } from '../db/duplicatePolicy.js';
import { normalizeEmail } from '../db/duplicateCheck.js';

const EMAIL_OK = /^[\w.-]+@[\w.-]+\.[a-z]{2,}$/i;

export function validateEmailList(emails, { mode = 'instant', maxProfessors } = {}) {
  const settings = db.prepare('SELECT * FROM settings WHERE id=1').get() || {};
  const warnings = [];
  const errors = [];
  const valid = [];
  const duplicates = [];
  const invalid = [];

  const list = (Array.isArray(emails) ? emails : [])
    .map(e => (typeof e === 'string' ? e : e?.email))
    .map(normalizeEmail)
    .filter(Boolean);

  const limited = maxProfessors ? list.slice(0, Number(maxProfessors)) : list;
  if (maxProfessors && list.length > Number(maxProfessors)) {
    warnings.push(`List trimmed to ${maxProfessors} professors (max limit).`);
  }

  const seen = new Set();
  for (const email of limited) {
    if (!EMAIL_OK.test(email)) {
      invalid.push(email);
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);

    const dup = evaluateDuplicate(email, settings);
    if (dup.blocked) {
      duplicates.push({ email, prior: dup.prior, action: dup.action });
      if (dup.action === 'skip') continue;
    }
    valid.push(email);
  }

  if (invalid.length) errors.push(`${invalid.length} invalid email(s).`);
  if (!valid.length && !duplicates.length) errors.push('No valid emails to import.');

  if (!AuthService.isConnected()) {
    warnings.push('Gmail not connected — connect before sending.');
  }

  const tplTable = mode.includes('scheduled') ? 'scheduled_template' : 'template';
  const tplMode = mode === 'basic_scheduled' ? 'basic_scheduled' : mode.includes('scheduled') ? 'scheduled' : mode;
  const tpl = db.prepare(`SELECT raw_html FROM ${tplTable} WHERE mode=?`).get(tplMode);
  if (!tpl?.raw_html) {
    warnings.push('No email template saved — load from Gmail or compose before sending.');
  }

  return {
    ok: errors.length === 0 && (valid.length > 0 || duplicates.some(d => d.action === 'review')),
    valid,
    duplicates,
    invalid,
    warnings,
    errors,
    stats: { total: limited.length, valid: valid.length, duplicates: duplicates.length, invalid: invalid.length },
  };
}

export function validateProfessorEntries(entries, opts = {}) {
  const emails = entries.map(e => e.email);
  const base = validateEmailList(emails, opts);
  const withNames = entries.filter(e => e.last_name && e.last_name.length >= 2).length;
  if (withNames > 0) {
    base.warnings.push(`${withNames} professor(s) include last name — research will be skipped for names.`);
  }
  base.entries = entries.filter(e => base.valid.includes(normalizeEmail(e.email)));
  base.rosterBoost = withNames;
  return base;
}
