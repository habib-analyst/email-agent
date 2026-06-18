import { extractAccurateKeywords, keywordsFromProfileOnly, localKeywordExtractor, validateKeywordSet, buildKeywordSourceTexts } from '../ai/index.js';
import { threeAgentResearch } from './threeAgentResearch.js';
import { basicLastNameResearch } from './basicLastNameResearch.js';
import { buildProfessorDossier } from './index.js';
import { capitalizeWord } from '../utils/professor.js';
import { enrichProfessorTitle } from './facultyTitle.js';
import {
  buildDossierFromPastedProfessor,
  hasPastedProfessorData,
} from '../utils/pasteImportParser.js';

export const PROFILE_RESEARCH_STATUS = {
  PROFILE_FOUND: 'profile_found',
  NONE_ON_PAGE: 'none_on_page',
  WEB_COMPLETE: 'web_complete',
};

export function parseResearchAreas(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

function parseProjects(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(p => (typeof p === 'string' ? p : p?.title || '')).filter(Boolean);
  return String(value).split(/[,;|]/).map(s => s.trim()).filter(Boolean);
}

export function hasScrapedProfileResearch(prof, dossier) {
  const areas = parseResearchAreas(dossier?.research_areas).length
    ? parseResearchAreas(dossier.research_areas)
    : parseResearchAreas(prof?.research_areas);
  const papers = dossier?.papers?.length ? dossier.papers : (prof?.papers || []);
  const projects = parseProjects(dossier?.projects).length
    ? parseProjects(dossier.projects)
    : parseProjects(prof?.projects);
  return areas.length >= 1 || papers.length >= 1 || projects.length >= 1;
}

/** Build a complete roster/Excel row from scrape enrichment output. */
export function buildScrapeRosterRow({ prof, dossier, queueState, mode, statusLabel, researchStatus }) {
  const areas = parseResearchAreas(dossier?.research_areas).length
    ? parseResearchAreas(dossier.research_areas)
    : parseResearchAreas(prof?.research_areas);
  const projects = parseProjects(dossier?.projects).length
    ? parseProjects(dossier.projects)
    : parseProjects(prof?.projects);
  const researchParts = [...areas];
  if (projects.length) researchParts.push(...projects.slice(0, 5));
  const fullName = dossier?.name || dossier?.roster?.full_name || prof?.name || '';
  const lastName = capitalizeWord(dossier?.last_name || prof?.last_name || '');
  const titleSource = enrichProfessorTitle({
    ...prof,
    title: dossier?.title || dossier?.roster?.designation || prof?.title || prof?.designation || '',
    designation: dossier?.roster?.designation || prof?.designation || prof?.title || '',
  });
  const resolvedStatus = researchStatus || getProfileResearchStatus(dossier);
  const isBasic = mode === 'basic_instant' || mode === 'basic_scheduled';

  return {
    full_name: fullName,
    last_name: lastName,
    email: prof?.email || dossier?.email || '',
    university: dossier?.university || dossier?.roster?.university || prof?.university || '',
    department: dossier?.department || dossier?.roster?.department || prof?.department || '',
    designation: titleSource.designation || titleSource.title || '',
    faculty_rank: titleSource.faculty_rank || '',
    is_professor_rank: titleSource.is_professor_rank ? 'yes' : 'no',
    phone: prof?.phone || dossier?.phone || dossier?.roster?.phone || '',
    address: prof?.address || dossier?.address || dossier?.roster?.address || '',
    research_interest: dossier?.roster?.research_interest || researchParts.join(', '),
    subject_keyword: isBasic ? (dossier?.subject_keyword || '') : (dossier?.subject_keyword || ''),
    interest_line: isBasic ? '' : (dossier?.interest_line || ''),
    profile_url: dossier?.profile_url || dossier?.roster?.profile_url || prof?.profile_url || prof?.source_url || '',
    email_verified: dossier?.email_verified ? 'yes' : 'no',
    profile_research_status: resolvedStatus,
    research_info: statusLabel || profileResearchStatusLabelForDossier(dossier),
    research_status: resolvedStatus,
    scrape_info: prof?.scrape_trace?.urls_ok != null
      ? `${prof.scrape_trace.urls_ok}/${prof.scrape_trace.urls_tried} profile URLs`
      : (dossier?.scrape_trace?.urls_ok != null ? `${dossier.scrape_trace.urls_ok}/${dossier.scrape_trace.urls_tried} profile URLs` : ''),
    queue_state: queueState === 'needs_web_research' ? 'needs_web_research' : (queueState || 'pending'),
    last_updated: new Date().toISOString(),
  };
}

export function getProfileResearchStatus(dossier) {
  if (!dossier) return PROFILE_RESEARCH_STATUS.NONE_ON_PAGE;
  if (dossier.profile_research_status) return dossier.profile_research_status;
  if (dossier.research_source === 'web_search' || dossier.search_model) {
    return PROFILE_RESEARCH_STATUS.WEB_COMPLETE;
  }
  if (hasScrapedProfileResearch(null, dossier)) {
    return PROFILE_RESEARCH_STATUS.PROFILE_FOUND;
  }
  return PROFILE_RESEARCH_STATUS.NONE_ON_PAGE;
}

export function profileResearchStatusLabel(status) {
  switch (status) {
    case PROFILE_RESEARCH_STATUS.PROFILE_FOUND: return 'From page';
    case PROFILE_RESEARCH_STATUS.WEB_COMPLETE: return 'From web';
    case PROFILE_RESEARCH_STATUS.NONE_ON_PAGE: return 'No info on page';
    default: return '—';
  }
}

export function profileResearchStatusLabelForDossier(dossier) {
  if (dossier?.research_source === 'profile_and_web') return 'Page + web';
  return profileResearchStatusLabel(getProfileResearchStatus(dossier));
}

function mergeScrapeAndWeb(scraped, web) {
  if (!web) return scraped || {};
  return {
    ...web,
    ...scraped,
    name: scraped?.name || web.name,
    last_name: scraped?.last_name || web.last_name,
    profile_url: scraped?.profile_url || web.profile_url,
    research_areas: [...new Set([
      ...parseResearchAreas(scraped?.research_areas),
      ...parseResearchAreas(web?.research_areas),
    ])],
    papers: [...(scraped?.papers || []), ...(web?.papers || [])].slice(0, 20),
    department: scraped?.department || web.department,
    title: scraped?.title || web.title,
    research_evidence: [
      ...(parseResearchAreas(scraped?.research_areas)),
      ...(scraped?.papers || []).map(p => p.title || p),
      ...(parseResearchAreas(web?.research_areas)),
      ...(web?.papers || []).map(p => p.title || p),
    ].filter(Boolean).join('; '),
  };
}

import { normalizeInterestLineKeywords } from '../utils/interestLine.js';

/**
 * Keyword selection decision tree (zero-token when possible):
 *
 * 1. Profile has ≥2 research areas → use area[0] as subject, area[1..3] as interest (0 tokens)
 * 2. Profile has areas + papers → localKeywordExtractor TF-IDF (0 tokens)
 * 3. Profile has projects → use project titles as keywords (0 tokens)
 * 4. Only web-researched dossier → AI extraction (uses tokens, only when user clicked Web Search)
 * 5. Nothing found → return empty, mark needs_web_research
 */
export async function extractKeywordsForDossier(dossier, { allowWebAi = false } = {}) {
  const areas = parseResearchAreas(dossier.research_areas);
  const projects = parseProjects(dossier.projects);
  const ctx = { ...dossier, research_areas: areas, projects };
  const papers = dossier.papers || [];
  const interests = areas.join(', ');

  // Step 1: Direct profile areas (zero tokens — fastest)
  const fromProfile = keywordsFromProfileOnly(ctx);
  if (fromProfile?.subject_keyword && !fromProfile.error) {
    const interestKws = fromProfile.interest_keywords || [];
    return {
      subject_keyword: fromProfile.subject_keyword,
      interest_line: normalizeInterestLineKeywords(interestKws.slice(0, 3).join(', ')),
      keyword_source: fromProfile.source || 'profile_scrape',
    };
  }

  // Step 2: TF-IDF from papers + areas (zero tokens)
  const local = localKeywordExtractor(papers, interests);
  const sourceTexts = buildKeywordSourceTexts(ctx);
  if (
    local?.subject_keyword
    && local.interest_keywords?.length >= 2
    && validateKeywordSet(local.subject_keyword, local.interest_keywords, sourceTexts)
  ) {
    return {
      subject_keyword: local.subject_keyword,
      interest_line: normalizeInterestLineKeywords(local.interest_keywords.slice(0, 3).join(', ')),
      keyword_source: 'profile_local',
    };
  }

  // Step 3: If only projects and 1 area — combine (zero tokens)
  if (areas.length >= 1 && projects.length >= 1) {
    const subject = areas[0];
    const interestPool = [...areas.slice(1), ...projects.slice(0, 3)].filter(Boolean);
    if (interestPool.length >= 2) {
      return {
        subject_keyword: subject,
        interest_line: normalizeInterestLineKeywords(interestPool.slice(0, 3).join(', ')),
        keyword_source: 'profile_projects',
      };
    }
  }

  // Step 4: Only when web search was used (costs tokens)
  if (!allowWebAi && !dossier.web_search_requested) {
    return { subject_keyword: '', interest_line: '', keyword_source: 'none' };
  }

  const kw = await extractAccurateKeywords(ctx, papers, interests, { allowWebAi: true });
  const interestKws = kw.interest_keywords || [];
  return {
    subject_keyword: kw.subject_keyword || '',
    interest_line: normalizeInterestLineKeywords(interestKws.slice(0, 3).join(', ')),
    keyword_source: kw.source || 'unknown',
  };
}

export async function runWebResearchForProfessor(email, sourceUrl, profileUrl, existingDossier = {}) {
  const web = await threeAgentResearch(email, sourceUrl || '', profileUrl || existingDossier.profile_url || '');
  const merged = mergeScrapeAndWeb(existingDossier, web);
  const keywords = await extractKeywordsForDossier(merged, { allowWebAi: true });
  return {
    ...merged,
    ...keywords,
    profile_research_status: PROFILE_RESEARCH_STATUS.WEB_COMPLETE,
    research_source: 'web_search',
    web_search_requested: true,
    email_verified: !!(merged.email_verified || web.email_verified),
    verified: true,
  };
}

function mergeProfileEvidence(dossier, prof) {
  const preAreas = parseResearchAreas(prof.research_areas);
  const preProjects = parseProjects(prof.projects);
  const prePapers = Array.isArray(prof.papers) ? prof.papers : [];
  if (preAreas.length) {
    dossier.research_areas = [...new Set([...preAreas, ...parseResearchAreas(dossier.research_areas)])];
    const src = prof.research_source || prof.source;
    if (['directory_table', 'directory_card', 'directory_dom', 'profile_deep_scrape'].includes(src)) {
      dossier.research_source = src || 'directory_card';
    }
  }
  if (preProjects.length) {
    dossier.projects = [...new Set([...preProjects, ...parseProjects(dossier.projects)])];
  }
  if (prePapers.length) {
    dossier.papers = [...(dossier.papers || []), ...prePapers].slice(0, 20);
  }
  if (prof.phone) dossier.phone = prof.phone;
  if (prof.address) dossier.address = prof.address;
  if (prof.title || prof.designation) dossier.title = prof.title || prof.designation;
  if (prof.faculty_rank) dossier.faculty_rank = prof.faculty_rank;
  if (prof.is_professor_rank != null) dossier.is_professor_rank = prof.is_professor_rank;
  if (prof.profile_url) dossier.profile_url = prof.profile_url;
  if (prof.scrape_trace) dossier.scrape_trace = prof.scrape_trace;
  if (prof.scrape_steps) dossier.scrape_steps = prof.scrape_steps;
  const evidence = [
    ...parseResearchAreas(dossier.research_areas),
    ...parseProjects(dossier.projects),
    ...(dossier.papers || []).map(p => p.title || p),
  ].filter(Boolean);
  if (evidence.length) dossier.research_evidence = evidence.join('; ');
  return dossier;
}

export async function enrichProfessorFromScrape({ prof, sourceUrl, mode = 'instant' }) {
  const preAreas = parseResearchAreas(prof.research_areas);

  let dossier = await buildProfessorDossier(prof);
  dossier = mergeProfileEvidence(dossier, prof);

  const hasPage = hasScrapedProfileResearch(prof, dossier) || preAreas.length >= 1;
  const isBasic = mode === 'basic_instant' || mode === 'basic_scheduled';

  if (hasPage) {
    const keywords = await extractKeywordsForDossier(dossier);
    dossier = {
      ...dossier,
      ...keywords,
      profile_research_status: PROFILE_RESEARCH_STATUS.PROFILE_FOUND,
      keyword_source: keywords.keyword_source,
      verified: true,
      email_verified: dossier.email_verified !== false,
      roster: {
        ...(dossier.roster || {}),
        full_name: dossier.name || prof.name || '',
        last_name: dossier.last_name || prof.last_name || '',
        email: prof.email,
        university: dossier.university || '',
        department: dossier.department || '',
        designation: dossier.title || prof.designation || prof.title || '',
        faculty_rank: prof.faculty_rank || dossier.faculty_rank || '',
        is_professor_rank: prof.is_professor_rank ?? dossier.is_professor_rank ?? false,
        research_interest: [
          ...parseResearchAreas(dossier.research_areas),
          ...parseProjects(dossier.projects).slice(0, 3),
        ].join(', '),
        subject_keyword: keywords.subject_keyword || '',
        interest_line: isBasic ? '' : (keywords.interest_line || ''),
        profile_url: dossier.profile_url || prof.profile_url || prof.source_url || sourceUrl || '',
        email_verified: dossier.email_verified !== false,
      },
    };
    return { dossier, queueState: 'pending', needsWebSearch: false };
  }

  dossier = {
    ...dossier,
    profile_research_status: PROFILE_RESEARCH_STATUS.NONE_ON_PAGE,
    subject_keyword: '',
    interest_line: '',
  };

  if (isBasic) {
    return { dossier, queueState: 'pending', needsWebSearch: false };
  }

  return { dossier, queueState: 'needs_web_research', needsWebSearch: true };
}

export function dossierHasEmailKeywords(dossier) {
  return !!(dossier?.subject_keyword && dossier?.interest_line);
}

function mergePastedProfessorFields(dossier, prof, mode) {
  if (!hasPastedProfessorData(prof)) return dossier;
  const pasted = buildDossierFromPastedProfessor(prof, mode);
  return {
    ...dossier,
    name: dossier?.name || pasted.name,
    last_name: dossier?.last_name || pasted.last_name,
    university: dossier?.university || pasted.university,
    department: dossier?.department || pasted.department,
    research_areas: (dossier?.research_areas?.length ? dossier.research_areas : pasted.research_areas),
    subject_keyword: dossier?.subject_keyword || pasted.subject_keyword,
    interest_line: dossier?.interest_line || pasted.interest_line,
    roster: { ...(pasted.roster || {}), ...(dossier?.roster || {}) },
    roster_import: true,
    research_source: dossier?.research_source || pasted.research_source,
  };
}

/** Email / file import — profile URL scrape when available; web search is user-triggered per row. */
export async function enrichProfessorFromEmailImport({ prof, mode = 'instant' }) {
  const isBasic = mode === 'basic_instant' || mode === 'basic_scheduled';
  const pasted = hasPastedProfessorData(prof);
  const pastedHasKeywords = !!(
    prof?.research_areas?.length
    || prof?.research_interest
    || prof?.interest_line
    || prof?.subject_keyword
  );

  if (isBasic) {
    if (pasted && (prof.name || prof.last_name)) {
      let dossier = buildDossierFromPastedProfessor(prof, mode);
      if (!dossier.last_name && (prof.profile_url || prof.source_url)) {
        const scraped = await basicLastNameResearch(prof.email, prof.source_url || '', prof.profile_url || '');
        dossier = {
          ...dossier,
          last_name: scraped.last_name || dossier.last_name,
          name: scraped.name || dossier.name,
        };
      }
      return { dossier, queueState: 'pending', needsWebSearch: false };
    }
    const dossier = await basicLastNameResearch(prof.email, prof.source_url || '', prof.profile_url || '');
    return { dossier, queueState: 'pending', needsWebSearch: false };
  }

  if (pasted && pastedHasKeywords) {
    let dossier = buildDossierFromPastedProfessor(prof, mode);
    const keywords = await extractKeywordsForDossier(dossier);
    dossier = {
      ...dossier,
      ...keywords,
      subject_keyword: dossier.subject_keyword || keywords.subject_keyword || '',
      interest_line: dossier.interest_line || keywords.interest_line || '',
      profile_research_status: PROFILE_RESEARCH_STATUS.PROFILE_FOUND,
      keyword_source: keywords.keyword_source || 'paste_import',
      verified: true,
    };
    return { dossier, queueState: 'pending', needsWebSearch: false };
  }

  if (prof.profile_url || prof.source_url) {
    try {
      const scraped = await buildProfessorDossier({
        email: prof.email,
        profile_url: prof.profile_url || '',
        source_url: prof.source_url || '',
      });
      if (hasScrapedProfileResearch(prof, scraped)) {
        const keywords = await extractKeywordsForDossier(scraped);
        const dossier = mergePastedProfessorFields({
          ...scraped,
          ...keywords,
          profile_research_status: PROFILE_RESEARCH_STATUS.PROFILE_FOUND,
          keyword_source: keywords.keyword_source,
          verified: true,
        }, prof, mode);
        return { dossier, queueState: 'pending', needsWebSearch: false };
      }
    } catch (e) {
      console.error(`[EmailImport] Profile scrape failed for ${prof.email}:`, e.message);
    }
  }

  const dossier = mergePastedProfessorFields({
    email: prof.email,
    last_name: prof.last_name,
    name: prof.name || '',
    university: prof.university,
    research_areas: prof.research_areas || [],
    papers: [],
    profile_research_status: PROFILE_RESEARCH_STATUS.NONE_ON_PAGE,
    subject_keyword: prof.subject_keyword || '',
    interest_line: prof.interest_line || '',
    verified: false,
    research_source: 'awaiting_web_search',
  }, prof, mode);

  if (pasted && (dossier.name || dossier.last_name) && pastedHasKeywords) {
    return { dossier, queueState: 'pending', needsWebSearch: false };
  }

  return { dossier, queueState: 'needs_web_research', needsWebSearch: true };
}
