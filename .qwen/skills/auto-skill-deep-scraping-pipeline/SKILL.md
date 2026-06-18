---
name: deep-scraping-pipeline
description: Faculty page scraping with deep pagination (infinite scroll, Load More, next/back pages), email deobfuscation, always-visit profile links for detailed data, and profile-first research that skips AI search when profile verified
source: auto-skill
extracted_at: '2026-06-14T21:26:42.935Z'
---

# Deep Scraping Pipeline — Pagination, Deobfuscation, Profile-First Research

Faculty listing pages come in many formats: paginated with next/back buttons, infinite scroll, "Load More" buttons, or single pages. Professors may have profile links that contain detailed data (research areas, department, papers). Emails are often obfuscated. This skill covers the complete pipeline from discovering professors on a faculty page to getting their verified data.

## 1. Deep Pagination — Handle All Types

### Infinite Scroll (Puppeteer)
Scroll to bottom repeatedly until no new content appears (page height doesn't change). Up to 10 rounds with 800ms delay:

```js
let prevHeight = 0, scrollRounds = 0, MAX_SCROLL_ROUNDS = 10;
while (scrollRounds < MAX_SCROLL_ROUNDS) {
  const currentHeight = await page.evaluate(() => document.body.scrollHeight);
  if (currentHeight === prevHeight) break;  // No new content
  prevHeight = currentHeight;
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise(r => setTimeout(r, 800));
  scrollRounds++;
}
```

### Load More Buttons (Puppeteer)
Click "Load More" / "Show All" buttons recursively — up to 5 clicks per selector, check `isVisible()` before clicking:

```js
const loadMoreSelectors = [
  'button[class*="more"]', 'a[href*="more"]',
  '[class*="load-more"]', '[class*="show-all"]',
  '[class*="view-all"]', '[class*="expand"]',
];
for (const sel of loadMoreSelectors) {
  let clickCount = 0;
  while (clickCount < 5) {
    const btn = await page.$(sel);
    if (!btn) break;
    const isVisible = await btn.isVisible();
    if (!isVisible) break;
    await btn.click();
    await new Promise(r => setTimeout(r, 1000));
    clickCount++;
  }
}
```

### Next/Back Pagination Pages (Puppeteer)
`fetchPaginatedPagesWithBrowser(baseUrl)` navigates through paginated pages (up to 10), detecting next-page links on each rendered page. Returns array of HTML strings:

```js
// Detect next-page link on rendered page
const nextUrl = await page.evaluate((curPage) => {
  const selectors = ['a[rel="next"]', 'a.next', '.pagination .next a', '.next-page a', 'li.next a', 'li.active + li a'];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.href?.startsWith('http')) return el.href;
  }
  // Fallback: numbered page links where text = curPage + 1
  const pageLinks = document.querySelectorAll('a[href*="page="], a[href*="/page/"]');
  for (const link of pageLinks) {
    if (/^\d+$/.test(link.textContent.trim()) && parseInt(text) === curPage + 1) return link.href;
  }
  return null;
}, pageCount);
```

Track `visitedUrls` Set to avoid infinite loops. Use 300ms polite delay between pages.

### Static Pagination (Cheerio)
After Puppeteer rendering, also run `findPaginationLinks($, url)` on the rendered HTML (not just static). Merge emails from all sources using a Set for deduplication.

## 2. Email Deobfuscation

Many university sites obfuscate professor emails to prevent spam bots. The `deobfuscateEmails()` function replaces common patterns with `@` before regex matching:

```js
export function deobfuscateEmails(text) {
  return text
    .replace(/\[at\]/gi, '@')   // john[at]university.edu
    .replace(/\(at\)/gi, '@')   // john(at)university.edu
    .replace(/\/at\//gi, '@')   // john/at/university.edu
    .replace(/\{at\}/gi, '@')   // john{at}university.edu
    .replace(/<at>/gi, '@')     // john<at>university.edu
    .replace(/\s+at\s+/gi, '@') // john at university.edu
    .replace(/\(a\)/gi, '@')    // john(a)university.edu
    .replace(/_at_/gi, '@')     // john_at_university.edu
    .replace(/%40/gi, '@')      // john%40university.edu (URL encoding)
    .replace(/&#64;/g, '@')     // john&#64;university.edu (HTML entity)
    .replace(/&#x40;/g, '@');   // john&#x40;university.edu (hex entity)
}
```

Apply deobfuscation to per-element text AND raw HTML before running EMAIL_REGEX.

### Additional Extraction Strategies

- **data-email attributes**: Some sites store emails in `data-email` attributes with base64 or reversed encoding. Try `Buffer.from(dataEmail, 'base64')` and `.split('').reverse().join('')`.
- **onclick handlers**: Extract emails from `onclick` attributes containing `mailto:` patterns.

## 3. Always Visit Profile Links (Deep Profile Scraping)

**Critical change**: Previously, profile links were only visited when NO emails were found on the listing page. Now, profile links are ALWAYS visited after emails are found.

### The Flow

After `scrapeFacultyPage` discovers emails and matches profile links to professors (Step 9), add Step 10 — deep scraping:

```js
const profsWithProfiles = professors.filter(p => p.profile_url);
if (profsWithProfiles.length > 0) {
  // Batch-visit profiles in parallel (5 concurrent)
  const BATCH = 5;
  for (let b = 0; b < profsWithProfiles.length; b += BATCH) {
    const results = await Promise.allSettled(batch.map(async (prof) => {
      const profileData = await scrapeIndividualProfile(prof.profile_url);
      return { prof, profileData };
    }));
    // Merge profile data into professor object:
    // - name (from JSON-LD on profile, more reliable than listing page)
    // - department, title, research_areas, papers
    // - Email cross-verification: if profile email matches listing email → name_verified=true
  }
}
```

### Email Cross-Verification

If the profile page email matches the listing page email, mark `email_verified=true` and `name_source='profile_verified'`. If they don't match, keep the listing page email (it's on the official faculty page) but don't mark as verified.

