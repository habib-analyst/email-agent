/**
 * Profile URL discovery, ranking, and multi-link deep scrape orchestration.
 * Handles cards with 1 profile link or several (Profile, CV, Scholar, personal site).
 */

const SKIP_URL = /linkedin|twitter|facebook|instagram|youtube|mailto:|\.pdf$|orcid\.org|researchgate\.net|scholar\.google/i;
const SECONDARY_PATH = /\/(cv|curriculum|vitae|publications|papers|blog|news|events|calendar)\//i;
const PRIMARY_PATH = /\/(people|faculty|staff|professor|profile|person|bios|members|team|our-people|directory|employee|researchers)\//i;
const TILDE_PATH = /\/~[\w.-]+\/?$/;

export function scoreProfileUrlCandidate(url, { email, name, nearEmail, linkText } = {}) {
  if (!url) return -100;
  const u = url.toLowerCase();
  const text = (linkText || '').toLowerCase();
  if (SKIP_URL.test(u)) return -50;
  if (SECONDARY_PATH.test(u)) return 1;
  if (PRIMARY_PATH.test(u) || TILDE_PATH.test(u)) return 8;
  if (/\/[a-z]+-[a-z]+(-[a-z]+)?\/?$/.test(u)) return 5;

  let score = 2;
  if (nearEmail) score += 4;
  if (text && /profile|faculty|bio|homepage|personal/i.test(text)) score += 3;
  if (text && /cv|vitae|publication|scholar|lab/i.test(text)) score -= 2;

  const local = (email || '').split('@')[0].toLowerCase();
  const parts = local.split(/[._-]/).filter(p => p.length > 2);
  const hay = `${u} ${text}`;
  if (local && hay.includes(local)) score += 5;
  for (const p of parts) {
    if (hay.includes(p)) score += 2;
  }
  if (name) {
    const nameParts = name.toLowerCase().split(/\s+/).filter(p => p.length > 2);
    if (nameParts.length >= 2 && nameParts.every(p => hay.includes(p))) score += 4;
  }
  return score;
}

export function normalizeProfileUrl(href, baseUrl) {
  if (!href || href.startsWith('#') || href.startsWith('mailto:')) return '';
  try {
    const resolved = new URL(href, baseUrl).href;
    return resolved.split('#')[0].replace(/\/$/, '');
  } catch {
    return '';
  }
}

/** All profile-like links inside a professor card (not just the first). */
export function extractProfileUrlCandidates($, $card, baseUrl) {
  const candidates = [];
  const seen = new Set();

  const add = (href, text, nearEmail = true) => {
    const url = normalizeProfileUrl(href, baseUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push({ url, text: (text || '').trim(), nearEmail });
  };

  $card.find('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (!href || href.startsWith('mailto:') || href.startsWith('#')) return;
    add(href, text, true);
  });

  return candidates
    .map(c => ({ ...c, score: scoreProfileUrlCandidate(c.url, { nearEmail: c.nearEmail, linkText: c.text }) }))
    .filter(c => c.score >= 2)
    .sort((a, b) => b.score - a.score);
}

/** Best single profile URL from a card. */
export function extractBestProfileUrl($, $card, baseUrl, ctx = {}) {
  const ranked = extractProfileUrlCandidates($, $card, baseUrl);
  if (!ranked.length) return { profileUrl: '', profileUrls: [] };
  return {
    profileUrl: ranked[0].url,
    profileUrls: ranked.map(r => r.url),
  };
}

export function rankProfileUrlsForProfessor(rawCandidates, { email, name } = {}) {
  const seen = new Set();
  const ranked = [];

  for (const raw of rawCandidates || []) {
    const url = typeof raw === 'string' ? raw : raw?.url;
    if (!url) continue;
    const key = url.split('#')[0].replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const score = scoreProfileUrlCandidate(url, {
      email,
      name,
      nearEmail: raw?.nearEmail,
      linkText: raw?.text || raw?.name,
    });
    if (score < 2) continue;
    ranked.push({ url: key, score, text: raw?.text || raw?.name || '' });
  }

  return ranked.sort((a, b) => b.score - a.score);
}

export function profileDataRichness(data) {
  if (!data) return 0;
  let s = 0;
  if (data.name) s += 2;
  if (data.department) s += 1;
  if (data.title) s += 1;
  if (Array.isArray(data.research_areas)) s += data.research_areas.length * 2;
  if (Array.isArray(data.papers)) s += Math.min(data.papers.length, 5);
  if (Array.isArray(data.projects)) s += Math.min(data.projects.length, 3);
  return s;
}

