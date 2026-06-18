import db from './index.js';
import { getAgentContext } from './agentContext.js';
import { minutesUntilScheduled } from '../pipeline/scheduledVerify.js';

/** Per-batch agent context — time awareness + mode rules for scheduled send flow. */
export function getScheduledBatchAgentContext(batchId) {
  const batch = db.prepare('SELECT * FROM scheduled_batches WHERE id=?').get(batchId);
  if (!batch) return null;

  const mode = batch.batch_mode === 'basic_scheduled' ? 'basic_scheduled' : 'scheduled';
  const base = getAgentContext(mode);
  let targetCountries = [];
  try {
    targetCountries = batch.target_countries ? JSON.parse(batch.target_countries) : [];
  } catch { /* ignore */ }

  const mins = minutesUntilScheduled(batch.scheduled_at);
  const settings = db.prepare('SELECT basic_subject_keyword, basic_search_subject_keyword FROM settings WHERE id=1').get() || {};
  const subjectMode = mode === 'basic_scheduled'
    ? (settings.basic_search_subject_keyword ? 'search' : settings.basic_subject_keyword ? 'default' : 'fixed')
    : 'search';

  return {
    ...base,
    batchId: batch.id,
    batchStatus: batch.status,
    scheduledAt: batch.scheduled_at,
    scheduledAtLocal: batch.scheduled_at ? new Date(batch.scheduled_at).toISOString() : null,
    minutesUntilSend: mins,
    isDue: mins != null && mins <= 0,
    targetCountries,
    lastNameRequired: true,
    interestLineAllowed: mode === 'scheduled',
    subjectMode: mode === 'basic_scheduled' ? subjectMode : null,
    defaultSubjectEnabled: mode === 'basic_scheduled' && subjectMode === 'default',
    searchSubjectKeywordEnabled: mode === 'basic_scheduled' && subjectMode === 'search',
    preSendVerification: [
      'Every draft must have verified last name in greeting',
      mode === 'basic_scheduled'
        ? (subjectMode === 'default'
          ? 'No interest line; fixed [Machine Learning] subject for all'
          : subjectMode === 'search'
            ? 'No interest line; agent researches subject keyword per professor'
            : 'No interest line; fixed subject without prefix')
        : 'Subject [Keyword] + 3 interest keywords from verified research',
      'All approved drafts pass verifyScheduledBatchBeforeSend before Gmail send',
      batch.scheduled_at ? `Batch sends at ${batch.scheduled_at} UTC (or Send Now after verify)` : 'Set scheduled_at before send',
    ],
    scheduleAwareness: mins == null
      ? 'Schedule time not set'
      : mins <= 0
        ? 'Batch is due — pre-send verification runs, then emails send'
        : `Batch sends in ~${mins} minute(s) at ${batch.scheduled_at}`,
  };
}
