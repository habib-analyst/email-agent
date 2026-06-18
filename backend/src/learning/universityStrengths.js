/**
 * Build strength tags for a university based on name heuristics + user major keywords.
 */
export function inferStrengthsForUniversity(name, majorLines = []) {
  const n = (name || '').toLowerCase();
  const strengths = new Set([
    'artificial intelligence',
    'machine learning',
    'deep learning',
    'computer science',
    'data science',
    'data analytics',
    'software engineering',
  ]);

  const majorText = majorLines.join(' ').toLowerCase();

  if (/medical|health|nursing|pharmacy|dental|hospital|clinic|biomedical|life science/.test(n)) {
    strengths.add('medical imaging');
    strengths.add('health informatics');
    strengths.add('biomedical engineering');
    strengths.add('bioinformatics');
    strengths.add('computer vision');
  }
  if (/tech|engineering|polytechnic|institute of technology/.test(n)) {
    strengths.add('robotics');
    strengths.add('computer vision');
    strengths.add('signal processing');
    strengths.add('intelligent systems');
  }
  if (/science|research|graduate/.test(n)) {
    strengths.add('computational science');
    strengths.add('applied mathematics');
  }

  // Tag strengths that appear in both majors file and are relevant to CS/STEM outreach
  for (const line of majorLines) {
    const low = line.toLowerCase();
    if (low.length < 4) continue;
    if (
      /ai|machine|learning|vision|imaging|medical|health|bio|data|analytics|nlp|robot|security|forecast|time series|multimodal|neural|computational|informatics|statistics|software|engineering|signal|image|deep|generative|healthcare|privacy|blockchain|iot|cloud|edge|adversarial|biometric|remote sensing|geospatial|mining|speech|audio|genomic|omics|neuro|brain/.test(low)
    ) {
      strengths.add(low);
    }
  }

  return [...strengths];
}

export function hintsFromUniversityName(name) {
  const hints = new Set();
  const low = name.toLowerCase();
  hints.add(low);
  const stripped = low
    .replace(/university of /g, '')
    .replace(/the university of /g, '')
    .replace(/university/g, '')
    .replace(/college/g, '')
    .trim();
  if (stripped.length > 2) hints.add(stripped);
  const first = name.split(/\s+/)[0]?.toLowerCase();
  if (first && first.length > 2) hints.add(first);
  // Common abbreviations
  if (low.includes('pennsylvania state')) hints.add('penn state');
  if (low.includes('virginia polytechnic')) hints.add('virginia tech', 'vt');
  if (low.includes('illinois urbana')) hints.add('uiuc');
  if (low.includes('north carolina state')) hints.add('nc state');
  if (low.includes('texas a&m')) hints.add('tamu');
  return [...hints].filter(h => h.length > 2);
}

export function buildUniversityEntry(name, majorLines) {
  return {
    name,
    hints: hintsFromUniversityName(name),
    strengths: inferStrengthsForUniversity(name, majorLines),
  };
}
