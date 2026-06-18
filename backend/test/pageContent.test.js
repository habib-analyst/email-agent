import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import {
  isPageChromeText,
  extractNameFromProfileUrl,
  pickBestProfileName,
  collectProfileNameCandidates,
  extractProfilePageFields,
  isLikelySingleProfileUrl,
} from '../src/research/pageContent.js';
import { isSparseRosterRow, mergeRosterRow, hasSubstantiveRosterData } from '../src/learning/rosterExcel.js';

test('isPageChromeText rejects skip links', () => {
  assert.equal(isPageChromeText('Skip To Content'), true);
  assert.equal(isPageChromeText('Skip to main content'), true);
  assert.equal(isPageChromeText('Jane Smith'), false);
});

test('extractNameFromProfileUrl parses slug', () => {
  assert.equal(
    extractNameFromProfileUrl('https://cs.university.edu/people/faculty/jane-smith'),
    'Jane Smith',
  );
});

test('profile page avoids skip link as name', () => {
  const html = `
    <body>
      <header><a href="#main">Skip To Content</a></header>
      <main id="main">
        <h1>Dr. Alice Johnson</h1>
        <p>Assistant Professor of Computer Science</p>
        <p>Area of Interest: Machine Learning, NLP, Robotics</p>
        <a href="mailto:ajohnson@university.edu">ajohnson@university.edu</a>
      </main>
    </body>`;
  const $ = cheerio.load(html);
  const fields = extractProfilePageFields($, {
    profileUrl: 'https://cs.university.edu/people/faculty/alice-johnson',
    rawHtml: html,
    email: 'ajohnson@university.edu',
  });
  assert.match(fields.name, /Alice Johnson/i);
  assert.ok(!/Skip/i.test(fields.name));
  assert.ok(fields.research_areas.length >= 1);
  assert.match(fields.title || '', /Assistant Professor/i);
});

test('isLikelySingleProfileUrl', () => {
  assert.equal(isLikelySingleProfileUrl('https://uni.edu/people/alice-johnson'), true);
  assert.equal(isLikelySingleProfileUrl('https://cs.mst.edu/people/faculty-directory/'), false);
  assert.equal(isLikelySingleProfileUrl('https://uni.edu/faculty/'), false);
});

test('roster merge keeps existing substantive row', () => {
  const existing = {
    email: 'a@uni.edu',
    full_name: 'Alice Johnson',
    designation: 'Professor',
    research_interest: 'ML, NLP',
  };
  const incoming = { email: 'a@uni.edu', full_name: 'Skip To Content', last_name: 'Content' };
  const merged = mergeRosterRow(existing, incoming);
  assert.equal(merged.full_name, 'Alice Johnson');
  assert.equal(merged.designation, 'Professor');
});

test('sparse roster row gets filled from incoming', () => {
  const existing = { email: 'a@uni.edu' };
  const incoming = {
    email: 'a@uni.edu',
    full_name: 'Alice Johnson',
    designation: 'Professor',
    research_interest: 'ML',
  };
  assert.equal(isSparseRosterRow(existing), true);
  assert.equal(hasSubstantiveRosterData(incoming), true);
  const merged = mergeRosterRow(existing, incoming);
  assert.equal(merged.full_name, 'Alice Johnson');
  assert.equal(merged.research_interest, 'ML');
});
