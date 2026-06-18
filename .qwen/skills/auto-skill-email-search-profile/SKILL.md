---
name: email-search-profile
description: Find a professor's .edu profile page using only their email address — Google search anchored on email, extract .edu URLs, scrape and verify against original email
source: auto-skill
extracted_at: '2026-06-13T22:33:26.285Z'
---

# Email-Based Profile Search

When scraping provided URLs fails to yield verified professor data (no profile page, wrong person, or email not found on page), use the professor's **email address itself** as the primary search anchor to find their official .edu profile.

## Why This Works

- An email address like `gchen@nju.edu.cn` is far more specific than a name search — it uniquely identifies one person at one institution
- Google indexes .edu faculty profile pages, and these pages almost always contain the professor's email
- Searching by email eliminates homonymous confusion (multiple "John Smith" professors)

## The Two-Attempt Strategy

**Attempt 1 — Exact email search** (most specific):
```
Query: "gchen@nju.edu.cn" faculty profile
```
The quoted email forces Google to find pages containing that exact address. The "faculty profile" terms bias results toward official profile pages rather than PDFs, syllabi, or news articles.

**Attempt 2 — Broader search** (when exact email returns nothing):
```
Query: gchen Nanjing University professor
```
Use the email local part + university name derived from the email domain. This catches profile pages that don't list the full email address but do mention the professor by name and institution.

## Extracting Candidate URLs from Search Results

Search results are text snippets — extract URLs using regex, not DOM parsing:

```js
const eduUrlRegex = /https?:\/\/[a-zA-Z0-9][\w.-]*\.edu(?:\.[a-z]{2,6})?[\w\/.-]*\/?/gi;
const eduUrls = searchResults.match(eduUrlRegex) || [];
```

Note the `(?:\.[a-z]{2,6})?` suffix — many international universities use `.edu.cn`, `.edu.au`, `.ac.uk` etc. A simple `.edu` regex misses these.

## Filtering for Profile-Like Paths

Not all .edu URLs are profile pages. Admissions pages, course catalogs, and department homepages also appear in search results. Filter by path pattern:

```js
const PROFILE_PATH_PATTERN = /\/(faculty|people|staff|professor|directory|profile|person|bios|members|team|academic|researchers|~)[\/]/i;
const filtered = eduUrls.filter(u => PROFILE_PATH_PATTERN.test(u) || u.includes('~'));
```

The `~` pattern catches Unix-style home pages (`/~gchen/`) which are common at older universities.

**Priority**: Try filtered URLs first (up to 2). If no filtered URLs exist, fall back to any .edu URL (up to 2). Never try more than 2 URLs per search attempt — this keeps latency reasonable.

## Scraping and Verification

For each candidate URL, scrape the page and verify the professor's email appears on it:

```js
const profile = await scrapeVerifiedProfile(candidateUrl, professorEmail);
if (profile?.email_verified) {
  // Confirmed: the page contains this exact professor's email
  return { profileUrl: candidateUrl, profile };
}
if (profile?.name) {
  // Found a name but email not explicitly on page — keep as candidate
  // (many profiles list name but require contact pages for email)
  return { profileUrl: candidateUrl, profile };
}
```

**Email verification is the ground truth**. If the scraped page contains the exact professor email (case-insensitive match), this is definitively the right person. If only a name matches, it's a probable match but not confirmed.

## Integration Point

Insert this search after the primary URL scraping loop fails:

```js
// Step 1: Try provided URLs (profileUrl, sourceUrl)
for (const url of urls) {
  const profile = await scrapeVerifiedProfile(url, email);
  if (profile) { mergeIntoDossier(dossier, profile); break; }
}

// Step 2: Fallback — search by email if no verified data from provided URLs
if (!dossier.email_verified && attempt <= 2) {
  const searchResult = await searchProfileByEmail(email);
  if (searchResult?.profile) {
    mergeIntoDossier(dossier, searchResult.profile);
    dossier.research_source = 'email_search';
  }
}
```

Only trigger email search on attempts 1-2. On attempt 3+, the AI enrichment is the final fallback — adding web search would slow the already-lengthy retry cycle.

### Profile-First Integration (threeAgentResearch Phase 0)

When a `profileUrl` is available (from `scrapeFacultyPage` Step 10 deep scraping), `threeAgentResearch` now tries `scrapeVerifiedProfile(profileUrl, email)` BEFORE doing AI web search. If the profile returns `email_verified=true`, the research returns early with `research_source: 'profile_verified'` — skipping 2-3 AI calls entirely. This is more reliable and faster than email-based web search.

## Source Tracking

Tag the dossier with `research_source: 'email_search'` so downstream systems know this data came from web search rather than direct scraping. This affects confidence scoring — email-search data is verified but may be less complete than a directly scraped profile.

## Counter Patterns (Don't Do This)

```js
// Searching by name only — homonymous confusion
const query = `Professor ${dossier.name} ${dossier.university}`;
// "John Smith MIT" → could be any of 5 John Smiths at MIT

// Not quoting the email — Google treats it as separate tokens
const query = `${email} faculty profile`;
// Google may match pages with "gchen" and "nju.edu.cn" separately

// Scraping every .edu URL from search results
for (const url of allEduUrls) { ... }
// Too slow — some results are irrelevant (course pages, press releases)

// Skipping email verification on scraped profile
if (profile.name === dossier.name) { accept(); }
// Name-only matching on a search result page is unreliable — 
// the search was by email, verify by email
```

## When to Use

Any system that:
- Has a person's email address but not their profile URL
- Needs to find official academic/professional profile pages
- Already tried direct URL scraping and got no verified data
- Has a web search capability (Google scrape, Bing API, or AI with search tool)
