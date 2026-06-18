import { capitalizeWord, isValidPersonName } from '../utils/professor.js';
import { extractTitleFromText } from './facultyTitle.js';
import { extractAreaOfInterestFromNode } from './directoryInterests.js';

const PAGE_CHROME_PATTERNS = [
  /^skip\s+to\b/i,
  /^skip\s+navigation\b/i,
  /^main\s+content$/i,
  /^page\s+content$/i,
  /^navigation$/i,
  /^menu$/i,
  /^search$/i,
  /^home$/i,
  /^close$/i,
  /^open\s+menu$/i,
  /^toggle\s+navigation$/i,
  /^back\s+to\s+top$/i,
  /^accessibility$/i,
  /^cookie\b/i,
  /^accept\b/i,
  /^decline\b/i,
];

const CHROME_SELECTORS = [
  'header',
  'nav',
  'footer',
  '.skip-link',
  '.skip-to-content',
  '.screen-reader-text',
  '.sr-only',
  '.visually-hidden',
  'a[href^="#main"]',
  'a[href^="#content"]',
  'a[href^="#skip"]',
  'script',
  'style',
  'noscript',
  '.site-header',
  '.site-footer',
  '.breadcrumb',
  '.breadcrumbs',
  '#sidebar',
  '.sidebar',
  '.cookie-banner',
  '.cookie-notice',
];

export function isPageChromeText(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 2) return true;
  if (PAGE_CHROME_PATTERNS.some(p => p.test(t))) return true;
  if (/^skip\s+to\s+/i.test(t)) return true;
  if (/^(main|page)\s+content$/i.test(t)) return true;
  return false;
}

export function getMainContentRoot($) {
  const selectors = [
    'main',
    '[role="main"]',
    '#main-content',
    '#content',
    '#main',
    '.main-content',
    '.page-content',
    '.content-main',
    'article.profile',
    '.faculty-profile',
    '.person-profile',
    '.people-profile',
    '.node--type-profile',
  ];
  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length && el.text().replace(/\s+/g, ' ').trim().length > 60) return el;
  }

  const $body = $('body').clone();
  $body.find(CHROME_SELECTORS.join(',')).remove();
  return $body;
}

export function extractNameFromProfileUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const skip = new Set([
      'people', 'faculty', 'staff', 'profile', 'person', 'member', 'members',
      'directory', 'users', 'user', 'bio', 'about', 'team', 'our-team',
    ]);
    for (let i = parts.length - 1; i >= 0; i--) {
      let seg = decodeURIComponent(parts[i]);
      seg = seg.replace(/\.(html?|php|aspx?)$/i, '');
      if (!seg || skip.has(seg.toLowerCase())) continue;
      if (/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+$/i.test(seg)) {
        const words = seg.split(/[-_]+/).filter(w => w.length >= 2);
        if (words.length >= 2) return words.map(capitalizeWord).join(' ');
      }
    }
  } catch { /* invalid URL */ }
  return '';
}

const DIRECTORY_SLUGS = new Set([
  'faculty', 'faculty-directory', 'staff', 'staff-directory', 'directory',
  'people', 'people-directory', 'members', 'team', 'index', 'home', 'list',
  'all', 'our-faculty', 'our-team', 'profiles', 'researchers',
]);

function isPersonSlug(slug) {
  const s = String(slug || '').toLowerCase();
  if (!s || DIRECTORY_SLUGS.has(s)) return false;
  if (/directory|faculty-list|staff-list|all-/.test(s)) return false;
  // john-smith, jane_doe, first.last
  return /^[a-z][a-z0-9]*(?:[-._][a-z0-9]+)+$/i.test(s);
}

/** True only for individual profile pages — NOT faculty directory listings. */
export function isLikelySingleProfileUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (!parts.length) return false;

    const last = parts[parts.length - 1];
    const lastLower = last.toLowerCase();

    if (DIRECTORY_SLUGS.has(lastLower)) return false;
    if (/directory|faculty-list|staff-list|all-faculty/i.test(lastLower)) return false;

    if (/\/~[a-z0-9._-]+/i.test(u.pathname)) return true;
    if (isPersonSlug(last)) return true;

    return false;
  } catch {
    return false;
  }
}

