import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../db/index.js';
import { applyBasicTemplateRules, getCanonicalBasicTemplate } from './basicTemplate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_TXT_PATH = resolve(__dirname, '..', '..', '..', 'Email_Template.txt');

const DEFAULT_INSTRUCTIONS = `ONLY change 3 things per email — the rest must stay EXACTLY as in the template:

1. SUBJECT: "[Single Keyword] Seeking an MS/PhD Position in Your Lab" — pick ONE research area (1-3 words) from the professor's actual work that aligns with my background (AI/ML, ViT, Perceiver IO, multimodal, deepfake detection, forecasting). Replace [Keyword] with that area.

2. GREETING: Replace {{LAST_NAME}} with the professor's actual last name. Format: "Dear Professor LastName," — use their real last name from research, not guessed from email.

3. INTEREST LINE: Replace {{INTEREST_LINE}} with EXACTLY 3 research keywords extracted from the professor's profile (comma-separated, e.g., "semantic web services, cloud computing, self-healing systems"). These must come from their REAL research areas found during research — NOT generic terms. MAXIMUM 30 words total. DO NOT mention paper titles, publications, or citation details — only research area keywords.

TEMPLATE STRUCTURE (do NOT change any other part):
- Opening: "Greetings!" — stays identical
- My background paragraph (AI/ML, medical imaging, multimodal, deepfake, forecasting) — stays identical
- My publications list (Medical Imaging ViT, GCViT, Multimodal-FNet, Photovoltaic) — stays identical
- My methods paragraph (CNNs, LSTM/GRU, ViT, Perceiver IO, GCViT, multimodal fusion, time-series, Python, PyTorch, TensorFlow, Scikit-learn, XGBoost) — stays identical
- Interest line: "I am particularly interested in your work in {{INTEREST_LINE}}" — ONLY change {{INTEREST_LINE}} with 3 keywords, max 30 words, NO paper titles
- Closing request: "I would be glad if you have any open MS/PhD or research assistant positions in your lab." — stays identical
- Thank you + signature (Habib Ur Rehman) — stays identical`;

const DEFAULT_SUBJECT = '[Keyword] Seeking an MS/PhD Position in Your Lab';

export const BASIC_INSTRUCTIONS = `BASIC INSTANT MODE — draft rules for each professor:

ONLY change 1 thing: replace {{LAST_NAME}} with the professor's real last name (Dear Professor LastName,).

DO NOT change:
- Subject — always use exactly: "Seeking an MS/PhD Position in Your Lab" (no [Keyword], no research area)
- Email body — identical for every professor except the greeting last name
- No interest line, no research keywords, no paper references, no personalized sentences

Research step: look up last name only. Then send with fixed subject + template body.`;

export const BASIC_INSTRUCTIONS_WITH_DEFAULT = `BASIC INSTANT MODE (default subject ON) — draft rules for each professor:

ONLY change 1 thing: replace {{LAST_NAME}} with the professor's real last name (Dear Professor LastName,).

DO NOT change:
- Subject — always use exactly: "[Machine Learning] Seeking an MS/PhD Position in Your Lab" (same for every professor)
- Email body — identical for every professor except the greeting last name
- No interest line, no research keywords, no paper references, no personalized sentences

Research step: look up last name only. Subject stays fixed with [Machine Learning] for all sends.`;

export const BASIC_INSTRUCTIONS_WITH_KEYWORD = `BASIC INSTANT MODE (search subject keyword ON) — draft rules for each professor:

Change 2 things:
1. GREETING: replace {{LAST_NAME}} with the professor's real last name (Dear Professor LastName,).
2. SUBJECT: use "[Research Keyword] Seeking an MS/PhD Position in Your Lab" — pick ONE keyword from the professor's verified research areas (web search). No generic terms.

DO NOT change:
- Email body — identical except greeting last name
- No interest line, no research keywords in body, no paper references

Research step: web-search professor → verify last name + pick subject keyword from their real work → draft and send.`;

export const BASIC_SUBJECT = 'Seeking an MS/PhD Position in Your Lab';

