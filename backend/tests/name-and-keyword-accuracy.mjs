/**
 * Test script: name extraction accuracy and keyword validation
 *
 * Tests the new parseFullName, extractLastName, verifyNameWithEmail,
 * and localKeywordExtractor (TF-IDF fallback) functions.
 *
 * Run: node backend/tests/name-and-keyword-accuracy.mjs
 */

import {
  parseFullName,
  lastNameFromFullName,
  lastNameFromEmail,
  verifyNameWithEmail,
  capitalizeWord,
} from '../src/utils/professor.js';
import { localKeywordExtractor, keywordFoundInSource } from '../src/ai/index.js';

// ─── Test Data ────────────────────────────────────────────────────

const CHINESE_PROFESSORS = [
  { name: 'Sheng Zhong',       email: 'szhong@ucsd.edu',        expectedLastName: 'Zhong' },
  { name: 'Zhang Wei',         email: 'wzhang@nist.gov',        expectedLastName: 'Zhang' },
  { name: 'Wei Zhang',         email: 'wzhang2@umich.edu',      expectedLastName: 'Zhang' },
  { name: 'Guihai CHEN',       email: 'gchen@nju.edu.cn',       expectedLastName: 'Chen' },
  { name: 'CHEN Guihai',       email: 'gchen@nju.edu.cn',       expectedLastName: 'Chen' },
  { name: 'Li Xuandong',       email: 'lxd@nju.edu.cn',         expectedLastName: 'Li' },
  { name: 'Zhong, Sheng',      email: 'szhong@ucsd.edu',        expectedLastName: 'Zhong' },
  { name: 'Zhao Yuxin',        email: 'yzhao@cs.wisc.edu',      expectedLastName: 'Zhao' },
  { name: 'Wang Jun',          email: 'jwang@pku.edu.cn',       expectedLastName: 'Wang' },
  { name: 'Han Lu',            email: 'lhan@fudan.edu.cn',      expectedLastName: 'Han' },
];

const WESTERN_PROFESSORS = [
  { name: 'John Smith',              email: 'jsmith@mit.edu',           expectedLastName: 'Smith' },
  { name: 'Amal Alhosban',           email: 'aalhosban@umich.edu',     expectedLastName: 'Alhosban' },
  { name: 'Ludwig van Beethoven',    email: 'lbeethoven@uni.de',       expectedLastName: 'van Beethoven' },
  { name: 'Jean-Pierre Smith-Jones', email: 'jpsmithjones@ox.ac.uk',   expectedLastName: 'Smith-Jones' },
  { name: 'Maria García-López',      email: 'mgarcia@upv.es',          expectedLastName: 'García-López' },
  { name: 'Smith, John A.',          email: 'jsmith@stanford.edu',     expectedLastName: 'Smith' },
  { name: 'KIM SEOKJIN',             email: 'skim@kaist.ac.kr',        expectedLastName: 'Kim' },
  { name: 'Johansson Erik',          email: 'ejohansson@uu.se',        expectedLastName: 'Johansson' },
  { name: 'Prof. David Koller',      email: 'dkoller@cmu.edu',         expectedLastName: 'Koller' },
  { name: 'DAVID KOLLER',            email: 'dkoller@cmu.edu',         expectedLastName: 'Koller' },
];

// ─── Name Extraction Tests ──────────────────────────────────────

function runNameTests(professors, label) {
  console.log(`\n=== ${label} Name Extraction Tests ===`);
  let correct = 0;
  let total = professors.length;

  for (const prof of professors) {
    const local = prof.email.split('@')[0];
    const domain = prof.email.split('@')[1] || '';
    const parsed = parseFullName(prof.name, local, domain);
    const verification = verifyNameWithEmail(parsed.fullName, parsed.lastName, parsed.firstName, local);
    const isCorrect = parsed.lastName === prof.expectedLastName;

    if (isCorrect) correct++;

    const status = isCorrect ? '✓' : '✗';
    console.log(`${status} "${prof.name}" (${prof.email}) → lastName="${parsed.lastName}" (expected="${prof.expectedLastName}") | source=${parsed.nameSource} | verified=${verification.verified}`);

    if (!isCorrect) {
      console.log(`  FAIL: got "${parsed.lastName}" but expected "${prof.expectedLastName}"`);
    }
  }

  const precision = (correct / total * 100).toFixed(1);
  console.log(`\nPrecision: ${correct}/${total} = ${precision}%`);
  return { correct, total, precision };
}

// ─── Keyword Validation Tests ───────────────────────────────────