export function countFacultyMailtosOnPage($, isValidEmail) {
  const emails = new Set();
  $('a[href*="mailto:"]').each((_, el) => {
    const m = ($(el).attr('href') || '').match(/mailto:([^?&"'\s]+)/i);
    if (!m) return;
    const email = m[1].toLowerCase().trim();
    if (isValidEmail?.(email)) emails.add(email);
  });
  return emails.size;
}

function cleanTitleCandidate(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*[|\-–—]\s*.+$/, '')
    .trim();
}

export function collectProfileNameCandidates($, profileUrl, rawHtml = '') {
  const root = getMainContentRoot($);
  const candidates = [];

  const fromUrl = extractNameFromProfileUrl(profileUrl);
  if (fromUrl) candidates.push({ name: fromUrl, source: 'url', score: 6 });

  root.find('[class*="profile-name"],[class*="person-name"],[class*="faculty-name"],.page-title,.entry-title,.node__title,h1,h2,h3').each((_, el) => {
    const tag = (el.tagName || '').toLowerCase();
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (!t || t.length < 3 || t.length > 80 || t.includes('@')) return;
    const score = tag === 'h1' ? 8 : tag === 'h2' ? 6 : 4;
    candidates.push({ name: t, source: tag || 'heading', score });
  });

  const og = cleanTitleCandidate($('meta[property="og:title"]').attr('content'));
  if (og) candidates.push({ name: og, source: 'og', score: 5 });

  const titleTag = cleanTitleCandidate($('title').text());
  if (titleTag) candidates.push({ name: titleTag, source: 'title', score: 3 });

  if (rawHtml) {
    const jsonLdMatch = rawHtml.match(/"name"\s*:\s*"([^"]{3,80})"/);
    if (jsonLdMatch?.[1]) candidates.push({ name: jsonLdMatch[1], source: 'jsonld', score: 7 });
  }

  return candidates;
}

export function pickBestProfileName(candidates, { emailLocalPart = '' } = {}) {
  const localKey = String(emailLocalPart || '').toLowerCase().replace(/[._-]/g, '');
  const ranked = [...candidates].sort((a, b) => b.score - a.score);

  for (const c of ranked) {
    let n = cleanTitleCandidate(c.name);
    if (isPageChromeText(n) || !isValidPersonName(n)) continue;
    const nameKey = n.toLowerCase().replace(/[^a-z]/g, '');
    if (localKey && nameKey.includes(localKey)) return { ...c, name: n };
  }

  for (const c of ranked) {
    const n = cleanTitleCandidate(c.name);
    if (!isPageChromeText(n) && isValidPersonName(n)) return { ...c, name: n };
  }
  return null;
}

export function extractProfilePageFields($, { profileUrl = '', rawHtml = '', email = '' } = {}) {
  const root = getMainContentRoot($);
  const emailLocalPart = email ? email.split('@')[0] : '';
  const picked = pickBestProfileName(collectProfileNameCandidates($, profileUrl, rawHtml), { emailLocalPart });

  let title = root.find('[class*="title"],[class*="position"],[class*="role"],.title,.position,.rank,.designation').first().text().trim();
  if (!title || isPageChromeText(title)) {
    title = extractTitleFromText(root.text());
  }

  const department = root.find('[class*="dept"],[class*="department"],.department').first().text().trim();

  let research_areas = extractAreaOfInterestFromNode($, root);
  if (!research_areas.length) {
    const bodyText = root.text().replace(/\s+/g, ' ');
    const patterns = [
      /research\s*(?:interests?|areas?|focus|topics?)[:\s]+(.*?)(?:\.|;|\n|phone|email|address|department|$)/i,
      /interests?\s*(?:include|:)\s*(.*?)(?:\.|;|\n|phone|email|address|department|$)/i,
      /area\s+of\s+interest[:\s]+(.*?)(?:\.|;|\n|phone|email|address|department|$)/i,
      /specializ(?:es?|ation|ing)\s*(?:in)?\s*[:\s]+(.*?)(?:\.|;|\n|phone|email|address|department|$)/i,
    ];
    for (const pat of patterns) {
      const m = bodyText.match(pat);
      if (m?.[1]) {
        research_areas = m[1].split(/[,;•·|\n]+/).map(s => s.trim()).filter(s => s.length >= 3 && s.length < 100);
        if (research_areas.length) break;
      }
    }
  }

  return {
    name: picked?.name || '',
    name_source: picked?.source || 'none',
    title,
    department,
    research_areas: research_areas.slice(0, 15),
  };
}