export const BASIC_HTML = `<div dir="ltr"><p>Dear Professor {{LAST_NAME}},</p><p>Greetings!</p><p>I am Habib Ur Rehman, a BS Data Analytics graduate from Government College University Faisalabad, Pakistan. My research background is in AI/ML, medical imaging, multimodal learning, deepfake detection, photovoltaic forecasting, and predictive analytics.</p><p>I am seeking an MS/PhD position relevant to my previous works:</p><p></p><ul><li style="margin-left:15px">Medical Imaging with ViT and Perceiver IO — Computational Biology and Chemistry, 2025</li><li style="margin-left:15px">GCViT and Perceiver IO for Multi-Disease Classification — Journal of Supercomputing, 2025</li><li style="margin-left:15px">Multimodal-FNet for Audio-Visual Deepfake Detection — TPAMI, 2026</li><li style="margin-left:15px">Photovoltaic Power Forecasting using Vision Transformer and Time-Series Fusion — 2026</li></ul><p></p><p>My research experiments are mainly based on CNNs, LSTM/GRU, Vision Transformers, Perceiver IO, GCViT, multimodal fusion, and time-series models using Python, PyTorch, TensorFlow, Scikit-learn, and XGBoost, as provided in my attached resume.</p><p>I would be glad if you have any open MS/PhD or research assistant positions in your lab.</p><p>Thank you for taking the time to read this email. I look forward to your response.</p><p>Regards,<br>Habib Ur Rehman</p></div>`;

const PUBLICATION_LINES = [
  'Medical Imaging with ViT and Perceiver IO',
  'GCViT and Perceiver IO for Multi-Disease Classification',
  'Multimodal-FNet for Audio-Visual Deepfake Detection',
  'Photovoltaic Power Forecasting using Vision Transformer',
];

