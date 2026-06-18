/**
 * Detect professor / faculty rank from scraped title or card text.
 * Used to tag Excel rows and prioritize true professors.
 */

export const PROFESSOR_RANK_PATTERN = /\b(assistant|associate|adjunct|visiting|clinical|research|distinguished|endowed|full)?\s*prof(?:essor)?\.?\b/i;

const RANK_PATTERNS = [
  { rank: 'assistant_professor', pattern: /\bassistant\s+prof(?:essor)?\.?\b/i, label: 'Assistant Professor' },
  { rank: 'associate_professor', pattern: /\bassociate\s+prof(?:essor)?\.?\b/i, label: 'Associate Professor' },
  { rank: 'professor', pattern: /\b(?:full\s+)?prof(?:essor)?\.?\b/i, label: 'Professor' },
  { rank: 'lecturer', pattern: /\blecturer\b/i, label: 'Lecturer' },
  { rank: 'instructor', pattern: /\binstructor\b/i, label: 'Instructor' },
  { rank: 'research_scientist', pattern: /\bresearch\s+(?:scientist|fellow|professor)\b/i, label: 'Research Scientist' },
  { rank: 'postdoc', pattern: /\bpost[-\s]?doc(?:toral)?\b/i, label: 'Postdoc' },
];

/** Pull a faculty title phrase from unstructured card/page text. */
export function extractTitleFromText(text) {
  if (!text) return '';
  const t = String(text).replace(/\s+/g, ' ').trim();

  const labeled = t.match(
    /(?:title|position|rank|designation|role)\s*[:\-]\s*([^.\n|]{3,80})/i,
  );
  if (labeled?.[1]) return labeled[1].trim();

  for (const { pattern } of RANK_PATTERNS) {
    const m = t.match(pattern);
    if (m) {
      const idx = t.toLowerCase().indexOf(m[0].toLowerCase());
      const chunk = t.slice(idx, idx + 120);
      const phrase = chunk.match(
        new RegExp(`${m[0]}(?:\\s+of\\s+[A-Za-z][A-Za-z\\s&,/-]{0,60})?`, 'i'),
      );
      if (phrase) return phrase[0].trim();
      return m[0].trim();
    }
  }
  return '';
}

export function classifyFacultyTitle(titleOrText) {
  const text = String(titleOrText || '').trim();
  if (!text) {
    return { rank: 'unknown', isProfessorRank: false, label: '', designation: '' };
  }

  for (const { rank, pattern, label } of RANK_PATTERNS) {
    if (pattern.test(text)) {
      const isProfessorRank = rank.includes('professor') || rank === 'research_scientist';
      const designation = extractTitleFromText(text) || label;
      return { rank, isProfessorRank, label, designation };
    }
  }

  if (/\bfaculty\b/i.test(text)) {
    return { rank: 'faculty', isProfessorRank: false, label: 'Faculty', designation: extractTitleFromText(text) || 'Faculty' };
  }

  return { rank: 'unknown', isProfessorRank: false, label: '', designation: extractTitleFromText(text) || text.slice(0, 80) };
}

export function enrichProfessorTitle(prof) {
  const fromTitle = prof.title || prof.designation || '';
  const fromCard = prof._cardText || '';
  const combined = `${fromTitle} ${fromCard}`.trim();
  const classified = classifyFacultyTitle(fromTitle || extractTitleFromText(combined) || combined);

  const designation = classified.designation
    || fromTitle
    || extractTitleFromText(combined)
    || '';

  return {
    ...prof,
    title: designation || prof.title || '',
    designation: designation || prof.designation || '',
    faculty_rank: classified.rank,
    is_professor_rank: classified.isProfessorRank,
    faculty_rank_label: classified.label || (classified.isProfessorRank ? 'Professor' : ''),
  };
}

export function isProfessorRankTitle(titleOrText) {
  return classifyFacultyTitle(titleOrText).isProfessorRank;
}
