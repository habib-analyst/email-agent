import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const path = resolve(import.meta.dirname, '../../data/global_universities_qs_2026.json');
let cache;
let indexes;

export function normalizeUniversityName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(the|university|college|institute|technology|of)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getGlobalUniversityCatalog() {
  if (!cache) {
    cache = JSON.parse(readFileSync(path, 'utf8'));
    const byCountry = new Map();
    const exact = new Map();
    for (const [countryId, rows] of Object.entries(cache.countries)) {
      const indexed = rows.map(item => ({ item, normalized: normalizeUniversityName(item.name) }));
      byCountry.set(countryId, indexed);
      for (const row of indexed) {
        if (!exact.has(row.normalized)) exact.set(row.normalized, []);
        exact.get(row.normalized).push(row.item);
      }
    }
    indexes = { byCountry, exact };
  }
  return cache;
}

export function getRankedUniversities(countryId) {
  return getGlobalUniversityCatalog().countries[countryId] || [];
}

export function matchRankedUniversity(name, countryId) {
  const normalized = normalizeUniversityName(name);
  if (!normalized) return null;
  getGlobalUniversityCatalog();
  const exactMatches = indexes.exact.get(normalized) || [];
  const exact = countryId
    ? exactMatches.find(item => item.countryId === countryId)
    : exactMatches.length === 1 ? exactMatches[0] : null;
  if (exact) return exact;
  const pool = countryId
    ? indexes.byCountry.get(countryId) || []
    : [...indexes.byCountry.values()].flat();
  const matches = pool.filter(({ normalized: candidate }) => {
    return candidate.length > 5 && normalized.length > 5
      && (candidate.includes(normalized) || normalized.includes(candidate));
  });
  return matches.length === 1 ? matches[0].item : null;
}
