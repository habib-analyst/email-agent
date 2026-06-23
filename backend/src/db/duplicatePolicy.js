import { findPriorOutreach } from './duplicateCheck.js';

export const DUPLICATE_POLICIES = {
  skip_always: 'skip_always',
  review_always: 'review_always',
  skip_within_days: 'skip_within_days',
  allow_after_days: 'allow_after_days',
};

/** Resolve whether an email should be blocked as duplicate and how. */
export function evaluateDuplicate(email, settings = {}) {
  const prior = findPriorOutreach(email);
  if (!prior) return { blocked: false, prior: null, action: null };
  return { blocked: true, prior, action: 'skip' };
}

export function isDuplicateBlocked(email, settings) {
  return evaluateDuplicate(email, settings).blocked;
}
