import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRawEmailImportText,
  professorFromImportEntry,
  professorsFromRawImportInput,
  buildDossierFromPastedProfessor,
} from '../src/utils/pasteImportParser.js';

test('parseRawEmailImportText extracts name, email, and keywords from one line', () => {
  const entries = parseRawEmailImportText(
    'Dr. Jane Smith, jsmith@mit.edu, Machine Learning, NLP, Computer Vision',
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].email, 'jsmith@mit.edu');
  assert.match(entries[0].full_name, /Jane Smith/i);
  assert.match(entries[0].research_interest, /Machine Learning/i);
});

test('professorFromImportEntry derives last name from full name', () => {
  const prof = professorFromImportEntry({
    email: 'wzhang@stanford.edu',
    full_name: 'Prof. Wei Zhang',
    research_interest: 'Distributed Systems, Cloud Computing, Big Data',
  });
  assert.equal(prof.email, 'wzhang@stanford.edu');
  assert.equal(prof.last_name, 'Zhang');
  assert.equal(prof.name, 'Prof. Wei Zhang');
  assert.ok(prof.research_areas.length >= 2);
});

test('professorsFromRawImportInput handles multiline paste', () => {
  const profs = professorsFromRawImportInput(
    'Alice Johnson, aj@berkeley.edu, Robotics, AI\nBob Lee | ble@cmu.edu | Systems, Networks',
  );
  assert.equal(profs.length, 2);
  assert.equal(profs[0].last_name, 'Johnson');
  assert.equal(profs[1].last_name, 'Lee');
});

test('buildDossierFromPastedProfessor fills interest keywords for instant mode', () => {
  const dossier = buildDossierFromPastedProfessor({
    email: 'test@mit.edu',
    name: 'John Koller',
    last_name: 'Koller',
    research_areas: ['Machine Learning', 'Computer Vision', 'NLP'],
  }, 'instant');
  assert.equal(dossier.last_name, 'Koller');
  assert.ok(dossier.subject_keyword);
  assert.ok(dossier.interest_line);
});