function isPublicationLine(line) {
  return PUBLICATION_LINES.some(prefix => line.trim().startsWith(prefix));
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert plain-text Email_Template.txt into HTML with {{LAST_NAME}} / {{INTEREST_LINE}} placeholders */
function textToHtml(text) {
  const lines = text.split(/\r?\n/);

  // Extract subject from first line
  let sampleSubject = DEFAULT_SUBJECT;
  let bodyStart = 0;
  if (lines[0]?.startsWith('Subject:')) {
    sampleSubject = lines[0].slice('Subject:'.length).trim();
    bodyStart = 1;
  }

  // Group lines: consecutive non-blank lines form a group; blank lines separate groups
  const groups = [];
  let currentGroup = [];

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (line === '') {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup = [];
      }
    } else {
      currentGroup.push(line);
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  // Convert each group to HTML
  const htmlParts = [];

  for (const group of groups) {
    // Check if all lines in the group are publication lines
    const allPubs = group.every(l => isPublicationLine(l.trim()));

    if (allPubs && group.length >= 2) {
      const items = group
        .map(l => `<li style="margin-left:15px">${escapeHtml(l.trim())}</li>`)
        .join('');
      htmlParts.push(`<ul>${items}</ul>`);
    } else {
      // Combine lines in group into one paragraph with <br> separators
      const combined = group
        .map(l => {
          let escaped = escapeHtml(l.trim());
          escaped = escaped.replace(/\{\{Professor_Work_3_Keywords\}\}/g, '{{INTEREST_LINE}}');
          return escaped;
        })
        .join('<br>');
      htmlParts.push(`<p>${combined}</p>`);
    }
  }

  const html = `<div dir="ltr">${htmlParts.join('')}</div>`;
  return { html, subject: sampleSubject };
}

export function loadTemplateFromFile(mode = 'instant') {
  let text;
  try {
    if (!existsSync(TEMPLATE_TXT_PATH)) {
      console.warn(`[TemplateSeeder] Email_Template.txt not found at ${TEMPLATE_TXT_PATH}`);
      return { success: false, reason: 'template_file_not_found' };
    }
    text = readFileSync(TEMPLATE_TXT_PATH, 'utf8');
  } catch (e) {
    console.error('[TemplateSeeder] Failed to read Email_Template.txt:', e.message);
    return { success: false, reason: e.message };
  }

  const { html, subject: fileSubject } = textToHtml(text);

  const existing = db.prepare('SELECT instructions, sample_subject FROM template WHERE mode=?').get(mode);
  const instructions = mode === 'basic_instant'
    ? BASIC_INSTRUCTIONS
    : (existing?.instructions || DEFAULT_INSTRUCTIONS);
  const sampleSubject = mode === 'basic_instant'
    ? BASIC_SUBJECT
    : (existing?.sample_subject || fileSubject || DEFAULT_SUBJECT);

  db.prepare(`UPDATE template SET raw_html=?, last_name_placeholder=?, interest_line_placeholder=?, instructions=?, sample_subject=? WHERE mode=?`).run(
    mode === 'basic_instant' ? BASIC_HTML : html,
    '{{LAST_NAME}}',
    mode === 'basic_instant' ? null : '{{INTEREST_LINE}}',
    instructions,
    sampleSubject,
    mode,
  );

  const hasLastName = html.includes('{{LAST_NAME}}');
  const hasInterestLine = html.includes('{{INTEREST_LINE}}');

  return {
    success: true,
    rawHtml: html,
    placeholders: { lastName: '{{LAST_NAME}}', interestLine: '{{INTEREST_LINE}}' },
    hasPlaceholders: hasLastName && hasInterestLine,
    needsPlaceholders: !hasLastName || !hasInterestLine,
    source: 'Email_Template.txt',
  };
}

export function seedBasicInstantTemplate() {
  const canonical = getCanonicalBasicTemplate();
  const existing = db.prepare("SELECT id FROM template WHERE mode='basic_instant'").get();
  if (!existing) {
    db.prepare(`
      INSERT INTO template (raw_html, last_name_placeholder, interest_line_placeholder, instructions, sample_subject, mode)
      VALUES (?, ?, ?, ?, ?, 'basic_instant')
    `).run(canonical.raw_html, canonical.last_name_placeholder, null, canonical.instructions, canonical.sample_subject);
  } else {
    db.prepare(`
      UPDATE template SET
        raw_html=?,
        last_name_placeholder=?,
        interest_line_placeholder=NULL,
        instructions=?,
        sample_subject=?
      WHERE mode='basic_instant'
    `).run(canonical.raw_html, canonical.last_name_placeholder, canonical.instructions, canonical.sample_subject);
  }
}

export function seedBasicScheduledTemplate() {
  const canonical = getCanonicalBasicTemplate();
  const existing = db.prepare("SELECT id FROM scheduled_template WHERE mode='basic_scheduled'").get();
  if (!existing) {
    db.prepare(`
      INSERT INTO scheduled_template (raw_html, last_name_placeholder, interest_line_placeholder, instructions, sample_subject, mode)
      VALUES (?, ?, NULL, ?, ?, 'basic_scheduled')
    `).run(canonical.raw_html, canonical.last_name_placeholder, canonical.instructions, canonical.sample_subject);
  } else {
    db.prepare(`
      UPDATE scheduled_template SET
        raw_html=?,
        last_name_placeholder=?,
        interest_line_placeholder=NULL,
        instructions=?,
        sample_subject=?
      WHERE mode='basic_scheduled'
    `).run(canonical.raw_html, canonical.last_name_placeholder, canonical.instructions, canonical.sample_subject);
  }
}

export function seedBothModes() {
  const hasExistingTemplate = db.prepare('SELECT COUNT(*) AS c FROM template').get().c > 0
    || db.prepare('SELECT COUNT(*) AS c FROM scheduled_template').get().c > 0;
  if (!hasExistingTemplate) {
    console.log('[TemplateSeeder] Empty user workspace - waiting for the user to load their own template');
    return;
  }

  // Seed instant-mode template in the shared template table
  loadTemplateFromFile('instant');
  seedBasicInstantTemplate();

  // Seed scheduled-mode template in the SEPARATE scheduled_template table
  const schedResult = loadTemplateFromFile('scheduled');
  const schedHtml = schedResult.success ? schedResult.rawHtml : null;

  if (schedHtml) {
    // The scheduled_template table has no mode column — update ALL rows
    db.prepare(`
      UPDATE scheduled_template SET raw_html=COALESCE(raw_html,?), instructions=?, sample_subject=?
    `).run(schedHtml, DEFAULT_INSTRUCTIONS, DEFAULT_SUBJECT);
  }

  console.log('[TemplateSeeder] Seeded template for instant, basic_instant, and scheduled modes');
}

export { DEFAULT_INSTRUCTIONS, DEFAULT_SUBJECT };
