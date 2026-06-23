import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entriesToNormalizedSheet, parseSpreadsheetRows } from '../src/utils/spreadsheetParser.js';

test('parseSpreadsheetRows maps Interest Line Keywords column', () => {
  const rows = [
    ['Full Name', 'Last Name', 'Email', 'Subject Keyword', 'Interest Line Keywords'],
    ['Jane Doe', 'Doe', 'jane@university.edu', 'Cybersecurity', 'Network Security, Cryptography, Privacy'],
  ];
  const { entries } = parseSpreadsheetRows(rows);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].subject_keyword, 'Cybersecurity');
  assert.equal(entries[0].interest_line, 'Network Security, Cryptography, Privacy');
});

test('parseSpreadsheetRows preserves University in imports and organized preview', () => {
  const rows = [
    ['Full Name', 'Last Name', 'Email', 'University', 'Subject Keyword', 'Interest Line'],
    ['Ada Example', 'Example', 'ada@ethz.ch', 'ETH Zurich', 'Machine Learning', 'Vision, Robotics, AI'],
  ];
  const { entries } = parseSpreadsheetRows(rows);
  assert.equal(entries[0].university, 'ETH Zurich');
  assert.equal(entries[0].university_source, 'roster');
  const sheet = entriesToNormalizedSheet(entries);
  const universityIndex = sheet.headers.indexOf('University');
  assert.ok(universityIndex >= 0);
  assert.equal(sheet.rows[0][universityIndex], 'ETH Zurich');
});
