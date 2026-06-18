import { universityFromEmail, lastNameFromFullName } from './professor.js';

const EMAIL_REGEX = /[\w.-]+@[\w.-]+\.[a-z]{2,}/i;

export const STANDARD_IMPORT_HEADERS = [
  'full_name', 'last_name', 'email', 'subject_keyword', 'interest_line',
  'university', 'department', 'profile_url',
];

export const STANDARD_IMPORT_DISPLAY_HEADERS = [
  'Full Name', 'Last Name', 'Email', 'Subject Keyword', 'Interest Line',
  'University', 'Department', 'Profile URL',
];

const HEADER_ALIASES = {
  email: ['email', 'professoremail', 'e-mail', 'mail', 'emailaddress'],
  last_name: ['lastname', 'last', 'surname', 'familyname'],
  first_name: ['firstname', 'first', 'givenname'],
  full_name: ['name', 'fullname', 'professor', 'professorname'],
  university: ['university', 'institution', 'school', 'org', 'college', 'affiliation'],
  research_interest: ['researchinterest', 'researchinterests', 'researcharea', 'researchareas', 'research', 'interests', 'field', 'fields', 'specialization', 'specialty', 'topics', 'expertise'],
  subject_keyword: ['subjectkeyword', 'keyword', 'subject', 'subjectkey'],
  interest_line: ['interestline', 'interestlinekeywords', 'interestkeywords', '3keywordsinterestline', 'keywords', 'interest', 'keytopics', 'researchkeywords'],
  department: ['department', 'dept', 'division', 'faculty'],
  profile_url: ['profileurl', 'profile', 'website', 'url', 'homepage', 'link', 'pagelink'],
};