## 4. Profile-First Research (Phase 0 in threeAgentResearch)

When `profileUrl` is provided to `threeAgentResearch`, try scraping it BEFORE doing AI web search. If the profile returns `email_verified=true`, use that data as the dossier base and **skip AI search entirely** — profile data is more reliable than AI web search.

```js
// PHASE 0: If profile URL provided, try direct scrape
if (profileUrl) {
  const profileScrape = await scrapeVerifiedProfile(profileUrl, email);
  if (profileScrape?.email_verified) {
    // Verified profile → return early, skip AI search
    return { ...profileScrape, research_source: 'profile_verified', research_attempts: 1 };
  }
}
// PHASE 1+ (AI search) only runs if Phase 0 didn't verify
```

### Why Profile-First Works

- Profile pages contain real, structured data (name, department, research areas) — no hallucination risk
- Email verification on the profile page confirms this IS the right person
- Saves 2-3 AI calls (Agent 1 search + Agent 2 processing) — faster and cheaper
- `research_source: 'profile_verified'` tag lets downstream know data quality

### Scheduler Integration

The scheduler must pass `profile_url` from `scrapeFacultyPage` results to `threeAgentResearch`:

```js
dossier = await threeAgentResearch(p.email, p.source_url || '', p.profile_url || '');
```

Without this, threeAgentResearch gets no profileUrl and always falls through to AI search, wasting the deep-scraped profile data.

## 5. Required Exports

`scrapeVerifiedProfile` and `scrapeIndividualProfile` must be exported from `research/index.js` so threeAgentResearch can import them:

```js
export async function scrapeVerifiedProfile(profileUrl, expectedEmail) { ... }
export async function scrapeIndividualProfile(profileUrl) { ... }
export function deobfuscateEmails(text) { ... }
```

## Key Files

- `backend/src/research/index.js` — `fetchWithBrowser` (deep pagination), `fetchPaginatedPagesWithBrowser`, `deobfuscateEmails`, `extractEmailsFromHtml` (5 strategies), `scrapeFacultyPage` (10-step pipeline with Step 10 deep scraping), `scrapeVerifiedProfile`, `scrapeIndividualProfile`
- `backend/src/research/threeAgentResearch.js` — Phase 0 profile-first, imports `scrapeVerifiedProfile`
- `backend/src/pipeline/scheduler.js` — passes `p.profile_url` to threeAgentResearch

## When to Use

- When building a faculty page scraper that handles diverse university website formats
- When professors' emails are obfuscated or hidden behind JavaScript
- When profile pages contain research data that should be used instead of AI search
- When the user asks "improve scraping", "handle pagination", "deep scrape profiles", "find hidden emails"

## Diagnostic Signals

- `[Puppeteer] Scroll rounds: 7` → infinite scroll working, loaded 7 rounds of content
- `[Puppeteer] Clicked button[class*="more"] (3 times)` → Load More working
- `[Puppeteer:Pagination] Page 3: https://...page=3` → next/back pagination working
- `[Scrape] Deep scraping 15 profiles...` → profile links being visited for detailed data
- `[ThreeAgent:Phase0] ✓ Profile verified — skipping AI search` → profile-first shortcut working
- `deobfuscateEmails('john[at]uni.edu')` → `john@uni.edu` → deobfuscation working
