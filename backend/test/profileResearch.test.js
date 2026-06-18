import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasScrapedProfileResearch,
  getProfileResearchStatus,
  buildScrapeRosterRow,
  PROFILE_RESEARCH_STATUS,
} from '../src/research/profileResearch.js';
import { keywordsFromProfileOnly } from '../src/ai/index.js';

describe('profileResearch', () => {
  it('treats one paper as scraped research', () => {
    const prof = { research_areas: [] };
    const dossier = { papers: [{ title: 'Deep Learning for Robotics' }] };
    assert.equal(hasScrapedProfileResearch(prof, dossier), true);
  });

  it('marks none_on_page when empty', () => {
    assert.equal(getProfileResearchStatus({ research_areas: [], papers: [] }), PROFILE_RESEARCH_STATUS.NONE_ON_PAGE);
  });

  it('extracts keywords from profile without AI', () => {
    const kw = keywordsFromProfileOnly({
      research_areas: ['Machine Learning', 'Computer Vision', 'NLP'],
      papers: [],
    });
    assert.ok(kw?.subject_keyword);
    assert.ok(kw.interest_keywords?.length >= 2);
    assert.equal(kw.source, 'profile_scrape');
  });

  it('treats one research area as scraped research', () => {
    assert.equal(hasScrapedProfileResearch(null, { research_areas: ['Robotics'], papers: [] }), true);
  });

  it('treats projects as scraped research', () => {
    assert.equal(hasScrapedProfileResearch(null, { research_areas: [], papers: [], projects: ['Autonomous Driving'] }), true);
  });

  it('buildScrapeRosterRow fills excel columns from dossier', () => {
    const row = buildScrapeRosterRow({
      prof: { email: 'a@uni.edu', name: 'Jane Doe', department: 'CS' },
      dossier: {
        name: 'Jane Doe',
        last_name: 'Doe',
        university: 'Uni',
        department: 'Computer Science',
        title: 'Professor',
        research_areas: ['Machine Learning', 'NLP'],
        projects: ['Robot Learning'],
        subject_keyword: 'Machine Learning',
        interest_line: 'NLP, Deep Learning, Vision',
        profile_url: 'https://uni.edu/jane',
        email_verified: true,
        profile_research_status: PROFILE_RESEARCH_STATUS.PROFILE_FOUND,
      },
      queueState: 'pending',
      mode: 'instant',
    });
    assert.equal(row.full_name, 'Jane Doe');
    assert.equal(row.last_name, 'Doe');
    assert.equal(row.department, 'Computer Science');
    assert.equal(row.designation, 'Professor');
    assert.ok(row.research_interest.includes('Machine Learning'));
    assert.ok(row.research_interest.includes('Robot Learning'));
    assert.equal(row.subject_keyword, 'Machine Learning');
    assert.equal(row.interest_line, 'NLP, Deep Learning, Vision');
    assert.equal(row.queue_state, 'pending');
  });
});
