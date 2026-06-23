import db from '../db/index.js';
import { getChinaProvince } from './chinaTargetUniversities.js';
import { matchRankedUniversity, normalizeUniversityName } from './globalUniversityCatalog.js';
import { resolveUsaUniversityDetailsFromEmail } from './usaUniversityResolver.js';

const COUNTRY_NAMES = {
  usa: 'United States', canada: 'Canada', uk: 'United Kingdom', germany: 'Germany',
  france: 'France', netherlands: 'Netherlands', switzerland: 'Switzerland', sweden: 'Sweden',
  italy: 'Italy', spain: 'Spain', austria: 'Austria', ireland: 'Ireland', finland: 'Finland',
  china: 'China', japan: 'Japan', 'south-korea': 'South Korea', singapore: 'Singapore',
  malaysia: 'Malaysia', 'hong-kong': 'Hong Kong', taiwan: 'Taiwan', australia: 'Australia',
  'new-zealand': 'New Zealand',
};

const KNOWN_SUBDIVISIONS = new Map([
  ['eth zurich', 'Canton of Zürich'],
  ['eth zurich swiss federal institute of technology', 'Canton of Zürich'],
  ['école polytechnique fédérale de lausanne', 'Canton of Vaud'],
  ['epfl', 'Canton of Vaud'],
]);

function keyFor(name) {
  return normalizeUniversityName(name);
}

export function getCachedUniversityLocation(name) {
  const key = keyFor(name);
  if (!key) return null;
  return db.prepare('SELECT * FROM university_locations WHERE normalized_name=?').get(key) || null;
}

function saveLocation(location) {
  if (!location?.university_name || !location?.country_id) return null;
  const normalized = keyFor(location.university_name);
  db.prepare(`
    INSERT INTO university_locations
      (normalized_name, university_name, country_id, country_name, subdivision, source, confidence, source_url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(normalized_name) DO UPDATE SET
      university_name=excluded.university_name,
      country_id=excluded.country_id,
      country_name=excluded.country_name,
      subdivision=COALESCE(excluded.subdivision, university_locations.subdivision),
      source=excluded.source,
      confidence=excluded.confidence,
      source_url=COALESCE(excluded.source_url, university_locations.source_url),
      updated_at=CURRENT_TIMESTAMP
  `).run(
    normalized,
    location.university_name,
    location.country_id,
    location.country_name || COUNTRY_NAMES[location.country_id] || location.country_id,
    location.subdivision || null,
    location.source || 'catalog',
    Number(location.confidence ?? 1),
    location.source_url || null,
  );
  return getCachedUniversityLocation(location.university_name);
}

export function resolveKnownUniversityLocation(name, email = '') {
  const trimmed = String(name || '').trim();
  const cached = getCachedUniversityLocation(trimmed);
  if (cached) return cached;

  const usa = resolveUsaUniversityDetailsFromEmail(email);
  if (usa) {
    return saveLocation({
      university_name: usa.name,
      country_id: 'usa',
      country_name: COUNTRY_NAMES.usa,
      subdivision: usa.state,
      source: 'email_domain',
      confidence: 1,
    });
  }

  const ranked = matchRankedUniversity(trimmed);
  if (!ranked) return null;
  const normalized = keyFor(trimmed);
  const subdivision = ranked.countryId === 'china'
    ? getChinaProvince(ranked.name)
    : KNOWN_SUBDIVISIONS.get(normalized) || KNOWN_SUBDIVISIONS.get(keyFor(ranked.name)) || null;
  return saveLocation({
    university_name: ranked.name,
    country_id: ranked.countryId,
    country_name: COUNTRY_NAMES[ranked.countryId],
    subdivision,
    source: 'qs_2026',
    confidence: 1,
    source_url: 'https://www.topuniversities.com/qs-world-university-rankings',
  });
}

async function resolveOnline(name) {
  const [{ performWebSearch }, { callAI }] = await Promise.all([
    import('../ai/webSearch.js'),
    import('../ai/index.js'),
  ]);
  const evidence = await performWebSearch(`"${name}" university official location country state province`);
  if (!evidence || evidence.startsWith('Search failed') || evidence.startsWith('No results')) return null;
  const allowed = Object.keys(COUNTRY_NAMES);
  const result = await callAI(`Identify the location of this university using only the search evidence.
University: ${name}
Evidence:
${evidence}

Return JSON only:
{"canonical_name":"official university name","country_id":"one of ${allowed.join(', ')}","subdivision":"state/province/canton/region or null","confidence":0.0,"source_url":"best official URL or null"}
Rules: confidence must be at least 0.85 only when evidence clearly identifies the same institution. Do not guess.`, 'light');
  if (!result || !allowed.includes(result.country_id) || Number(result.confidence) < 0.85) return null;
  return saveLocation({
    university_name: result.canonical_name || name,
    country_id: result.country_id,
    country_name: COUNTRY_NAMES[result.country_id],
    subdivision: result.subdivision || null,
    source: 'web_search',
    confidence: Number(result.confidence),
    source_url: result.source_url || null,
  });
}

export async function resolveUniversityLocation(name, email = '', { allowOnline = false } = {}) {
  const known = resolveKnownUniversityLocation(name, email);
  if (known || !allowOnline || !String(name || '').trim()) return known;
  try {
    return await resolveOnline(String(name).trim());
  } catch (error) {
    console.warn(`[UniversityLocation] ${name}: ${error.message}`);
    return null;
  }
}

export async function resolveRosterUniversityLocations(entries) {
  const unique = new Map();
  for (const entry of entries || []) {
    if (entry.university_source !== 'roster' || !entry.university) continue;
    const key = keyFor(entry.university);
    if (key && !unique.has(key)) unique.set(key, entry);
  }
  const queue = [...unique.values()];
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      const entry = queue.shift();
      const location = await resolveUniversityLocation(entry.university, entry.email, { allowOnline: true });
      if (location) {
        entry.university = location.university_name;
        entry.university_country = location.country_id;
        entry.university_state = location.subdivision || null;
      }
    }
  });
  await Promise.all(workers);
  return entries;
}
