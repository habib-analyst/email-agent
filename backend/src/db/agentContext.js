import db from './index.js';
import { getModeProfile, isInstantFamily } from '../config/modes.js';
import { getSessionEpoch } from '../session/epoch.js';
import { getWorkflowForMode } from '../config/agentWorkflow.js';
import {
  basicTemplateNeedsRepair,
  getBasicSubjectForMode,
  getBasicSubjectMode,
  getCanonicalBasicTemplate,
} from '../gmail/basicTemplate.js';

/**
 * Everything the agent needs for a mode — templates, rules, counts, tables.
 * Returned in /bootstrap so frontend + worker stay aligned.
 */
export function getAgentContext(mode = 'instant') {
  const profile = getModeProfile(mode);

  let template = null;
  if (profile.templateTable === 'scheduled_template') {
    const tplMode = mode === 'basic_scheduled' ? 'basic_scheduled' : 'scheduled';
    template = db.prepare('SELECT * FROM scheduled_template WHERE mode=?').get(tplMode);
  } else {
    template = db.prepare('SELECT * FROM template WHERE mode=?').get(mode);
  }

  const stats = isInstantFamily(mode)
    ? db.prepare(`
        SELECT
          COUNT(*) as queueTotal,
          SUM(CASE WHEN state='pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN state='sent' THEN 1 ELSE 0 END) as sent
        FROM queue WHERE mode=?
      `).get(mode)
    : null;

  const professorCount = isInstantFamily(mode)
    ? db.prepare('SELECT COUNT(*) as c FROM professors WHERE mode=?').get(mode).c
    : 0;

  const settings = db.prepare('SELECT basic_subject_keyword, basic_search_subject_keyword FROM settings WHERE id=1').get() || {};
  const isBasicFamily = mode === 'basic_instant' || mode === 'basic_scheduled';
  const subjectMode = isBasicFamily ? getBasicSubjectMode(settings) : 'search';

  const templateRepair = mode === 'basic_instant'
    ? { needed: basicTemplateNeedsRepair(template, subjectMode), ...getCanonicalBasicTemplate(subjectMode) }
    : null;

  const isScheduledFamily = mode === 'scheduled' || mode === 'basic_scheduled';
  const basicDraftRules = subjectMode === 'search'
    ? 'Replace {{LAST_NAME}} and subject [Keyword] from professor research. No interest line.'
    : subjectMode === 'default'
      ? 'Only replace {{LAST_NAME}}. Subject stays [Machine Learning] for every professor — no interest line.'
      : 'Only replace {{LAST_NAME}}. Fixed subject — no interest line or research keywords.';

  const workflow = getWorkflowForMode(mode);

  return {
    mode: profile.id,
    label: profile.label,
    personalize: {
      ...profile.personalize,
      ...(isBasicFamily ? {
        subjectKeyword: subjectMode === 'search',
        defaultSubject: subjectMode === 'default',
      } : {}),
    },
    subjectPattern: isBasicFamily ? getBasicSubjectForMode(subjectMode) : profile.subjectPattern,
    subjectMode: isBasicFamily ? subjectMode : null,
    requiredPlaceholders: profile.requiredPlaceholders,
    workflow,
    tables: isInstantFamily(mode)
      ? ['professors', 'queue', 'sent_log', 'template', 'replies']
      : ['scheduled_batches', 'scheduled_professors', 'scheduled_drafts', 'scheduled_sent_log', 'scheduled_template'],
    counts: {
      professors: professorCount,
      queue: stats?.queueTotal || 0,
      pending: stats?.pending || 0,
      sent: stats?.sent || 0,
    },
    sessionEpoch: getSessionEpoch(db),
    templateRepair,
    draftRules: mode === 'basic_scheduled'
      ? `LAST NAME MANDATORY. ${basicDraftRules} Batch sends at scheduled_at UTC — pre-send verification runs on all approved drafts before Gmail send.`
      : isBasicFamily
        ? basicDraftRules
        : mode === 'scheduled'
          ? 'Web-research professor → replace {{LAST_NAME}}, subject [Keyword], and {{INTEREST_LINE}} from verified research only. Batch sends at scheduled_at UTC after pre-send verification.'
          : 'Web-research professor first. Replace {{LAST_NAME}}, subject [Keyword], and {{INTEREST_LINE}} using ONLY verified research_areas and papers — no generic keywords.',
    lastNameRequired: isScheduledFamily || mode === 'instant' || mode === 'basic_instant',
    scheduleAwareness: isScheduledFamily
      ? 'Agent waits until batch scheduled_at (UTC). Pre-send verify runs on all approved drafts before Gmail send.'
      : null,
  };
}
