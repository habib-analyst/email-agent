import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import Database from 'better-sqlite3';

const TEMPLATE_TXT_PATH = resolve('D:/email-agent/Email_Template.txt');
const db = new Database('./data.db');

const text = readFileSync(TEMPLATE_TXT_PATH, 'utf8');
const lines = text.split(/\r?\n/);

// Extract subject
let sampleSubject = '[Keyword] Seeking an MS/PhD Position in Your Lab';
let bodyStart = 0;
if (lines[0]?.startsWith('Subject:')) {
  sampleSubject = lines[0].slice('Subject:'.length).trim();
  bodyStart = 1;
}

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

// Group lines
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

console.log('Groups:');
groups.forEach((g, i) => console.log(`  Group ${i}: ${g.length} lines - "${g[0]?.substring(0, 60)}..."`));

// Convert
const htmlParts = [];
for (const group of groups) {
  const allPubs = group.every(l => isPublicationLine(l.trim()));
  if (allPubs && group.length >= 2) {
    const items = group.map(l => `<li style="margin-left:15px">${escapeHtml(l.trim())}</li>`).join('');
    htmlParts.push(`<ul>${items}</ul>`);
  } else {
    const combined = group.map(l => {
      let escaped = escapeHtml(l.trim());
      escaped = escaped.replace(/\{\{Professor_Work_3_Keywords\}\}/g, '{{INTEREST_LINE}}');
      return escaped;
    }).join('<br>');
    htmlParts.push(`<p>${combined}</p>`);
  }
}

const html = `<div dir="ltr">${htmlParts.join('')}</div>`;
console.log('\n--- Generated HTML ---');
console.log(html);

console.log('\n--- Validation ---');
console.log('Has {{LAST_NAME}}:', html.includes('{{LAST_NAME}}'));
console.log('Has {{INTEREST_LINE}}:', html.includes('{{INTEREST_LINE}}'));
console.log('Has {{Professor_Work_3_Keywords}}:', html.includes('{{Professor_Work_3_Keywords}}'));
console.log('Has Regards<br>Habib:', html.includes('Regards,<br>Habib'));

// Compare with existing DB template
const existing = db.prepare("SELECT raw_html FROM template WHERE mode='instant'").get();
console.log('\n--- DB comparison ---');
console.log('DB instant template length:', existing?.raw_html?.length || 0);
console.log('New HTML length:', html.length);
console.log('Match:', existing?.raw_html === html);

db.close();