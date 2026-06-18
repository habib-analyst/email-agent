/** Central mode definitions — agent + API read from here. */

export const MODES = {
  instant: {
    id: 'instant',
    label: 'Instant',
    templateTable: 'template',
    usesQueue: true,
    personalize: {
      lastName: true,
      subjectKeyword: true,
      interestLine: true,
    },
    subjectPattern: '[Keyword] Seeking an MS/PhD Position in Your Lab',
    requiredPlaceholders: ['{{LAST_NAME}}', '{{INTEREST_LINE}}'],
  },
  basic_instant: {
    id: 'basic_instant',
    label: 'Basic Instant',
    templateTable: 'template',
    usesQueue: true,
    personalize: {
      lastName: true,
      subjectKeyword: false,
      interestLine: false,
    },
    subjectPattern: 'Seeking an MS/PhD Position in Your Lab',
    requiredPlaceholders: ['{{LAST_NAME}}'],
  },
  scheduled: {
    id: 'scheduled',
    label: 'Scheduled',
    templateTable: 'scheduled_template',
    usesQueue: false,
    personalize: {
      lastName: true,
      subjectKeyword: true,
      interestLine: true,
    },
    subjectPattern: '[Keyword] Seeking an MS/PhD Position in Your Lab',
    requiredPlaceholders: ['{{LAST_NAME}}', '{{INTEREST_LINE}}'],
  },
  basic_scheduled: {
    id: 'basic_scheduled',
    label: 'Basic Scheduled',
    templateTable: 'scheduled_template',
    usesQueue: false,
    personalize: {
      lastName: true,
      subjectKeyword: false,
      interestLine: false,
    },
    subjectPattern: 'Seeking an MS/PhD Position in Your Lab',
    requiredPlaceholders: ['{{LAST_NAME}}'],
  },
};

export function getModeProfile(mode = 'instant') {
  return MODES[mode] || MODES.instant;
}

export function isBasicInstant(mode) {
  return mode === 'basic_instant';
}

export function isBasicScheduled(mode) {
  return mode === 'basic_scheduled';
}

export function isBasicMode(mode) {
  return mode === 'basic_instant' || mode === 'basic_scheduled';
}

export function isInstantFamily(mode) {
  return mode === 'instant' || mode === 'basic_instant';
}
