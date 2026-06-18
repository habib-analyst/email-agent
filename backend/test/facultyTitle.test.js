import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFacultyTitle,
  extractTitleFromText,
  enrichProfessorTitle,
  isProfessorRankTitle,
} from '../src/research/facultyTitle.js';

test('classifyFacultyTitle detects assistant and associate professor', () => {
  assert.equal(classifyFacultyTitle('Assistant Professor of CS').rank, 'assistant_professor');
  assert.equal(classifyFacultyTitle('Assistant Professor of CS').isProfessorRank, true);
  assert.equal(classifyFacultyTitle('Associate Professor').rank, 'associate_professor');
  assert.equal(classifyFacultyTitle('Associate Professor').isProfessorRank, true);
});

test('classifyFacultyTitle detects plain professor', () => {
  const c = classifyFacultyTitle('Professor of Electrical Engineering');
  assert.equal(c.rank, 'professor');
  assert.equal(c.isProfessorRank, true);
  assert.match(c.designation, /Professor/i);
});

test('classifyFacultyTitle excludes lecturer', () => {
  const c = classifyFacultyTitle('Senior Lecturer');
  assert.equal(c.rank, 'lecturer');
  assert.equal(c.isProfessorRank, false);
});

test('extractTitleFromText pulls title from card blurbs', () => {
  const text = 'Jane Doe Assistant Professor of Computer Science Area of Interest: ML';
  assert.match(extractTitleFromText(text), /Assistant Professor/i);
});

test('enrichProfessorTitle tags professor rank for Excel', () => {
  const prof = enrichProfessorTitle({
    email: 'j@uni.edu',
    name: 'Jane Doe',
    _cardText: 'Jane Doe Associate Professor Department of CS',
  });
  assert.equal(prof.is_professor_rank, true);
  assert.equal(prof.faculty_rank, 'associate_professor');
  assert.match(prof.designation, /Associate Professor/i);
});

test('isProfessorRankTitle', () => {
  assert.equal(isProfessorRankTitle('Adjunct Professor'), true);
  assert.equal(isProfessorRankTitle('Lecturer'), false);
});
