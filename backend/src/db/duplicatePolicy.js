import { findPriorOutreach } from './duplicateCheck.js';

export const DUPLICATE_POLICIES = {
  skip_always: 'skip_always',
  review_always: 'review_always',
  skip_within_days: 'skip_within_days',
  allow_after_days: 'allow_after_days',
};

function daysSince(isoDate) {
  if (!isoDate) return Infinity;
  const t = new Date(isoDate).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 86400000;
}

/** Resolve whether an email should be blocked as duplicate and how. */
export function evaluateDuplicate(email, settings = {}) {
  const prior = findPriorOutreach(email);
  if (!prior) return { blocked: false, prior: null, action: null };

  const policy = settings.duplicate_policy || 'review_always';
  const cooldownDays = Number(settings.duplicate_cooldown_days) || 30;
  const age = daysSince(prior.sent_at || prior.created_at);

  switch (policy) {
    case 'skip_always':
      return { blocked: true, prior, action: 'skip' };
    case 'skip_within_days':
      return age <= cooldownDays
        ? { blocked: true, prior, action: 'skip' }
        : { blocked: false, prior: null, action: null };
    case 'allow_after_days':
      return age > cooldownDays
        ? { blocked: false, prior: null, action: null }
        : { blocked: true, prior, action: 'review' };
    case 'review_always':
    default:
      return { blocked: true, prior, action: 'review' };
  }
}

export function isDuplicateBlocked(email, settings) {
  return evaluateDuplicate(email, settings).blocked;
}
