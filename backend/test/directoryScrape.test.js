import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import {
  extractFacultyFromMailtoCards,
  extractFacultyFromDomContainers,
  extractLabeledFieldsFromContainer,
  extractAreaOfInterestFromNode,
  hasDirectoryInterestPanels,
  parseInterestKeywordList,
} from '../src/research/directoryInterests.js';

const SAMPLE_GRID_HTML = `
<div class="faculty-directory">
  <div class="row">
    <div class="col-md-6 faculty-card">
      <h3><a href="/people/jane-doe">Jane Doe</a></h3>
      <p><strong>Title:</strong> Associate Professor</p>
      <p><strong>Department:</strong> Computer Science</p>
      <p><strong>Phone:</strong> (555) 123-4567</p>
      <p><strong>Address:</strong> Room 101, CS Building</p>
      <p><strong>Area of Interest:</strong> Machine Learning, Computer Vision, Robotics</p>
      <a href="mailto:jane.doe@university.edu">jane.doe@university.edu</a>
    </div>
    <div class="col-md-6 faculty-card">
      <h3><a href="/people/john-smith">John Smith</a></h3>
      <p><strong>Department:</strong> Electrical Engineering</p>
      <details>
        <summary>Area of Interest</summary>
        <ul><li>Signal Processing</li><li>Wireless Networks</li><li>IoT</li></ul>
      </details>
      <a href="mailto:john.smith@university.edu">Email</a>
    </div>
  </div>
  <div class="row">
    <div class="col-md-6 faculty-card">
      <h3>Alice Chen</h3>
      <p>Professor of Biology</p>
      <label>Research Interests:</label> Genomics, CRISPR, Bioinformatics
      <a href="mailto:alice.chen@university.edu">alice.chen@university.edu</a>
    </div>
  </div>
</div>
`;

describe('directoryInterests card scraping', () => {
  it('extracts all professors from 2-column card grid', () => {
    const $ = cheerio.load(SAMPLE_GRID_HTML);
    const seen = new Set();
    const rows = extractFacultyFromMailtoCards($, {
      isValidEmail: e => e.endsWith('@university.edu'),
      seenEmails: seen,
      baseUrl: 'https://university.edu/faculty',
    });
    assert.equal(rows.length, 3);
    const jane = rows.find(r => r.email === 'jane.doe@university.edu');
    assert.ok(jane);
    assert.equal(jane.name, 'Jane Doe');
    assert.equal(jane.department, 'Computer Science');
    assert.ok(jane.phone.includes('555'));
    assert.ok(jane.address.includes('Room 101'));
    assert.ok(jane.research_areas.includes('Machine Learning'));
    assert.ok(jane.profileUrl.includes('/people/jane-doe'));
  });

  it('extracts interests from details/list blocks', () => {
    const $ = cheerio.load(SAMPLE_GRID_HTML);
    const seen = new Set();
    const rows = extractFacultyFromMailtoCards($, {
      isValidEmail: e => e.endsWith('@university.edu'),
      seenEmails: seen,
    });
    const john = rows.find(r => r.email === 'john.smith@university.edu');
    assert.ok(john);
    assert.ok(john.research_areas.some(a => /signal/i.test(a)));
  });

  it('detects collapsed interest panels', () => {
    const $ = cheerio.load(`
      <div><button aria-expanded="false">View Research Interests</button></div>
      <div><button aria-expanded="false">Area of Interest</button></div>
    `);
    assert.equal(hasDirectoryInterestPanels($), true);
  });

  it('parses comma-separated interest keywords', () => {
    const kws = parseInterestKeywordList('Machine Learning, NLP, and Computer Vision');
    assert.ok(kws.includes('Machine Learning'));
    assert.ok(kws.includes('NLP'));
    assert.ok(kws.includes('Computer Vision'));
  });

  it('extractAreaOfInterestFromNode reads labeled paragraph', () => {
    const $ = cheerio.load('<div><strong>Area of Interest:</strong> Deep Learning, NLP</div>');
    const areas = extractAreaOfInterestFromNode($, $('div'));
    assert.ok(areas.some(a => /deep learning/i.test(a)));
  });

  it('extracts Missouri S&T style faculty directory cards', () => {
    const MST_HTML = `
    <div class="faculty-directory">
      <h3>Joint Appointment Faculty</h3>
      <div class="faculty-card">
        <h5>Dr. Seung-Jong Jay Park</h5>
        <p>Kummer Endowed Chair of Computer Science</p>
        <p>Area of Interest: Big Data, Deep Learning, Cyberinfrastructure</p>
        <a href="mailto:seung-jong.park@mst.edu">seung-jong.park@mst.edu</a>
      </div>
      <div class="faculty-card">
        <h5>Dr. Sajal K. Das</h5>
        <p>Curators' Distinguished Professor</p>
        <p>Research Interests: Cyber-Physical Systems, IoT, Big Data Analytics</p>
        <a href="mailto:sdas@mst.edu">sdas@mst.edu</a>
      </div>
      <div class="faculty-card">
        <h5>Dr. Avah Banerjee</h5>
        <p>Assistant Professor</p>
        <a href="mailto:banerjeeav@mst.edu">banerjeeav@mst.edu</a>
      </div>
      <footer><a href="mailto:csdept@mst.edu">csdept@mst.edu</a></footer>
    </div>`;
    const $ = cheerio.load(MST_HTML);
    const seen = new Set();
    const isValid = e => e.endsWith('@mst.edu') && !e.startsWith('csdept');
    const rows = extractFacultyFromMailtoCards($, {
      isValidEmail: isValid,
      seenEmails: seen,
      baseUrl: 'https://cs.mst.edu/people/faculty-directory/',
    });
    assert.equal(rows.length, 3);
    const park = rows.find(r => r.email === 'seung-jong.park@mst.edu');
    assert.ok(park);
    assert.match(park.name, /Seung-Jong Jay Park/i);
    assert.ok(park.research_areas.some(a => /Big Data/i.test(a)));
    assert.ok(!rows.some(r => r.email === 'csdept@mst.edu'));
  });

  it('walks DOM container like F12 Elements — labeled fields per professor div', () => {
    const $ = cheerio.load(SAMPLE_GRID_HTML);
    const seen = new Set();
    const rows = extractFacultyFromDomContainers($, {
      isValidEmail: e => e.endsWith('@university.edu'),
      seenEmails: seen,
      baseUrl: 'https://university.edu/faculty',
    });
    assert.equal(rows.length, 3);
    const jane = rows.find(r => r.email === 'jane.doe@university.edu');
    assert.ok(jane);
    assert.equal(jane.source, 'directory_dom');
    assert.ok(jane.dom_fields);
    assert.equal(jane.department, 'Computer Science');
    assert.ok(jane.research_areas.includes('Machine Learning'));

    const fields = extractLabeledFieldsFromContainer($, $('.faculty-card').first());
    assert.equal(fields.department, 'Computer Science');
    assert.ok(fields.phone.includes('555'));
  });
});
