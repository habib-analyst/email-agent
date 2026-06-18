import {
  BASIC_HTML,
  BASIC_INSTRUCTIONS,
  BASIC_INSTRUCTIONS_WITH_DEFAULT,
  BASIC_INSTRUCTIONS_WITH_KEYWORD,
  BASIC_SUBJECT,
} from './templateSeeder.js';

export const DEFAULT_SUBJECT_KEYWORD = 'Machine Learning';
export const BASIC_SUBJECT_WITH_KEYWORD = '[Keyword] Seeking an MS/PhD Position in Your Lab';
export const BASIC_SUBJECT_WITH_DEFAULT = `[${DEFAULT_SUBJECT_KEYWORD}] Seeking an MS/PhD Position in Your Lab`;

/** @returns {'fixed'|'default'|'search'} */
export function getBasicSubjectMode(settingsRow = {}) {
  if (settingsRow?.basic_search_subject_keyword) return 'search';
  if (settingsRow?.basic_subject_keyword) return 'default';
  return 'fixed';
}

export function getBasicInstructionsForMode(mode = 'fixed') {
  if (mode === 'search') return BASIC_INSTRUCTIONS_WITH_KEYWORD;
  if (mode === 'default') return BASIC_INSTRUCTIONS_WITH_DEFAULT;
  return BASIC_INSTRUCTIONS;
}

export function getBasicSubjectForMode(mode = 'fixed') {
  if (mode === 'search') return BASIC_SUBJECT_WITH_KEYWORD;
  if (mode === 'default') return BASIC_SUBJECT_WITH_DEFAULT;
  return BASIC_SUBJECT;
}

/** @deprecated use getBasicInstructionsForMode */
export function getBasicInstructionsForSetting(useKeyword = false) {
  return getBasicInstructionsForMode(useKeyword ? 'search' : 'fixed');
}

/** @deprecated use getBasicSubjectForMode */
export function getBasicSubjectForSetting(useKeyword = false) {
  return getBasicSubjectForMode(useKeyword ? 'search' : 'fixed');
}

export function getInstantSubjectForSetting(useKeyword = false) {
  return getBasicSubjectForMode(useKeyword ? 'search' : 'fixed');
}

/** Build basic-mode send subject from mode + optional researched keyword. */
export function buildBasicOutreachSubject(subjectMode = 'fixed', researchedKeyword = '') {
  const base = BASIC_SUBJECT;
  if (subjectMode === 'default') return BASIC_SUBJECT_WITH_DEFAULT;
  if (subjectMode === 'search') {
    const kw = String(researchedKeyword || '').trim();
    if (kw) return `[${kw}] ${base}`;
    return base;
  }
  return base;
}

/** Build send subject: `[Keyword] Seeking…` when enabled, else fixed base subject. */
export function buildOutreachSubject(keyword, useKeyword = true, baseSubject = BASIC_SUBJECT) {
  const base = stripKeywordFromSubject(baseSubject);
  const kw = String(keyword || '').trim();
  if (useKeyword && kw) return `[${kw}] ${base}`;
  return base;
}

export function useSubjectKeywordSetting(settingsRow) {
  return getBasicSubjectMode(settingsRow) !== 'fixed';
}

export function useBasicSearchSubjectKeyword(settingsRow) {
  return getBasicSubjectMode(settingsRow) === 'search';
}

export function useBasicDefaultSubject(settingsRow) {
  return getBasicSubjectMode(settingsRow) === 'default';
}

/** Remove interest-line content from HTML (basic mode has no personalization there). */
export function stripInterestFromHtml(html) {
  if (!html) return html;
  return html
    .replace(/\{\{INTEREST_LINE\}\}/g, '')
    .replace(/\{\{Professor_Work_3_Keywords\}\}/gi, '')
    .replace(/<p>\s*I am (?:particularly )?interested in your work (?:on|in)[^<]*<\/p>/gi, '')
    .replace(/<p>\s*<\/p>/gi, '')
    .replace(/\n{3,}/g, '\n\n');
}

/** Fixed subject — no [Keyword] prefix. */
export function stripKeywordFromSubject(subject) {
  const raw = (subject || BASIC_SUBJECT).trim();
  const cleaned = raw.replace(/^\[[^\]]+\]\s*/, '').trim();
  return cleaned || BASIC_SUBJECT;
}

/** Apply basic-instant rules to template fields before save or send. */
export function applyBasicTemplateRules({ raw_html, sample_subject, instructions } = {}, subjectMode = 'fixed') {
  return {
    raw_html: stripInterestFromHtml(raw_html || BASIC_HTML),
    sample_subject: getBasicSubjectForMode(subjectMode),
    instructions: instructions || getBasicInstructionsForMode(subjectMode),
    last_name_placeholder: '{{LAST_NAME}}',
    interest_line_placeholder: null,
  };
}

export function basicTemplateNeedsRepair(tpl, subjectMode = 'fixed') {
  if (!tpl) return true;
  const html = tpl.raw_html || '';
  const subject = (tpl.sample_subject || '').trim();
  const hasKeywordPrefix = /^\[[^\]]+\]/.test(subject);
  if (html.includes('{{INTEREST_LINE}}') || /interested in your work/i.test(html)) return true;
  if (subjectMode === 'default') return subject !== BASIC_SUBJECT_WITH_DEFAULT;
  if (subjectMode === 'search') return subject !== BASIC_SUBJECT_WITH_KEYWORD;
  return hasKeywordPrefix;
}

export function getCanonicalBasicTemplate(subjectMode = 'fixed') {
  return applyBasicTemplateRules({
    raw_html: BASIC_HTML,
    sample_subject: getBasicSubjectForMode(subjectMode),
    instructions: getBasicInstructionsForMode(subjectMode),
  }, subjectMode);
}
