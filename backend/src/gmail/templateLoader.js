import { loadTemplateFromFile, seedBasicInstantTemplate } from './templateSeeder.js';
import { repairBasicInstantTemplate } from '../db/templateStore.js';
import db from '../db/index.js';

/**
 * Load the email template from Email_Template.txt for the requested mode.
 * Basic instant always uses the canonical template (no keyword / interest line).
 */
export async function loadLatestSentAsTemplate(mode = 'instant') {
  let primaryResult;
  if (mode === 'basic_instant') {
    seedBasicInstantTemplate();
    repairBasicInstantTemplate();
    primaryResult = { success: true, source: 'basic_instant_canonical', placeholders: { lastName: '{{LAST_NAME}}', interestLine: null } };
  } else {
    primaryResult = loadTemplateFromFile(mode);
  }

  const otherMode = mode === 'instant' ? 'scheduled' : mode === 'scheduled' ? 'instant' : null;
  if (otherMode) {
    const otherRow = db.prepare('SELECT raw_html FROM template WHERE mode=?').get(otherMode);
    if (!otherRow?.raw_html) loadTemplateFromFile(otherMode);
  }

  if (mode !== 'basic_instant') {
    const basicRow = db.prepare("SELECT raw_html FROM template WHERE mode='basic_instant'").get();
    if (!basicRow?.raw_html) seedBasicInstantTemplate();
  }

  return primaryResult;
}