function runKeywordTests() {
  console.log('\n=== Keyword Validation & TF-IDF Fallback Tests ===');

  // Test 1: keywordFoundInSource
  const sourceTexts = [
    'natural language processing, speech recognition, deep learning',
    'Attention Is All You Need: A New Simple Network Architecture for Transformers',
    'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
  ];

  const keywordTests = [
    { keyword: 'speech recognition', expected: true },
    { keyword: 'NLP', expected: true },
    { keyword: 'transformers', expected: true },
    { keyword: 'deep learning', expected: true },
    { keyword: 'LLM', expected: false },  // not in source
    { keyword: 'quantum computing', expected: false },
    { keyword: 'natural language processing', expected: true },
  ];

  let kwCorrect = 0;
  for (const test of keywordTests) {
    const found = keywordFoundInSource(test.keyword, sourceTexts);
    const status = found === test.expected ? '✓' : '✗';
    if (found === test.expected) kwCorrect++;
    console.log(`${status} keywordFoundInSource("${test.keyword}") = ${found} (expected=${test.expected})`);
  }
  console.log(`keywordFoundInSource precision: ${kwCorrect}/${keywordTests.length}`);

  // Test 2: localKeywordExtractor (TF-IDF fallback)
  const titles = [
    'Deep Learning for Speech Recognition in Low-Resource Languages',
    'Transformer-Based Models for Natural Language Processing',
    'Attention Mechanisms in Neural Machine Translation',
    'End-to-End Speech Recognition with Transformers',
    'Multilingual NLP Models for Cross-Lingual Transfer',
  ];
  const interests = 'speech recognition, natural language processing, deep learning, transformers';

  const localResult = localKeywordExtractor(titles, interests);
  console.log('\nlocalKeywordExtractor result:');
  console.log(`  subject_keyword: "${localResult.subject_keyword}"`);
  console.log(`  interest_keywords: ${JSON.stringify(localResult.interest_keywords)}`);
  console.log(`  source: ${localResult.source}`);

  // Verify that keywords come from the source texts
  const allSource = [...titles, interests];
  let localKwCorrect = 0;
  const allKws = [localResult.subject_keyword, ...localResult.interest_keywords];
  for (const kw of allKws) {
    if (keywordFoundInSource(kw, allSource)) {
      localKwCorrect++;
      console.log(`  ✓ "${kw}" found in source texts`);
    } else {
      console.log(`  ✗ "${kw}" NOT found in source texts`);
    }
  }
  console.log(`TF-IDF keyword accuracy: ${localKwCorrect}/${allKws.length}`);

  return { kwCorrect, kwTotal: keywordTests.length, localKwCorrect, localKwTotal: allKws.length };
}

// ─── Comparison: Old vs New ──────────────────────────────────────

function compareOldVsNew(professors, label) {
  console.log(`\n=== Old vs New: ${label} ===`);
  let oldCorrect = 0;
  let newCorrect = 0;

  for (const prof of professors) {
    const local = prof.email.split('@')[0];
    const domain = prof.email.split('@')[1] || '';

    // Old: lastNameFromEmail + lastNameFromFullName (original logic)
    const oldLastName = lastNameFromEmail(prof.email) || lastNameFromFullName(prof.name);

    // New: parseFullName with email hints
    const parsed = parseFullName(prof.name, local, domain);
    const newLastName = parsed.lastName;

    if (oldLastName === prof.expectedLastName) oldCorrect++;
    if (newLastName === prof.expectedLastName) newCorrect++;

    const oldStatus = oldLastName === prof.expectedLastName ? '✓' : '✗';
    const newStatus = newLastName === prof.expectedLastName ? '✓' : '✗';
    const improved = newLastName === prof.expectedLastName && oldLastName !== prof.expectedLastName;

    console.log(`  Old:${oldStatus}="${oldLastName}" | New:${newStatus}="${newLastName}" | Expected="${prof.expectedLastName}"${improved ? ' ↑ IMPROVED' : ''}`);
  }

  console.log(`\nOld precision: ${oldCorrect}/${professors.length} = ${(oldCorrect / professors.length * 100).toFixed(1)}%`);
  console.log(`New precision: ${newCorrect}/${professors.length} = ${(newCorrect / professors.length * 100).toFixed(1)}%`);
  console.log(`Improvement: +${newCorrect - oldCorrect} correct`);
  return { oldCorrect, newCorrect, total: professors.length };
}

// ─── Run All Tests ──────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════╗');
console.log('║  Name & Keyword Accuracy Test Suite          ║');
console.log('╚══════════════════════════════════════════════╝');

const chineseResults = runNameTests(CHINESE_PROFESSORS, 'Chinese Pinyin');
const westernResults = runNameTests(WESTERN_PROFESSORS, 'Western');
const keywordResults = runKeywordTests();

console.log('\n=== Old vs New Comparison ===');
const chineseComparison = compareOldVsNew(CHINESE_PROFESSORS, 'Chinese Pinyin');
const westernComparison = compareOldVsNew(WESTERN_PROFESSORS, 'Western');

console.log('\n╔══════════════════════════════════════════════╗');
console.log('║  Summary                                     ║');
console.log('╚══════════════════════════════════════════════╝');
const totalCorrect = chineseResults.correct + westernResults.correct;
const totalProfessors = chineseResults.total + westernResults.total;
console.log(`Name extraction: ${totalCorrect}/${totalProfessors} = ${(totalCorrect / totalProfessors * 100).toFixed(1)}%`);
console.log(`Keyword validation: ${keywordResults.kwCorrect}/${keywordResults.kwTotal}`);
console.log(`TF-IDF accuracy: ${keywordResults.localKwCorrect}/${keywordResults.localKwTotal}`);
const totalOld = chineseComparison.oldCorrect + westernComparison.oldCorrect;
const totalNew = chineseComparison.newCorrect + westernComparison.newCorrect;
console.log(`Old→New improvement: ${totalOld}/${totalProfessors} → ${totalNew}/${totalProfessors} (+${totalNew - totalOld})`);
