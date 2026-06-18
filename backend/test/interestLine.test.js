import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInterestLineKeywords } from '../src/utils/interestLine.js';

test('normalizeInterestLineKeywords keeps keywords only', () => {
  assert.equal(
    normalizeInterestLineKeywords('Machine Learning, NLP, Computer Vision.'),
    'Machine Learning, NLP, Computer Vision',
  );
});

test('normalizeInterestLineKeywords strips sentence wrapper', () => {
  assert.equal(
    normalizeInterestLineKeywords('I am particularly interested in your work in ML, NLP, CV.'),
    'ML, NLP, CV',
  );
});
