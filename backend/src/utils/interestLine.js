/**
 * {{INTEREST_LINE}} is replaced with keywords only — the template owns the trailing period.
 * e.g. "...your work in Keyword1, Keyword2, Keyword3."
 */
export function normalizeInterestLineKeywords(line) {
  if (!line) return '';
  let s = String(line).trim();
  s = s.replace(/I am (?:particularly )?interested in your work (?:on|in)\s*/gi, '').trim();
  s = s.replace(/[.!?]+$/, '').trim();

  // Keep only first 3 keywords for all modes + Excel roster consistency.
  const parts = s
    .split(/[,;|]/)
    .map(p => p.trim())
    .filter(Boolean);

  // If it wasn't comma/semicolon separated, fall back to space-based heuristics.
  const cleaned = (parts.length >= 2 ? parts : [s]).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return cleaned.slice(0, 3).join(', ');
}
