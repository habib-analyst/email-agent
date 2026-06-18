// Three-Agent Research System
// Agent 1: deepseek-v3.2 → Web search (primary)
// Agent 2: Gemini → Web search (fallback if deepseek fails)
// Agent 3: Qwen 3.7 models → Scraping and data generation

import { callAI } from '../ai/index.js';
import { NAME_RULES_PROMPT } from '../prompts/nameRules.js';
import { lastNameFromEmail, universityFromEmail, lastNameFromFullName, isValidPersonName, capitalizeWord } from '../utils/professor.js';
import { scrapeVerifiedProfile } from './index.js';

// Name validation for three-agent research — prevents wrong names like "Engineering" or "Liang" for "Li"
function validateAndCorrectName(aiName, email) {
  // If AI name is invalid (title, department, etc.), fall back to email-derived name
  if (!isValidPersonName(aiName)) {
    console.log(`[ThreeAgent] AI returned invalid name '${aiName}' for ${email} — using email-derived fallback`);
    return { name: '', last_name: lastNameFromEmail(email) };
  }

  // Check if AI last_name matches what we'd derive from the full name
  const derivedLastName = lastNameFromFullName(aiName);
  return { name: aiName, last_name: derivedLastName };
}

export async function threeAgentResearch(email, sourceUrl, profileUrl) {
  console.log(`[ThreeAgent] Starting research for ${email}`);

  // ── PHASE 0: If profile URL provided, try direct scrape (more reliable than web search) ──
  if (profileUrl) {
    try {
      console.log(`[ThreeAgent:Phase0] Trying profile scrape: ${profileUrl}`);
      const profileScrape = await scrapeVerifiedProfile(profileUrl, email);
      if (profileScrape && profileScrape.email_verified) {
        // Profile data is verified — use as dossier base, skip AI search
        const validatedName = validateAndCorrectName(profileScrape.name, email);
        const dossier = {
          email,
          name: validatedName.name || profileScrape.name || '',
          last_name: capitalizeWord(validatedName.last_name || profileScrape.last_name || lastNameFromEmail(email)),
          university: profileScrape.university || universityFromEmail(email),
          department: profileScrape.department || '',
          title: profileScrape.title || '',
          research_areas: profileScrape.research_areas || [],
          papers: profileScrape.papers || [],
          profile_url: profileUrl,
          email_verified: true,
          verified: true,
          research_source: 'profile_verified',
          research_attempts: 1,
          roster: {
            full_name: validatedName.name || profileScrape.name || lastNameFromEmail(email),
            email,
            university: profileScrape.university || universityFromEmail(email),
            department: profileScrape.department || '',
            designation: profileScrape.title || '',
            research_interest: (profileScrape.research_areas || []).join(', '),
            profile_url: profileUrl,
            email_verified: 'yes',
          },
        };
        console.log(`[ThreeAgent:Phase0] ✓ Profile verified — skipping AI search`);
        return dossier;
      }
      console.log(`[ThreeAgent:Phase0] Profile not verified — proceeding to AI search`);
    } catch (e) {
      console.error(`[ThreeAgent:Phase0] Profile scrape failed: ${e.message}`);
    }
  }

  // ==================================================================
  // PHASE 1: Web Search - Agent 1 (Qwen API 1 - deepseek-v3.2)
  // ==================================================================
  console.log('[ThreeAgent:Search] Phase 1 - Web search (Qwen API 1)');
  let searchData = null;
  let searchModel = null;
  let searchApiSource = null;

  const searchPrompt = `Search the internet for this professor. Context: The user is seeking MS/PhD positions and needs to identify professors whose research aligns with Computer Science, AI, Machine Learning, Data Science, NLP, Computer Vision, Software Engineering, or related fields.

Email: ${email}
Profile URL: ${profileUrl || 'unknown'}

Find and return:
1. Full name and last name
2. University/institution and department
3. Research areas (list of specific keywords — NOT generic like "Computer Science", use sub-fields)
4. Recent publications (titles and years, last 3-5 years) — pick papers most relevant to CS/AI/ML
5. Profile/faculty page URL
6. Whether this professor actively supervises graduate students

IMPORTANT: Only return research areas and papers that are REAL and verifiable. Do NOT hallucinate paper titles or research topics. If you cannot find specific information, say confidence is "low".

${NAME_RULES_PROMPT}

Return JSON:
{
  "name": "Full Name",
  "last_name": "LastName",
  "university": "Institution Name",
  "department": "Department Name",
  "research_areas": ["area1", "area2", "area3"],
  "papers": [{"title": "Paper Title", "year": 2024}],
  "profile_url": "https://...",
  "accepts_students": true/false,
  "confidence": "high/medium/low"
}`;

  // AGENT 1: deepseek-v3.2 on Qwen API 1 (primary search agent)
  try {
    console.log('[Agent1:Qwen1:deepseek] Starting web search...');
    searchData = await callAI(searchPrompt, 'light', {
      enableWebSearch: true,
      preferDeepseek: true,
      qwenApiSource: 'qwen1'  // Explicitly use Qwen API 1
    });

    searchModel = 'deepseek-v3.2';
    searchApiSource = 'qwen1';
    console.log('[Agent1:Qwen1:deepseek] ✓ Search successful:', {
      name: searchData.name,
      research_areas: searchData.research_areas?.length,
      papers: searchData.papers?.length,
      api: 'qwen1'
    });
  } catch (e) {
    console.error('[Agent1:Qwen1:deepseek] Search failed:', e.message);

    // Fallback to Gemini web search
    try {
      console.log('[Agent1:Gemini] Fallback search...');
      searchData = await callAI(searchPrompt, 'light', {
        enableWebSearch: true,
        preferGemini: true
      });

      searchModel = 'gemini';
      searchApiSource = 'gemini';
      console.log('[Agent1:Gemini] ✓ Search successful:', {
        name: searchData.name,
        research_areas: searchData.research_areas?.length,
        api: 'gemini'
      });
    } catch (e2) {
      console.error('[Agent1:Gemini] Search also failed:', e2.message);
      searchData = null;
      searchModel = 'none';
      searchApiSource = 'none';
    }
  }

  // ==================================================================
  // PHASE 2: Qwen 3.7 Agent - Scraping & Data Generation (Qwen API 2)
  // ==================================================================
  console.log('[ThreeAgent:Qwen3.7] Phase 2 - Scraping and generation (Qwen API 2)');
  let qwenData = null;
  let processingApiSource = null;

  if (searchData && searchData.confidence !== 'low') {
    try {
      const qwenPrompt = `Process and generate professor profile from search data:

Search Results (from ${searchModel}@${searchApiSource}):
${JSON.stringify(searchData, null, 2)}

Professor Email: ${email}
Profile URL: ${profileUrl || searchData.profile_url || 'unknown'}

Tasks:
1. Extract and clean professor information
2. Verify data consistency with email domain
3. Generate structured dossier
4. Categorize research areas into top 1-3 main keywords
5. Format publications list (most recent and relevant)
6. Assess data quality and email verification status

${NAME_RULES_PROMPT}

Return JSON:
{
  "name": "Full Name",
  "last_name": "LastName",
  "university": "Institution",
  "department": "Department",
  "research_areas": ["area1", "area2"],
  "papers": [{"title": "...", "year": 2024}],
  "profile_url": "https://...",
  "data_quality": "excellent/good/fair/poor",
  "email_verified": true/false,
  "title": "Professor/Associate Professor/etc"
}`;

      // AGENT 2: Qwen 3.7 models on Qwen API 2 (processing agent)
      console.log('[Agent2:Qwen2:qwen3.7] Starting data processing...');
      qwenData = await callAI(qwenPrompt, 'heavy', {
        preferQwen: true,
        qwenApiSource: 'qwen2'  // Explicitly use Qwen API 2
      });

      processingApiSource = 'qwen2';
      console.log('[Agent2:Qwen2:qwen3.7] ✓ Generated data:', {
        name: qwenData.name,
        research_areas: qwenData.research_areas?.length,
        quality: qwenData.data_quality,
        api: 'qwen2'
      });
    } catch (e) {
      console.error('[Agent2:Qwen2:qwen3.7] Processing failed:', e.message);
      processingApiSource = 'failed';

      // Use raw search data if Qwen processing fails
      qwenData = {
        name: searchData.name || '',
        last_name: searchData.last_name || lastNameFromEmail(email),
        university: searchData.university || universityFromEmail(email),
        department: searchData.department || '',
        research_areas: searchData.research_areas?.slice(0, 3) || [],
        papers: searchData.papers || [],
        profile_url: searchData.profile_url || profileUrl || '',
        data_quality: 'fair',
        email_verified: false,
        title: ''
      };
    }
  } else {
    // No search data - minimal fallback
    console.log('[ThreeAgent] No search data available, using minimal fallback');
    qwenData = {
      name: '',
      last_name: lastNameFromEmail(email),
      university: universityFromEmail(email),
      department: '',
      research_areas: [],
      papers: [],
      profile_url: profileUrl || '',
      data_quality: 'poor',
      email_verified: false,
      title: ''
    };
  }

  // ==================================================================
  // PHASE 3: Build Final Dossier with name validation
  // ==================================================================
  const validatedName = validateAndCorrectName(qwenData.name || searchData?.name, email);

  const dossier = {
    email,
    name: validatedName.name || qwenData.name || searchData?.name || '',
    last_name: capitalizeWord(validatedName.last_name || qwenData.last_name || searchData?.last_name || lastNameFromEmail(email)),
    university: qwenData.university || universityFromEmail(email),
    department: qwenData.department || '',
    title: qwenData.title || '',
    research_areas: qwenData.research_areas || [],
    papers: qwenData.papers || [],
    profile_url: qwenData.profile_url || profileUrl || '',
    email_verified: qwenData.email_verified || false,
    verified: qwenData.data_quality === 'excellent' || qwenData.data_quality === 'good',
    research_source: 'three_agent',
    search_model: searchModel,
    search_api: searchApiSource,  // Track which API Agent 1 used
    processing_model: qwenData.__model || 'qwen3.7',
    processing_api: processingApiSource,
    research_attempts: 1,
    research_evidence: [
      ...(qwenData.research_areas || searchData?.research_areas || []),
      ...(qwenData.papers || searchData?.papers || []).map(p => p.title || p),
    ].filter(Boolean).join('; '),
    roster: {
      full_name: qwenData.name || lastNameFromEmail(email),
      email,
      university: qwenData.university || universityFromEmail(email),
      department: qwenData.department || '',
      designation: qwenData.title || '',
      research_interest: (qwenData.research_areas || []).join(', '),
      profile_url: qwenData.profile_url || profileUrl || '',
      email_verified: qwenData.email_verified ? 'yes' : 'no'
    }
  };

  console.log(`[ThreeAgent] ✓ Complete for ${email}:`, {
    agent1_search: `${searchModel}@${searchApiSource}`,
    agent2_process: `${dossier.processing_model}@${processingApiSource}`,
    verified: dossier.verified,
    research_areas: dossier.research_areas.length,
    papers: dossier.papers.length
  });

  return dossier;
}
