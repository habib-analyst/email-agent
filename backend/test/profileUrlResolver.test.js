import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import {
  scoreProfileUrlCandidate,
  extractProfileUrlCandidates,
  rankProfileUrlsForProfessor,
  profileDataRichness,
  mergeProfessorProfileData,
} from '../src/research/profileUrlResolver.js';

test('prefers primary profile path over CV', () => {
  const profile = scoreProfileUrlCandidate('https://uni.edu/people/jane-smith', { email: 'jane.smith@uni.edu' });
  const cv = scoreProfileUrlCandidate('https://uni.edu/cv/jane-smith.pdf', { email: 'jane.smith@uni.edu' });
  assert.ok(profile > cv);
});

test('extractProfileUrlCandidates finds multiple links in card', () => {
  const html = `
    <div class="faculty-card">
      <a href="mailto:jane@uni.edu">Jane Smith</a>
      <a href="/people/jane-smith">View Profile</a>
      <a href="/cv/jane-smith.pdf">CV</a>
      <a href="https://scholar.google.com/citations?user=abc">Scholar</a>
    </div>
  `;
  const $ = cheerio.load(html);
  const candidates = extractProfileUrlCandidates($, $('.faculty-card'), 'https://uni.edu/faculty');
  assert.ok(candidates.length >= 1);
  assert.ok(candidates[0].url.includes('/people/jane-smith'));
});

test('rankProfileUrlsForProfessor dedupes and sorts', () => {
  const ranked = rankProfileUrlsForProfessor([
    { url: 'https://uni.edu/cv/jane-smith' },
    { url: 'https://uni.edu/people/jane-smith', nearEmail: true },
    'https://uni.edu/people/jane-smith',
  ], { email: 'jane.smith@uni.edu', name: 'Jane Smith' });
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].url.includes('/people/'));
});

test('mergeProfessorProfileData combines research from multiple pages', () => {
  const merged = mergeProfessorProfileData(
    { research_areas: ['ML'], papers: [] },
    { research_areas: ['NLP'], papers: [{ title: 'Paper A' }] },
  );
  assert.ok(merged.research_areas.includes('ML'));
  assert.ok(merged.research_areas.includes('NLP'));
  assert.equal(merged.papers.length, 1);
});

test('profileDataRichness scores richer profiles higher', () => {
  const rich = profileDataRichness({ name: 'Jane', research_areas: ['A', 'B'], papers: [{ title: 'x' }] });
  const poor = profileDataRichness({ name: 'Jane' });
  assert.ok(rich > poor);
});
