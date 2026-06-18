import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { isLikelySingleProfileUrl, countFacultyMailtosOnPage } from '../src/research/pageContent.js';
import { extractFacultyFromMailtoCards } from '../src/research/directoryInterests.js';

const MST_URL = 'https://cs.mst.edu/people/faculty-directory/';

const MST_SNIPPET = `
<div>
  <a href="mailto:csdept@mst.edu">csdept@mst.edu</a>
  <h3>Joint Appointment Faculty</h3>
  <div class="faculty-card"><h5>Dr. Seung-Jong Jay Park</h5><p>Area of Interest: Big Data, Deep Learning</p><a href="mailto:seung-jong.park@mst.edu">email</a></div>
  <div class="faculty-card"><h5>Dr. Sajal K. Das</h5><a href="mailto:sdas@mst.edu">email</a></div>
  <div class="faculty-card"><h5>Dr. Avah Banerjee</h5><a href="mailto:banerjeeav@mst.edu">email</a></div>
</div>`;

test('MST faculty-directory URL is not treated as single profile', () => {
  assert.equal(isLikelySingleProfileUrl(MST_URL), false);
});

test('MST directory snippet yields multiple professors not department email', () => {
  const $ = cheerio.load(MST_SNIPPET);
  const isValid = e => e.endsWith('@mst.edu') && !e.startsWith('csdept');
  assert.ok(countFacultyMailtosOnPage($, isValid) >= 3);
  const rows = extractFacultyFromMailtoCards($, { isValidEmail: isValid, seenEmails: new Set() });
  assert.equal(rows.length, 3);
  assert.ok(rows.every(r => r.name && !/joint appointment/i.test(r.name)));
});
