import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpreadsheetRows } from '../src/utils/spreadsheetParser.js';

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
