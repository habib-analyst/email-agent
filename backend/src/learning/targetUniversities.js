/**
 * Curated CS / AI / ML target universities for graduate outreach.
 */
import { getUsaTargetUniversities } from './usaCatalog.js';
import { getChinaTargetUniversities } from './chinaTargetUniversities.js';
import { loadUserMajorsFromFile } from './userMajorsFile.js';

export const TARGET_UNIVERSITIES = {
  usa: getUsaTargetUniversities(),
  china: getChinaTargetUniversities(),
};

/** Expand majors from User_Majors_for_Email_Subject.txt into match keywords. */
export function expandMajorKeywords(majors) {
  const kw = new Set();
  const lines = majors?.length ? majors : loadUserMajorsFromFile();

  for (const m of lines) {
    const low = m.toLowerCase().trim();
    if (!low) continue;
    kw.add(low);
    for (const p of low.split(/[/,\s]+/)) {
      if (p.length > 2) kw.add(p);
    }
    // Phrase chunks for long majors
    if (low.includes(' ')) {
      const words = low.split(/\s+/).filter(w => w.length > 3);
      words.forEach(w => kw.add(w));
    }
  }

  return kw;
}

export function scoreTargetFit(strengths, majorKeywords) {
  const text = strengths.join(' ').toLowerCase();
  let score = 0;
  for (const k of majorKeywords) {
    if (k.length < 3) continue;
    if (text.includes(k)) score += 2;
    else if (text.split(/\s+/).some(w => w.includes(k) || k.includes(w))) score += 1;
  }
  return score;
}

export function rosterMatchesTarget(rosterNames, target) {
  const hints = [target.name.toLowerCase(), ...target.hints.map(h => h.toLowerCase())];
  for (const raw of rosterNames) {
    const r = (raw || '').toLowerCase().trim();
    if (!r) continue;
    for (const h of hints) {
      if (r.includes(h) || h.includes(r)) return true;
    }
  }
  return false;
}

const REGION_LIMITS = { usa: 150, china: 60 };

export function buildSuggestions(region, rosterUniversityNames, majors, options = {}) {
  const pool = region === 'usa' ? getUsaTargetUniversities()
    : region === 'china' ? getChinaTargetUniversities()
      : TARGET_UNIVERSITIES[region] || [];

  const majorKeywords = expandMajorKeywords(majors);
  const limit = options.limit ?? REGION_LIMITS[region] ?? 50;
  const minScore = options.minScore ?? 2;

  const candidates = pool
    .filter(t => !rosterMatchesTarget(rosterUniversityNames, t))
    .map(t => ({
      university: t.name,
      region,
      state: t.state,
      rank: t.rank,
      popularity: t.popularity,
      relevance: scoreTargetFit(t.strengths, majorKeywords),
      strengths: t.strengths.filter(s => {
        const sl = s.toLowerCase();
        return [...majorKeywords].some(k => sl.includes(k) || k.includes(sl));
      }).slice(0, 4),
      status: 'suggested',
    }))
    .filter(c => c.relevance >= minScore)
    .sort((a, b) => b.relevance - a.relevance || (a.rank || 999999) - (b.rank || 999999) || a.university.localeCompare(b.university));

  return {
    items: candidates.slice(0, limit),
    totalMatching: candidates.length,
  };
}

/** Reload pools after catalog rebuild (dev). */
export function refreshTargetUniversityPools() {
  // usaCatalog caches internally — for hot reload clear via dynamic import in dev only
}
