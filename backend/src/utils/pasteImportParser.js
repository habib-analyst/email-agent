import { parseTextDocumentToEntries } from './spreadsheetParser.js';
import {
  lastNameFromEmail,
  lastNameFromFullName,
  fullNameFromEmail,
  universityFromEmail,
  capitalizeWord,
} from './professor.js';
import { normalizeInterestLineKeywords } from './interestLine.js';
import { keywordsFromProfileOnly } from '../ai/index.js';

const EMAIL_REGEX = /[\w.-]+@[\w.-]+\.[a-z]{2,}/i;

function splitResearchAreas(value) {
  return String(value || '')
    .split(/[,;|]/)
    .map(s => s.trim())
    .filter(Boolean);
}

function extractEmailFromLine(line) {
  const bracket = String(line || '').match(/<([\w.-]+@[\w.-]+\.[a-z]{2,})>/i);
  if (bracket) return bracket[1].toLowerCase();
  const plain = String(line || '').match(EMAIL_REGEX);
  return plain ? plain[0].toLowerCase() : '';
}

/** Parse pasted raw text into structured professor entries. */
export function parseRawEmailImportText(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const structured = parseTextDocumentToEntries(raw);
  if (structured.length) return structured;

  const entries = [];
  const seen = new Set();

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const email = extractEmailFromLine(trimmed);
    if (!email || seen.has(email)) continue;
    seen.add(email);

    const withoutEmail = trimmed
      .replace(/<[\w.-]+@[\w.-]+\.[a-z]{2,}>/gi, ' ')
      .replace(EMAIL_REGEX, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const full_name = withoutEmail && !/^[,;|—–-]+$/.test(withoutEmail) ? withoutEmail : (fullNameFromEmail(email) || '');
    entries.push({
      email,
      full_name: full_name || null,
      last_name: lastNameFromFullName(full_name) || lastNameFromEmail(email) || null,
      university: universityFromEmail(email),
      source: 'email_only',
    });
  }

  return entries;
}

/** Convert a parsed import entry into a professor object for queue / roster import. */
export function professorFromImportEntry(entry) {
  const email = String(entry?.email || '').trim().toLowerCase();
  const full_name = String(entry?.full_name || '').trim();
  const last_name = capitalizeWord(
    String(entry?.last_name || '').trim()
      || lastNameFromFullName(full_name)
      || lastNameFromEmail(email)
      || '',
  );
  const researchRaw = entry?.research_interest || entry?.interest_line || '';
  const research_interest = normalizeInterestLineKeywords(researchRaw);
  const research_areas = splitResearchAreas(research_interest);

  return {
    email,
    name: full_name || '',
    last_name,
    university: entry?.university || universityFromEmail(email),
    department: entry?.department || '',
    research_areas,
    research_interest,
    subject_keyword: String(entry?.subject_keyword || '').trim(),
    interest_line: normalizeInterestLineKeywords(entry?.interest_line || research_interest),
    profile_url: entry?.profile_url || '',
    source_url: entry?.profile_url || '',
    source: entry?.source || 'paste',
    roster_import: true,
  };
}

export function hasPastedProfessorData(prof) {
  if (!prof) return false;
  return !!(
    prof.roster_import
    || prof.name?.trim()
    || prof.last_name?.trim()
    || prof.research_interest?.trim()
    || prof.interest_line?.trim()
    || prof.subject_keyword?.trim()
    || (Array.isArray(prof.research_areas) && prof.research_areas.length)
  );
}

/** Build a dossier from user-pasted name / email / research keywords. */
export function buildDossierFromPastedProfessor(prof, mode = 'instant') {
  const isBasic = mode === 'basic_instant' || mode === 'basic_scheduled';
  const research_areas = Array.isArray(prof.research_areas) && prof.research_areas.length
    ? prof.research_areas
    : splitResearchAreas(prof.research_interest || prof.research_areas || '');

  let interest_line = normalizeInterestLineKeywords(prof.interest_line || research_areas.slice(0, 3).join(', '));
  let subject_keyword = String(prof.subject_keyword || '').trim();

  if (research_areas.length && (!subject_keyword || !interest_line)) {
    const fromProfile = keywordsFromProfileOnly({ research_areas, projects: [], papers: [] });
    if (fromProfile?.subject_keyword) {
      subject_keyword = subject_keyword || fromProfile.subject_keyword;
      if (!interest_line && fromProfile.interest_keywords?.length) {
        interest_line = normalizeInterestLineKeywords(fromProfile.interest_keywords.slice(0, 3).join(', '));
      }
    }
  }

  if (!subject_keyword && research_areas.length) subject_keyword = research_areas[0];

  const full_name = String(prof.name || prof.full_name || '').trim();
  const last_name = capitalizeWord(
    String(prof.last_name || '').trim()
      || lastNameFromFullName(full_name)
      || lastNameFromEmail(prof.email)
      || '',
  );

  return {
    email: prof.email,
    name: full_name || last_name,
    last_name,
    university: prof.university || universityFromEmail(prof.email),
    department: prof.department || '',
    research_areas,
    papers: [],
    projects: [],
    interest_line: isBasic ? '' : interest_line,
    subject_keyword: subject_keyword || '',
    profile_url: prof.profile_url || prof.source_url || '',
    verified: last_name.length >= 2,
    name_verified: full_name.includes(' ') && last_name.length >= 2,
    profile_research_status: research_areas.length ? 'profile_found' : 'none_on_page',
    research_source: 'paste_import',
    roster_import: true,
    roster: {
      full_name: full_name || last_name,
      last_name,
      email: prof.email,
      university: prof.university || universityFromEmail(prof.email),
      department: prof.department || '',
      research_interest: research_areas.join(', '),
      subject_keyword: subject_keyword || '',
      interest_line: isBasic ? '' : interest_line,
      profile_url: prof.profile_url || prof.source_url || '',
    },
  };
}

export function professorsFromRawImportInput(emails) {
  if (!emails) return [];

  if (typeof emails === 'string') {
    return parseRawEmailImportText(emails).map(professorFromImportEntry);
  }

  if (!Array.isArray(emails) || !emails.length) return [];

  if (typeof emails[0] === 'object' && emails[0]?.email) {
    return emails.map(professorFromImportEntry);
  }

  const joined = emails.join('\n');
  const parsed = parseRawEmailImportText(joined);
  const hasStructured = parsed.some(e => e.full_name || e.research_interest || e.interest_line);
  if (hasStructured) return parsed.map(professorFromImportEntry);

  return emails
    .map(e => String(e || '').trim().toLowerCase())
    .filter(e => e.includes('@'))
    .map(email => professorFromImportEntry({ email, source: 'email_only' }));
}