export function mergeProfessorProfileData(existing, incoming) {
  if (!incoming) return existing;
  if (!existing) return { ...incoming };

  const mergeAreas = (a, b) => [...new Set([
    ...(Array.isArray(a) ? a : []),
    ...(Array.isArray(b) ? b : []),
  ])];

  return {
    ...existing,
    ...incoming,
    name: incoming.name || existing.name,
    last_name: incoming.last_name || existing.last_name,
    department: incoming.department || existing.department,
    title: incoming.title || existing.title,
    email: incoming.email || existing.email,
    research_areas: mergeAreas(existing.research_areas, incoming.research_areas),
    papers: [...(existing.papers || []), ...(incoming.papers || [])].slice(0, 10),
    projects: [...new Set([...(existing.projects || []), ...(incoming.projects || [])])].slice(0, 10),
    links: [...new Set([...(existing.links || []), ...(incoming.links || [])])],
  };
}

/**
 * Try each ranked profile URL until we have rich data.
 * Returns scrape_steps so the agent knows what was tackled.
 */
export async function deepScrapeProfessorProfiles(prof, { scrapeFn, onStep, maxUrls = 4 } = {}) {
  const linkCandidates = (prof._profileLinkCandidates || []).map(l => ({
    url: l.url,
    text: l.name,
    nearEmail: l.nearEmail,
  }));

  const ranked = rankProfileUrlsForProfessor([
    prof.profile_url && { url: prof.profile_url, nearEmail: true, text: prof.name },
    ...(prof.profile_urls || []).map(u => (typeof u === 'string' ? { url: u } : u)),
    ...linkCandidates,
  ], { email: prof.email, name: prof.name }).slice(0, maxUrls);

  const steps = [];
  let merged = null;
  let bestUrl = prof.profile_url || '';

  for (const cand of ranked) {
    if (steps.some(s => s.url === cand.url)) continue;

    const step = {
      url: cand.url,
      phase: 'deep_scrape',
      status: 'started',
      at: new Date().toISOString(),
    };
    steps.push(step);
    onStep?.({ email: prof.email, name: prof.name, ...step });

    try {
      const data = await scrapeFn(cand.url);
      if (!data || profileDataRichness(data) === 0) {
        step.status = 'empty';
        continue;
      }

      step.status = 'ok';
      step.fields = [];
      if (data.research_areas?.length) step.fields.push('research_areas');
      if (data.papers?.length) step.fields.push('papers');
      if (data.projects?.length) step.fields.push('projects');
      if (data.department) step.fields.push('department');
      if (data.title) step.fields.push('title');

      const prevRichness = profileDataRichness(merged);
      merged = mergeProfessorProfileData(merged, data);
      if (profileDataRichness(data) >= prevRichness) bestUrl = cand.url;

      if (profileDataRichness(merged) >= 6) break;
    } catch (e) {
      step.status = 'failed';
      step.error = e.message;
    }
  }

  return {
    merged,
    steps,
    bestUrl,
    urlsTried: steps.length,
    urlsSucceeded: steps.filter(s => s.status === 'ok').length,
  };
}

export function applyDeepScrapeToProfessor(prof, { merged, steps, bestUrl }) {
  if (!merged && !steps?.length) return prof;

  if (merged?.name && merged.name.length >= 3) {
    prof.name = merged.name;
    prof.last_name = merged.last_name || prof.last_name;
  }
  if (merged?.department) prof.department = merged.department;
  if (merged?.title) prof.title = merged.title;
  if (merged?.research_areas?.length) {
    const existing = Array.isArray(prof.research_areas)
      ? prof.research_areas
      : (prof.research_areas ? String(prof.research_areas).split(',').map(s => s.trim()).filter(Boolean) : []);
    prof.research_areas = [...new Set([...existing, ...merged.research_areas])];
  }
  if (merged?.projects?.length) prof.projects = [...(prof.projects || []), ...merged.projects].slice(0, 10);
  if (merged?.papers?.length) prof.papers = [...(prof.papers || []), ...merged.papers].slice(0, 10);
  if (merged?.email && prof.email && merged.email.toLowerCase() === prof.email.toLowerCase()) {
    prof.name_verified = true;
    prof.name_source = 'profile_verified';
  }

  if (bestUrl) prof.profile_url = bestUrl;
  prof.scrape_steps = steps;
  prof.scrape_trace = {
    phases: ['directory', 'profile_match', 'deep_scrape'],
    profile_urls_tried: steps,
    urls_tried: steps.length,
    urls_ok: steps.filter(s => s.status === 'ok').length,
    tackled_at: new Date().toISOString(),
  };
  if (steps.some(s => s.status === 'ok')) {
    prof.research_source = prof.research_source && prof.research_source !== 'none'
      ? prof.research_source
      : 'profile_deep_scrape';
  }
  return prof;
}