function normHeader(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findColumnIndex(headers, key) {
  const aliases = HEADER_ALIASES[key] || [];
  const normalized = headers.map(normHeader);
  for (const alias of aliases) {
    const idx = normalized.indexOf(alias);
    if (idx >= 0) return idx;
  }
  return -1;
}

function looksLikeHeaderRow(row) {
  const norms = (row || []).map(c => normHeader(c));
  for (const aliases of Object.values(HEADER_ALIASES)) {
    if (aliases.some(a => norms.includes(a))) return true;
  }
  return false;
}

function rowContainsEmail(row) {
  for (const cell of row || []) {
    if (EMAIL_REGEX.test(String(cell || ''))) return true;
  }
  return false;
}

function extractEmail(text) {
  const raw = String(text || '');
  const bracket = raw.match(/<([\w.-]+@[\w.-]+\.[a-z]{2,})>/i);
  if (bracket) return bracket[1].toLowerCase();
  const m = raw.match(EMAIL_REGEX);
  return m ? m[0].toLowerCase() : '';
}

function isLikelyName(text) {
  const s = String(text || '').trim();
  if (!s || s.length < 2 || s.length > 80) return false;
  if (EMAIL_REGEX.test(s)) return false;
  if (/^https?:\/\//i.test(s)) return false;
  if (/^\d+$/.test(s)) return false;
  if (/[;,|]/.test(s)) return false;
  if ((s.match(/,/g) || []).length >= 1) return false;
  if (!/[a-zA-Z\u00C0-\u024F\u4e00-\u9fff]/.test(s)) return false;
  return true;
}

function isLikelyKeywords(text) {
  const s = String(text || '').trim();
  if (!s || s.length < 4) return false;
  if (EMAIL_REGEX.test(s)) return false;
  if (/^(dr|prof|professor|mr|mrs|ms|dear)\.?\s/i.test(s)) return false;
  if (/[,;|]/.test(s)) return true;
  const words = s.split(/\s+/).filter(Boolean);
  return words.length >= 4;
}

function isLikelyUrl(text) {
  const s = String(text || '').trim();
  return /^https?:\/\//i.test(s) || /\.(edu|org|com)\//i.test(s);
}

function splitKeywords(text) {
  return String(text || '')
    .split(/[,;|]/)
    .map(s => s.trim())
    .filter(Boolean);
}

function buildFullName(first, last, full) {
  if (full?.trim()) return full.trim();
  if (first && last) return `${first} ${last}`.trim();
  return first?.trim() || '';
}

function cellAt(row, idx) {
  if (idx < 0) return '';
  return String(row[idx] ?? '').trim();
}

function inferFromUnstructuredCells(cells, emailIdx) {
  let nameCandidate = '';
  let keywordCandidate = '';
  let urlCandidate = '';

  for (let i = 0; i < cells.length; i++) {
    if (i === emailIdx) continue;
    const cell = cells[i];
    if (!cell || extractEmail(cell)) continue;
    if (isLikelyUrl(cell)) urlCandidate = cell;
    else if (isLikelyName(cell) && cell.length >= nameCandidate.length) nameCandidate = cell;
  }

  for (let i = 0; i < cells.length; i++) {
    if (i === emailIdx || cells[i] === nameCandidate) continue;
    const cell = cells[i];
    if (!cell || extractEmail(cell)) continue;
    if (isLikelyKeywords(cell) && !keywordCandidate) keywordCandidate = cell;
  }

  return { nameCandidate, keywordCandidate, urlCandidate };
}

function parseRow(row, indices) {
  const cells = (row || []).map(c => String(c ?? '').trim());
  if (!cells.some(Boolean)) return null;

  let emailIdxInRow = indices.email;
  let email = cellAt(row, indices.email);
  if (!email) {
    for (let i = 0; i < cells.length; i++) {
      const found = extractEmail(cells[i]);
      if (found) {
        email = found;
        emailIdxInRow = i;
        break;
      }
    }
  }
  if (!email) return null;

  const inferred = inferFromUnstructuredCells(cells, emailIdxInRow >= 0 ? emailIdxInRow : -1);

  let full_name = cellAt(row, indices.full_name);
  const first = cellAt(row, indices.first_name);
  const last_raw = cellAt(row, indices.last_name);
  if (!full_name) full_name = buildFullName(first, last_raw, inferred.nameCandidate);

  let research_interest = cellAt(row, indices.research_interest);
  if (!research_interest && inferred.keywordCandidate) research_interest = inferred.keywordCandidate;

  let interest_line = cellAt(row, indices.interest_line);
  if (!interest_line && research_interest) {
    interest_line = splitKeywords(research_interest).slice(0, 3).join(', ');
  }

  const subject_keyword = cellAt(row, indices.subject_keyword);
  let last_name = last_raw;
  if (!last_name && full_name) last_name = lastNameFromFullName(full_name) || '';
  if (!full_name && last_name) full_name = last_name;

  const university = cellAt(row, indices.university) || universityFromEmail(email);
  const profile_url = cellAt(row, indices.profile_url) || inferred.urlCandidate || '';

  return {
    email,
    full_name: full_name || null,
    last_name: last_name || null,
    university: university || null,
    research_interest: research_interest || null,
    subject_keyword: subject_keyword || null,
    interest_line: interest_line || null,
    department: cellAt(row, indices.department) || null,
    profile_url: profile_url || null,
    source: 'roster',
  };
}

/** Parse spreadsheet rows into structured professor entries (headers or raw data). */
export function parseSpreadsheetRows(rows) {
  if (!rows?.length) {
    return { entries: [], headers: [], hasStructuredColumns: false, normalizedRows: [] };
  }

  const firstRow = rows[0] || [];
  const hasHeader = looksLikeHeaderRow(firstRow) && !rowContainsEmail(firstRow);
  const dataStart = hasHeader ? 1 : 0;
  const headers = hasHeader ? firstRow.map(c => String(c || '').trim()) : [];

  const indices = {
    email: findColumnIndex(headers, 'email'),
    last_name: findColumnIndex(headers, 'last_name'),
    first_name: findColumnIndex(headers, 'first_name'),
    full_name: findColumnIndex(headers, 'full_name'),
    university: findColumnIndex(headers, 'university'),
    research_interest: findColumnIndex(headers, 'research_interest'),
    subject_keyword: findColumnIndex(headers, 'subject_keyword'),
    interest_line: findColumnIndex(headers, 'interest_line'),
    department: findColumnIndex(headers, 'department'),
    profile_url: findColumnIndex(headers, 'profile_url'),
  };

  const hasStructuredColumns =
    hasHeader ||
    indices.email >= 0 ||
    indices.last_name >= 0 ||
    indices.full_name >= 0;

  const entries = [];
  const seen = new Set();

  for (let ri = dataStart; ri < rows.length; ri++) {
    const entry = parseRow(rows[ri], indices);
    if (!entry || seen.has(entry.email)) continue;
    seen.add(entry.email);
    entries.push(entry);
  }

  const normalizedRows = entries.map(entryToNormalizedRow);
  return { entries, headers, hasStructuredColumns, normalizedRows };
}

function entryToNormalizedRow(entry) {
  return STANDARD_IMPORT_HEADERS.map(h => entry[h] || '');
}

export function entriesToNormalizedSheet(entries) {
  const cols = ['full_name', 'last_name', 'email', 'subject_keyword', 'interest_line'];
  const displayHeaders = cols.map(h => STANDARD_IMPORT_DISPLAY_HEADERS[STANDARD_IMPORT_HEADERS.indexOf(h)]);
  return {
    name: 'Organized import',
    headers: displayHeaders,
    rows: entries.map(e => cols.map(h => e[h] || '')),
    totalRows: entries.length,
  };
}

export function entriesToEmailList(entries) {
  return entries.map(e => e.email);
}

/** Parse raw text/doc content into roster entries (name, email, keywords per line). */
export function parseTextDocumentToEntries(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim());
  const entries = [];
  const seen = new Set();

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!line) continue;
    const email = extractEmail(line);
    if (!email || seen.has(email)) continue;
    seen.add(email);

    const parts = line.split(/[\t|,;|]+/).map(p => p.trim()).filter(Boolean);
    const emailIdx = parts.findIndex(p => extractEmail(p)?.toLowerCase() === email);

    let full_name = '';
    let last_name = '';
    let keywords = '';

    if (emailIdx >= 0 && parts.length >= 2) {
      const before = parts.slice(0, emailIdx).filter(p => !extractEmail(p));
      const after = parts.slice(emailIdx + 1).filter(p => !extractEmail(p));
      if (before.length === 1) {
        full_name = before[0];
        last_name = lastNameFromFullName(full_name);
      } else if (before.length >= 2) {
        full_name = before.join(' ');
        last_name = before[before.length - 1];
      }
      if (after.length) keywords = after.join(', ');
    } else {
      const prev = lines[li - 1] || '';
      if (prev && isLikelyName(prev) && !extractEmail(prev)) {
        full_name = prev;
        last_name = lastNameFromFullName(full_name);
      }
      const next = lines[li + 1] || '';
      if (next && isLikelyKeywords(next) && !extractEmail(next)) {
        keywords = next;
      }
    }

    entries.push({
      email,
      full_name: full_name || null,
      last_name: last_name || null,
      university: universityFromEmail(email),
      research_interest: keywords || null,
      interest_line: keywords || null,
      source: 'text_extract',
    });
  }

  return entries;
}
