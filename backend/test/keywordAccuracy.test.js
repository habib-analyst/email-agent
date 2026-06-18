import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isGenericKeyword,
  selectVerifiedProfessorKeywords,
  validateKeywordSet,
  keywordsFromProfileOnly,
  buildKeywordSourceTexts,
  hasRosterUploadedKeywords,
} from '../src/ai/index.js';

describe('keyword accuracy', () => {
  it('rejects generic keywords', () => {
    assert.equal(isGenericKeyword('Research'), true);
    assert.equal(isGenericKeyword('Machine Learning'), false);
    assert.equal(isGenericKeyword('Computer Vision'), false);
  });

  it('picks only professor research areas as keywords', () => {
    const dossier = {
      research_areas: ['Distributed Systems', 'Cloud Computing', 'Edge Computing'],
      papers: [],
    };
    const kw = selectVerifiedProfessorKeywords(dossier);
    assert.equal(kw.subject_keyword, 'Distributed Systems');
    assert.deepEqual(kw.interest_keywords.slice(0, 2), ['Cloud Computing', 'Edge Computing']);
    assert.equal(kw.validated, true);
  });

  it('rejects keywords not present in professor source text', () => {
    const dossier = {
      research_areas: ['Robotics'],
      papers: [{ title: 'Motion Planning for Autonomous Robots' }],
    };
    const sourceTexts = buildKeywordSourceTexts(dossier);
    assert.equal(validateKeywordSet('Robotics', ['Quantum Computing', 'Cryptography'], sourceTexts), false);
    assert.equal(validateKeywordSet('Robotics', ['Motion Planning', 'Autonomous Robots'], sourceTexts), true);
  });

  it('never returns invented generic fallback keywords', () => {
    const kw = keywordsFromProfileOnly({ research_areas: [], papers: [] });
    assert.equal(kw, null);
  });

  it('extracts grounded keywords from paper titles', () => {
    const dossier = {
      research_areas: ['Speech Recognition'],
      papers: [
        { title: 'End-to-End Speech Recognition with Transformers' },
        { title: 'Neural Machine Translation for Low Resource Languages' },
        { title: 'Automatic Speech Recognition Benchmarks' },
      ],
    };
    const kw = selectVerifiedProfessorKeywords(dossier);
    assert.ok(kw.subject_keyword);
    assert.ok(kw.interest_keywords?.length >= 2);
    assert.equal(kw.validated, true);
    assert.equal(isGenericKeyword(kw.subject_keyword), false);
  });

  it('trusts roster-uploaded keywords without scrape validation', () => {
    const dossier = {
      research_source: 'roster',
      subject_keyword: 'Cybersecurity',
      interest_line: 'Network Security, Cryptography, Privacy',
      research_areas: ['Network Security', 'Cryptography', 'Privacy'],
    };
    assert.equal(hasRosterUploadedKeywords(dossier), true);
    const sourceTexts = buildKeywordSourceTexts(dossier);
    assert.equal(validateKeywordSet('Cybersecurity', ['Network Security', 'Cryptography', 'Privacy'], sourceTexts), true);
  });
});
