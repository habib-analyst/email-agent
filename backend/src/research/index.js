import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-core';
import { existsSync } from 'fs';
import { withRetry, delay } from '../pipeline/utils.js';
import { researchWithAI, extractEmailsWithAI } from '../ai/index.js';
import { performWebSearch } from '../ai/webSearch.js';
import {
  extractAreaOfInterestFromNode,
  extractFacultyFromInterestTable,
  extractFacultyFromDomContainers,
  extractFacultyFromMailtoCards,
  hasDirectoryInterestPanels,
  expandDirectoryInterestPanels,
  parseInterestKeywordList,
} from './directoryInterests.js';
import { filterProfessorsByDesignation } from './designationFilter.js';
import { enrichProfessorTitle } from './facultyTitle.js';
import {
  extractProfilePageFields,
  isLikelySingleProfileUrl,
  isPageChromeText,
  pickBestProfileName,
  collectProfileNameCandidates,
  getMainContentRoot,
  countFacultyMailtosOnPage,
} from './pageContent.js';
import {
  rankProfileUrlsForProfessor,
  deepScrapeProfessorProfiles,
  applyDeepScrapeToProfessor,
} from './profileUrlResolver.js';
import {
  lastNameFromEmail,
  fullNameFromEmail,
  universityFromEmail,
  lastNameFromFullName,
  emailsMatch,
  emailLocalKey,
  capitalizeWord,
  sanitizeAIField,
  isValidPersonName,
  parseFullName,
  verifyNameWithEmail,
  extractNameFromJsonLd,
} from '../utils/professor.js';

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
const EMAIL_REGEX = /(?<![a-zA-Z0-9._-])[a-zA-Z0-9][\w.-]*@[a-zA-Z0-9][\w.-]*\.[a-z]{2,6}(?:\.[a-z]{2,6})?/gi;

const profileCache = new Map();
const CACHE_MAX = 200;
function cacheSet(key, val) {
  if (profileCache.size >= CACHE_MAX) {
    const first = profileCache.keys().next().value;
    profileCache.delete(first);
  }
  profileCache.set(key, val);
}

const BLOCKED_EMAIL_PATTERNS = [
  /\.(png|jpg|gif|svg|css|js|woff|ico)$/i,
  /example\.com/i, /example\.edu/i, /noreply/i, /no-reply/i, /donotreply/i,
  /wixpress/i, /sentry/i, /wordpress/i, /github\.com/i,
  /webmaster/i, /admin@/i, /info@/i, /support@/i, /contact@/i,
  /^(grad|student|phd|masters|ms|undergrad|alumni|ta)\d*@/i,
  /@students?\./i,
  /^(dean|chair|head|coordinator|secretary|receptionist|office|helpdesk|enquir|registrar|admission|hr|finance|facilities|general|main|dept|department|marketing|communications|webteam|itsupport|ithelp|postmaster|root|abuse|newsletter|subscribe|unsubscribe|feedback|social|media|events|careers|jobs|apply|donate|giving|alumni)\d*@/i,
  /^[a-z]*dept@/i,
  /csdept@/i,
  /^(library|librar|lib|circulation|interlibrary|reference|archive|archivist|catalog|acquisitions)\d*@/i,
  /^(parking|security|safety|police|dining|housing|bookstore|store|cashier|bursar|payroll)\d*@/i,
  /^(provost|chancellor|president|vp|vice-president|trustee)\d*@/i,
  /^(help|ask|request|ticket|service|desk|it-help|techsupport)\d*@/i,
];

const FACULTY_TITLE_KEYWORDS = /\b(professor|prof\.|assistant\s+prof|associate\s+prof|lecturer|instructor|adjunct|emeritus|emerita|research\s+fellow|tenure|faculty|scientist|postdoc|post-doctoral|tenure[\s-]track|distinguished\s+prof|endowed\s+chair)\b/i;
const NON_FACULTY_KEYWORDS = /\b(student|alumni|success\s+stor|graduate\s+spotlight|testimonial|administration|administrative\s+staff|undergraduate\s+advisor|teaching\s+assistant|graduate\s+assistant|prospective\s+students?|apply\s+now|admissions?)\b/i;
const ADMIN_ONLY_TITLE = /\b(administrative\s+assistant|program\s+coordinator|department\s+coordinator|academic\s+advisor|admissions\s+officer|registrar|office\s+manager|executive\s+assistant|department\s+administrator|fiscal\s+officer|budget\s+analyst|lab\s+technician|it\s+specialist|accountant|clerk|custodian)\b/i;
const FOOTER_SIDEBAR_SELECTORS = 'footer, aside, nav, [class*="footer"], [class*="sidebar"], [class*="widget"], [class*="contact-us"], [id*="footer"], [id*="sidebar"]';
const DIRECTORY_CARD_SELECTORS = [
  'div[class*="person"]', 'div[class*="faculty"]', 'div[class*="profile"]',
  'div[class*="member"]', 'div[class*="card"]', 'div[class*="staff"]',
  'div[class*="team"]', 'article', '.vcard', '[itemtype*="Person"]',
  'div[class*="directory"]', 'div[class*="listing"]', 'div[class*="people"]',
  'div[class*="col-"]', 'section[class*="faculty"]',
];

function isLikelyFacultyByTitle(title, cardText = '') {
  const combined = `${title} ${cardText}`;
  if (ADMIN_ONLY_TITLE.test(title) && !FACULTY_TITLE_KEYWORDS.test(cardText)) return false;
  if (NON_FACULTY_KEYWORDS.test(title)) return false;
  if (FACULTY_TITLE_KEYWORDS.test(combined)) return true;
  if (/\b(dr\.|ph\.?d|habilitation)\b/i.test(combined)) return true;
  if (NON_FACULTY_KEYWORDS.test(combined)) return false;
  return true;
}

/** Score email by page context — higher = more likely faculty. */
function classifyEmail($, email) {
  if (!isValidAcademicEmail(email)) return -100;

  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const emailRegex = new RegExp(escapedEmail, 'i');
  let score = 0;
  let foundInContent = false;
  let foundInFooter = false;

  $('a[href*="mailto:"], td, li, p, div, span, dd, dt, article, tr').each((_, el) => {
    const elText = $(el).text() || '';
    const elHtml = $(el).html() || '';
    if (!emailRegex.test(elText) && !emailRegex.test(elHtml)) return;

    const container = $(el).closest('tr, li, article, div[class*="person"], div[class*="faculty"], div[class*="profile"], div[class*="member"], div[class*="card"], div[class*="staff"], div[class*="team"], .vcard, [itemtype*="Person"]');
    const contextText = container.length ? container.text() : elText;

    if ($(el).is('a[href*="mailto:"]')) score += 2;
    if (FACULTY_TITLE_KEYWORDS.test(contextText)) score += 4;
    if (NON_FACULTY_KEYWORDS.test(contextText)) score -= 5;
    if (ADMIN_ONLY_TITLE.test(contextText) && !FACULTY_TITLE_KEYWORDS.test(contextText)) score -= 4;
    if (container.is(DIRECTORY_CARD_SELECTORS.join(', ')) || container.find('a[href*="profile"], a[href*="faculty"], a[href*="people"]').length > 0) score += 2;
  });

  $('a[href*="mailto:"], *').each((_, el) => {
    const elHtml = $(el).html() || '';
    const elText = $(el).text() || '';
    if (!emailRegex.test(elText) && !emailRegex.test(elHtml)) return;
    if ($(el).closest(FOOTER_SIDEBAR_SELECTORS).length > 0) foundInFooter = true;
    else { foundInContent = true; return false; }
  });
  if (foundInFooter && !foundInContent) score -= 6;

  return score;
}

function isLikelyFacultyEmail($, email) {
  return classifyEmail($, email) >= 0;
}

function isValidAcademicEmail(email) {
  if (email.length > 80 || email.length < 5) return false;
  for (const pat of BLOCKED_EMAIL_PATTERNS) {
    if (pat.test(email)) return false;
  }
  // Reject emails where local part is suspiciously long (likely scraped with surrounding text)
  const local = email.split('@')[0];
  if (local.length > 40) return false;
  return true;
}

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const paths = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  for (const p of paths) { if (existsSync(p)) return p; }
  return null;
}

async function fetchPage(url) {
  return withRetry(() => axios.get(url, { timeout: 10000, headers: HEADERS, maxRedirects: 5 }));
}

async function fetchWithBrowser(url, { captureJson = false } = {}) {
  const chromePath = findChrome();
  if (!chromePath) { console.log('[Puppeteer] No Chrome/Edge found'); return captureJson ? { html: null, jsonPayloads: [] } : null; }

  let browser;
  const jsonPayloads = [];
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setUserAgent(HEADERS['User-Agent']);
    await page.setViewport({ width: 1280, height: 900 });

    if (captureJson) {
      page.on('response', async (response) => {
        try {
          const ct = response.headers()['content-type'] || '';
          if (!ct.includes('json')) return;
          const responseUrl = response.url();
          if (!/faculty|staff|people|directory|member|profile|person|employee|researcher|contact/i.test(responseUrl)) return;
          const json = await response.json();
          jsonPayloads.push({ url: responseUrl, json });
        } catch {}
      });
    }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 800));

    // ── Phase A: Infinite scroll — scroll to bottom until no new content ──
    let prevHeight = 0;
    let scrollRounds = 0;
    const MAX_SCROLL_ROUNDS = 30;

    while (scrollRounds < MAX_SCROLL_ROUNDS) {
      const currentHeight = await page.evaluate(() => document.body.scrollHeight);
      if (currentHeight === prevHeight) break;
      prevHeight = currentHeight;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(r => setTimeout(r, 800));
      scrollRounds++;
    }
    console.log(`[Puppeteer] Scroll rounds: ${scrollRounds}`);

    // ── Phase B: Click "Load More" buttons recursively ──
    const loadMoreSelectors = [
      'button[class*="more"]', 'a[href*="more"]',
      '[class*="load-more"]', '[class*="show-all"]',
      '[class*="view-all"]', '[class*="expand"]',
    ];
    for (const sel of loadMoreSelectors) {
      let clickCount = 0;
      while (clickCount < 15) {
        const btn = await page.$(sel);
        if (!btn) break;
        try {
          const isVisible = await btn.isVisible();
          if (!isVisible) break;
          await btn.click();
          await new Promise(r => setTimeout(r, 1000));
          clickCount++;
          console.log(`[Puppeteer] Clicked ${sel} (${clickCount} times)`);
        } catch { break; }
      }
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 300));
    await expandDirectoryInterestPanels(page);
    const html = await page.content();
    return captureJson ? { html, jsonPayloads } : html;
  } catch (e) {
    console.error(`[Puppeteer] Failed for ${url}: ${e.message}`);
    return captureJson ? { html: null, jsonPayloads: [] } : null;
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }
}

async function fetchPaginatedPagesWithBrowser(baseUrl) {
  const chromePath = findChrome();
  if (!chromePath) return [];

  let browser;
  const allHtmls = [];
  const visitedUrls = new Set();

  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setUserAgent(HEADERS['User-Agent']);
    await page.setViewport({ width: 1280, height: 900 });

    let currentUrl = baseUrl;
    let pageCount = 0;
    const MAX_PAGES = 40;

    while (pageCount < MAX_PAGES) {
      if (visitedUrls.has(currentUrl)) break;
      visitedUrls.add(currentUrl);

      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
      await new Promise(r => setTimeout(r, 800));

      // Scroll to load lazy content
      let prevHeight = 0;
      for (let i = 0; i < 3; i++) {
        const h = await page.evaluate(() => document.body.scrollHeight);
        if (h === prevHeight) break;
        prevHeight = h;
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await new Promise(r => setTimeout(r, 600));
      }

      // Click Load More on this page
      for (const sel of ['button[class*="more"]', '[class*="load-more"]', '[class*="show-all"]', '[class*="view-all"]']) {
        let clicks = 0;
        while (clicks < 3) {
          const btn = await page.$(sel);
          if (!btn) break;
          try { const visible = await btn.isVisible(); if (!visible) break; await btn.click(); await new Promise(r => setTimeout(r, 800)); clicks++; } catch { break; }
        }
      }

      await expandDirectoryInterestPanels(page);
      allHtmls.push(await page.content());
      pageCount++;
      console.log(`[Puppeteer:Pagination] Page ${pageCount}: ${currentUrl}`);

      // Find next-page link
      const nextUrl = await page.evaluate((curPage) => {
        for (const sel of ['a[rel="next"]', 'a.next', '.pagination .next a', '.next-page a', 'li.next a', 'li.active + li a']) {
          const el = document.querySelector(sel);
          if (el && el.href && el.href.startsWith('http')) return el.href;
        }
        const pageLinks = document.querySelectorAll('a[href*="page="], a[href*="/page/"]');
        for (const link of pageLinks) {
          const text = link.textContent.trim();
          if (/^\d+$/.test(text) && parseInt(text) === curPage + 1) return link.href;
        }
        return null;
      }, pageCount);

      if (!nextUrl || visitedUrls.has(nextUrl)) break;
      currentUrl = nextUrl;
      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`[Puppeteer:Pagination] Visited ${pageCount} pages`);
    return allHtmls;
  } catch (e) {
    console.error(`[Puppeteer:Pagination] Failed: ${e.message}`);
    return allHtmls;
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }
}

export function deobfuscateEmails(text) {
  if (!text) return text;
  // Replace common obfuscation patterns with @
  return text
    .replace(/\[at\]/gi, '@')
    .replace(/\(at\)/gi, '@')
    .replace(/\/at\//gi, '@')
    .replace(/\{at\}/gi, '@')
    .replace(/<at>/gi, '@')
    .replace(/\s+at\s+/gi, '@')
    .replace(/\(a\)/gi, '@')
    .replace(/\s+\(a\)\s+/gi, '@')
    .replace(/_at_/gi, '@')
    .replace(/%40/gi, '@')
    .replace(/&#64;/g, '@')
    .replace(/&#x40;/g, '@');
}

function extractEmailsFromHtml($) {
  const mailtoEmails = new Set();
  const regexEmails = new Set();

  // Strategy 1: mailto links (most reliable — these are ground truth)
  $('a[href*="mailto:"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/mailto:([^?&"'\s]+)/i);
    if (match) {
      const email = match[1].toLowerCase().trim();
      if (isValidAcademicEmail(email)) mailtoEmails.add(email);
    }
  });

  // Strategy 2: regex on deobfuscated per-element text (avoids cross-element concatenation)
  $('td, li, p, div, span, dd, dt, a, h1, h2, h3, h4, h5, h6').each((_, el) => {
    const text = deobfuscateEmails($(el).clone().children().remove().end().text() || '');
    const matches = text.match(EMAIL_REGEX) || [];
    matches.forEach(e => {
      const lower = e.toLowerCase();
      if (isValidAcademicEmail(lower)) regexEmails.add(lower);
    });
  });

  // Strategy 3: regex on deobfuscated raw HTML (fallback)
  const rawHtml = deobfuscateEmails($('body').html() || '');
  const htmlMatches = rawHtml.match(EMAIL_REGEX) || [];
  htmlMatches.forEach(e => {
    const lower = e.toLowerCase();
    if (isValidAcademicEmail(lower)) regexEmails.add(lower);
  });

  // Strategy 4: data-email attributes (common JS protection pattern)
  $('a[data-email], [data-email]').each((_, el) => {
    const dataEmail = $(el).attr('data-email') || '';
    if (dataEmail) {
      // Some sites encode email in data-email with base64 or reversed strings
      let decoded = dataEmail;
      try {
        // Try base64 decode
        if (/^[A-Za-z0-9+/]+=*$/.test(decoded) && decoded.length > 10) {
          const b64 = Buffer.from(decoded, 'base64').toString('utf-8');
          if (b64.includes('@')) decoded = b64;
        }
      } catch {}
      // Try reversed string decode
      const reversed = decoded.split('').reverse().join('');
      const deobfuscated = deobfuscateEmails(decoded);
      for (const candidate of [deobfuscated, reversed]) {
        const match = candidate.match(EMAIL_REGEX);
        if (match) {
          for (const e of match) {
            const lower = e.toLowerCase();
            if (isValidAcademicEmail(lower)) regexEmails.add(lower);
          }
        }
      }
    }
  });

  // Strategy 5: onclick handlers with mailto patterns
  $('a[onclick]').each((_, el) => {
    const onclick = $(el).attr('onclick') || '';
    const mailtoMatch = onclick.match(/mailto:([^'"\s]+)/i);
    if (mailtoMatch) {
      const email = mailtoMatch[1].toLowerCase().trim();
      if (isValidAcademicEmail(email)) regexEmails.add(email);
    }
    // Also deobfuscate onclick text
    const deobfuscated = deobfuscateEmails(onclick);
    const matches = deobfuscated.match(EMAIL_REGEX) || [];
    matches.forEach(e => {
      const lower = e.toLowerCase();
      if (isValidAcademicEmail(lower)) regexEmails.add(lower);
    });
  });

  // Cross-validation: if mailto links found, only keep regex emails from same domains
  const combined = new Set([...mailtoEmails]);
  if (mailtoEmails.size > 0) {
    const trustedDomains = new Set([...mailtoEmails].map(e => e.split('@')[1]));
    for (const e of regexEmails) {
      const domain = e.split('@')[1];
      if (trustedDomains.has(domain)) combined.add(e);
    }
  } else {
    for (const e of regexEmails) combined.add(e);
  }

  return [...combined];
}

function extractFacultyFromDirectory($, baseUrl = '') {
  const results = [];
  const seenEmails = new Set();

  // Primary: F12-style DOM walk — repeating professor divs, labeled child elements
  const domContainers = extractFacultyFromDomContainers($, {
    isValidEmail: isValidAcademicEmail,
    seenEmails,
    baseUrl,
    isLikelyFaculty: (title, cardText) => isLikelyFacultyByTitle(title, cardText),
  });
  for (const row of domContainers) {
    if (!seenEmails.has(row.email)) {
      seenEmails.add(row.email);
      results.push(row);
    }
  }

  // Secondary: mailto-in-card (when grid detection misses a layout)
  const mailtoCards = extractFacultyFromMailtoCards($, {
    isValidEmail: isValidAcademicEmail,
    seenEmails,
    baseUrl,
    isLikelyFaculty: (title, cardText) => isLikelyFacultyByTitle(title, cardText),
  });
  for (const row of mailtoCards) {
    if (!seenEmails.has(row.email)) {
      seenEmails.add(row.email);
      results.push(row);
    }
  }

  // Fallback: class-based card containers
  const cardSelector = DIRECTORY_CARD_SELECTORS.join(', ');
  const cards = $(cardSelector).filter((_, el) => {
    // Must be a leaf-level card (not a wrapper that contains many cards)
    const nested = $(el).find(cardSelector).length;
    return nested < 2;
  });

  cards.each((_, el) => {
    const $card = $(el);
    // Skip cards inside footer/sidebar
    if ($card.closest(FOOTER_SIDEBAR_SELECTORS).length > 0) return;

    const cardText = $card.text() || '';
    const cardHtml = $card.html() || '';

    // Extract email from card
    let email = '';
    const mailto = $card.find('a[href*="mailto:"]').first();
    if (mailto.length) {
      const m = (mailto.attr('href') || '').match(/mailto:([^?&"'\s]+)/i);
      if (m) email = m[1].toLowerCase().trim();
    }
    if (!email) {
      const deob = deobfuscateEmails(cardText);
      const match = deob.match(EMAIL_REGEX);
      if (match) email = match[0].toLowerCase().trim();
    }
    if (!email) {
      const deob = deobfuscateEmails(cardHtml);
      const match = deob.match(EMAIL_REGEX);
      if (match) email = match[0].toLowerCase().trim();
    }

    if (!email || !isValidAcademicEmail(email) || seenEmails.has(email)) return;
    if (NON_FACULTY_KEYWORDS.test(cardText)) return;

    let title = '';
    const titleEl = $card.find('[class*="title"], [class*="position"], [class*="role"], .rank, .designation').first();
    if (titleEl.length) title = titleEl.text().trim();
    if (!isLikelyFacultyByTitle(title, cardText)) return;

    const research_areas = extractAreaOfInterestFromNode($, $card);
    const department = $card.find('[class*="dept"], [class*="department"], .department').first().text().trim();

    // Extract name
    let name = '';
    const nameEl = $card.find('h2, h3, h4, h5, a[class*="name"], [class*="name"], strong').first();
    if (nameEl.length) name = nameEl.text().trim();
    if (!name) {
      const link = $card.find('a[href]').first();
      if (link.length) name = link.text().trim();
    }

    // Extract profile link
    let profileUrl = '';
    const profileLink = $card.find('a[href*="profile"], a[href*="faculty"], a[href*="people"], a[href*="staff"]').first();
    if (profileLink.length) {
      profileUrl = profileLink.attr('href') || '';
    } else {
      const anyLink = $card.find('a[href]').first();
      if (anyLink.length) profileUrl = anyLink.attr('href') || '';
    }

    seenEmails.add(email);
    results.push({ email, name: name || '', title: title || '', department, research_areas, profileUrl, source: 'directory_card' });
  });

  // Structured tables with Area of Interest column (common on university directories)
  const tableResults = extractFacultyFromInterestTable($, {
    isValidEmail: isValidAcademicEmail,
    seenEmails,
  });
  for (const row of tableResults) {
    if (!seenEmails.has(row.email)) {
      seenEmails.add(row.email);
      results.push(row);
    }
  }

  // Also try table rows (tr) with emails — legacy simple rows
  $('table tr').each((_, el) => {
    const $row = $(el);
    if ($row.closest(FOOTER_SIDEBAR_SELECTORS).length > 0) return;
    const rowText = $row.text() || '';
    const rowHtml = $row.html() || '';

    let email = '';
    const mailto = $row.find('a[href*="mailto:"]').first();
    if (mailto.length) {
      const m = (mailto.attr('href') || '').match(/mailto:([^?&"'\s]+)/i);
      if (m) email = m[1].toLowerCase().trim();
    }
    if (!email) {
      const deob = deobfuscateEmails(rowText);
      const match = deob.match(EMAIL_REGEX);
      if (match) email = match[0].toLowerCase().trim();
    }

    if (!email || !isValidAcademicEmail(email) || seenEmails.has(email)) return;
    if (NON_FACULTY_KEYWORDS.test(rowText)) return;

    const cells = $row.find('td');
    let name = cells.eq(0).text().trim();
    let title = cells.length > 1 ? cells.eq(1).text().trim() : '';

    seenEmails.add(email);
    results.push({ email, name: name || '', title: title || '', profileUrl: '', source: 'directory_card' });
  });

  return results;
}

function extractFacultyFromJsonLd($, baseUrl) {
  const results = [];
  const seen = new Set();
  const base = baseUrl ? new URL(baseUrl) : null;

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).html() || '';
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw);
      const nodes = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const type = [].concat(node['@type'] || '').join(' ');
        const email = (node.email || node.contactPoint?.email || '').toString().toLowerCase().trim();
        if (!email.includes('@') || !isValidAcademicEmail(email) || seen.has(email)) continue;
        if (type && !/Person|Faculty|Employee|ProfilePage/i.test(type) && !node.jobTitle) continue;
        seen.add(email);
        let profileUrl = node.url || node.sameAs || '';
        if (profileUrl && base && !profileUrl.startsWith('http')) {
          try { profileUrl = new URL(profileUrl, base).href; } catch { profileUrl = ''; }
        }
        results.push({
          email,
          name: node.name || '',
          title: node.jobTitle || node.title || '',
          profileUrl,
          source: 'json_ld',
        });
      }
    } catch {}
  });
  return results;
}

function mergeDiscoveriesFromPage(page$, pageUrl, state) {
  const { emailSet, directoryFaculty, directoryEmails, profileLinks, onFound } = state;

  for (const f of extractFacultyFromDirectory(page$, pageUrl)) {
    if (!directoryEmails.has(f.email)) {
      directoryFaculty.push(f);
      directoryEmails.add(f.email);
    }
    if (!emailSet.has(f.email)) {
      emailSet.add(f.email);
      onFound?.({ email: f.email, name: f.name, title: f.title, step: 'directory_card' });
    }
  }

  for (const f of extractFacultyFromJsonLd(page$, pageUrl)) {
    if (!directoryEmails.has(f.email)) {
      directoryFaculty.push(f);
      directoryEmails.add(f.email);
    }
    if (!emailSet.has(f.email)) {
      emailSet.add(f.email);
      onFound?.({ email: f.email, name: f.name, title: f.title, step: 'json_ld' });
    }
  }

  for (const e of extractEmailsFromHtml(page$)) {
    if (!directoryEmails.has(e) && !emailSet.has(e)) emailSet.add(e);
  }

  state.profileLinks = dedupeProfileLinks([...profileLinks, ...findProfileLinks(page$, pageUrl)]);
  return state.profileLinks;
}

function extractProfessorContext($, email) {
  let name = '';
  let department = '';
  let title = '';
  const emailLocalPart = email.split('@')[0];
  const emailDomain = email.split('@')[1] || '';

  // Strategy 1: find in mailto link context
  $('a[href*="mailto:"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!href.toLowerCase().includes(email)) return;

    // The link text itself might be the name
    const linkText = $(el).text().trim();
    if (isValidPersonName(linkText) && !linkText.includes('@') && !isPageChromeText(linkText)) {
      name = linkText;
    }

    // Search parent container for structured info
    const container = $(el).closest('tr, li, div.faculty, div.person, div.profile, article, .card, .member, [class*="faculty"], [class*="person"], [class*="staff"], [class*="profile"]');
    if (container.length) {
      if (!name) {
        container.find('h1,h2,h3,h4,h5,.name,[class*="name"],strong,b').each((_, c) => {
          if (name) return false;
          const t = $(c).text().trim();
          if (isValidPersonName(t) && !t.includes('@') && !isPageChromeText(t)) {
            name = t;
            return false;
          }
        });
      }
      department = container.find('[class*="dept"],[class*="department"],.department').first().text().trim();
      title = container.find('[class*="title"],[class*="position"],.title,.position').first().text().trim();
    }

    if (name) return false;
  });

  // Strategy 2: search for email as text in page and look at parent
  if (!name) {
    const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escapedEmail, 'i');
    $('td, li, div, p, span, dd').each((_, el) => {
      if (name) return false;
      const text = $(el).text();
      if (!re.test(text)) return;

      const container = $(el).closest('tr, li, div, article, dl, section');
      if (!container.length) return;

      // Look for name elements
      const candidates = container.find('h2,h3,h4,h5,strong,b,dt,a:not([href*="mailto"]):not([href*="http"]),[class*="name"]');
      candidates.each((_, c) => {
        const t = $(c).text().trim();
        if (isValidPersonName(t) && !t.includes('@') && !isPageChromeText(t)) {
          name = t;
          return false;
        }
      });
    });
  }

  // Strategy 3: check JSON-LD for authoritative name
  if (!name) {
    const rawHtml = $('body').html() || $.html() || '';
    const jsonLdName = extractNameFromJsonLd(rawHtml);
    if (jsonLdName) name = jsonLdName;
  }

  // Strategy 4: guess from email local part
  if (!name) {
    name = fullNameFromEmail(email) || '';
  }

  // Apply robust name parsing
  const originalName = name;
  const parsed = parseFullName(name, emailLocalPart, emailDomain);
  name = parsed.fullName;

  // Verify name against email
  const verification = verifyNameWithEmail(parsed.fullName, parsed.lastName, parsed.firstName, emailLocalPart);
  if (!verification.verified) {
    console.log(`[Research:NameVerify] MISMATCH for ${email}: ${verification.mismatchDetail} (original="${originalName}", parsed="${parsed.fullName}", lastName="${parsed.lastName}")`);
  }

  return {
    name: name || '',
    last_name: parsed.lastName,
    first_name: parsed.firstName,
    department,
    title,
    name_source: parsed.nameSource,
    name_verified: verification.verified,
    name_mismatch: verification.mismatchDetail,
  };
}

// Detect pagination links and return URLs of subsequent pages
function findPaginationLinks($, baseUrl) {
  const links = new Set();
  const base = new URL(baseUrl);

  // Common pagination patterns
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim().toLowerCase();
    const cls = ($(el).attr('class') || '').toLowerCase();

    const isPagination = /^[2-9]\d*$|^next|^›|^»|^‹|^«|page/.test(text) ||
      cls.includes('page') || cls.includes('pagination') || cls.includes('next') ||
      /[?&](page|pn|p|offset|start|from)=\d/i.test(href) || /\/page\/\d/.test(href) ||
      $(el).closest('.pagination, [class*="pagination"], [class*="pager"], nav[aria-label*="pagination"]').length > 0;

    if (isPagination && href) {
      try {
        const resolved = new URL(href, base).href;
        if (resolved.startsWith(base.origin)) links.add(resolved);
      } catch (e) {
        console.error('[Research:Pagination] URL parse failed:', e.message);
      }
    }
  });

  // A-Z letter index detection
  const letterLinks = [];
  $('a[href]').each((_, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href') || '';
    if (/^[A-Z]$/i.test(text) && /faculty|directory|people|staff|member|letter/i.test(href)) {
      try {
        const resolved = new URL(href, base).href;
        if (resolved.startsWith(base.origin)) letterLinks.push(resolved);
      } catch {}
    }
  });
  if (letterLinks.length >= 5) {
    console.log(`[Research:Pagination] Found A-Z letter index with ${letterLinks.length} letters`);
    letterLinks.forEach(l => links.add(l));
  }

  return [...links].slice(0, 50);
}

function findViewAllLink($, baseUrl) {
  const base = new URL(baseUrl);
  let viewAllUrl = null;
  $('a[href]').each((_, el) => {
    const text = $(el).text().trim().toLowerCase();
    if (/^(view\s+all|show\s+all|complete\s+directory|all\s+faculty|see\s+all|full\s+directory|entire\s+directory)/i.test(text)) {
      const href = $(el).attr('href') || '';
      try {
        const resolved = new URL(href, base).href;
        if (resolved.startsWith(base.origin)) { viewAllUrl = resolved; return false; }
      } catch {}
    }
  });
  return viewAllUrl;
}

function findDepartmentSidebarLinks($, baseUrl) {
  const base = new URL(baseUrl);
  const links = [];
  const containers = $('nav, aside, [class*="sidebar"], [class*="menu"], [class*="department"], ul[class*="nav"]');
  containers.find('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (/faculty|department|people|staff|directory/i.test(href)) {
      try {
        const resolved = new URL(href, base).href;
        if (resolved.startsWith(base.origin) && resolved !== baseUrl) links.push(resolved);
      } catch {}
    }
  });
  const unique = [...new Set(links)];
  if (unique.length > 0) console.log(`[Research:Sidebar] Found ${unique.length} department/category links`);
  return unique.slice(0, 30);
}

function hasLoadMoreIndicators($) {
  const html = ($('body').html() || '').toLowerCase();
  return /load\s*more|show\s*all|view\s*all|see\s*all|expand/i.test(html) ||
    $('[class*="load-more"], [class*="show-all"], [class*="view-all"], button[class*="more"]').length > 0;
}

function dedupeProfileLinks(links) {
  const seen = new Set();
  const out = [];
  for (const link of links) {
    const key = (link.url || '').split('#')[0].replace(/\/$/, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
}

function scoreProfileLinkMatch(link, email) {
  const local = (email || '').split('@')[0].toLowerCase();
  const key = emailLocalKey(email);
  const parts = local.split(/[._-]/).filter(p => p.length > 2);
  const hay = `${(link.url || '').toLowerCase()} ${(link.name || '').toLowerCase()}`;
  let score = 0;
  if (hay.includes(local)) score += 5;
  if (key && hay.includes(key)) score += 4;
  for (const p of parts) {
    if (hay.includes(p)) score += 2;
  }
  if (link.nearEmail) score += 3;
  return score;
}

function findBestProfileLink(profileLinks, email) {
  const ranked = findProfileLinksForProfessor(profileLinks, email, '');
  return ranked[0] || null;
}

/** All profile links that may belong to this professor (1 or many). */
function findProfileLinksForProfessor(profileLinks, email, name = '') {
  return profileLinks
    .map(link => ({
      ...link,
      score: scoreProfileLinkMatch(link, email)
        + (name && link.name && name.toLowerCase().split(/\s+/).filter(p => p.length > 2).every(p => link.name.toLowerCase().includes(p)) ? 3 : 0),
    }))
    .filter(l => l.score >= 2)
    .sort((a, b) => b.score - a.score);
}

function extractProfessorsFromJsonPayloads(payloads, sourceUrl) {
  const professors = [];
  const seen = new Set();

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    const email = (node.email || node.Email || node.mail || node.contactEmail || node.contact_email || '').toString().toLowerCase().trim();
    if (email.includes('@') && isValidAcademicEmail(email) && !seen.has(email)) {
      seen.add(email);
      const name = node.name || node.fullName || node.full_name || node.displayName || node.title || '';
      professors.push({
        email,
        last_name: name ? lastNameFromFullName(name) : lastNameFromEmail(email),
        name: name || fullNameFromEmail(email) || '',
        department: node.department || node.dept || node.affiliation || '',
        title: node.title || node.position || node.jobTitle || '',
        research_areas: Array.isArray(node.research_areas) ? node.research_areas.join(', ') : (node.researchInterest || node.research || ''),
        source_url: sourceUrl,
        profile_url: node.url || node.profileUrl || node.profile_url || node.link || '',
      });
    }

    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') walk(v);
    }
  }

  for (const { json } of payloads || []) walk(json);
  return professors;
}

// Detect internal profile links on the same domain
function findProfileLinks($, baseUrl) {
  const links = [];
  const base = new URL(baseUrl);
  const seen = new Set();

  function addLink(url, name, nearEmail = false) {
    const key = url.split('#')[0].replace(/\/$/, '');
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ url: key, name: name || '', nearEmail });
  }

  // Links in same row/card as a mailto (directory tables)
  $('a[href*="mailto:"]').each((_, mailEl) => {
    const container = $(mailEl).closest('tr, li, article, div[class*="person"], div[class*="faculty"], div[class*="staff"], td');
    container.find('a[href]').each((__, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim();
      if (!href || href.startsWith('#') || href.startsWith('mailto:')) return;
      try {
        const resolved = new URL(href, base);
        if (resolved.origin !== base.origin) return;
        addLink(resolved.href, text, true);
      } catch {}
    });
  });

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) return;
    try {
      const resolved = new URL(href, base);
      if (resolved.origin !== base.origin) return;

      const path = resolved.pathname.toLowerCase();
      const isProfilePath = /\/(people|faculty|staff|professor|~|profile|directory|person|bios|members|team|academic|researchers|employee|our-people)\//.test(path) ||
        /\/~[\w.-]+\/?/.test(path) ||
        /\/[a-z]+-[a-z]+(-[a-z]+)?\/?$/.test(path) ||
        /\/[a-z]+\.[a-z]+\/?$/.test(path) ||
        /\/[a-z]+_[a-z]+\/?$/.test(path);

      if (isProfilePath && text && !text.includes('@') && text.length > 2 && text.length < 80) {
        addLink(resolved.href, text);
      }
    } catch (e) {
      console.error('[Research:ProfileLinks] URL parse failed:', e.message);
    }
  });

  return links.slice(0, 500);
}

async function searchGoogleScholarByEmail(email) {
  // Do not search by display name — only optional email-quoted search when profile verified
  return [];
}

/**
 * searchProfileByEmail — find professor .edu profile page using email as search anchor.
 * Queries Google for `"email" faculty profile`, picks the first .edu result, and scrapes it.
 * Returns { profileUrl, profile } or null if no profile found within maxAttempts.
 */
async function searchProfileByEmail(email, maxAttempts = 2) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const queries = attempt === 1
      ? `"${email}" faculty profile`
      : `${email.split('@')[0]} ${universityFromEmail(email)} professor`;

    console.log(`[Research:SearchByEmail] Attempt ${attempt} for ${email}: query="${queries}"`);
    const searchResults = await performWebSearch(queries);

    if (!searchResults || searchResults.startsWith('No results') || searchResults.startsWith('Search failed')) {
      console.log(`[Research:SearchByEmail] No search results for attempt ${attempt}`);
      continue;
    }

    // Extract .edu URLs from search results
    const eduUrlRegex = /https?:\/\/[a-zA-Z0-9][\w.-]*\.edu(?:\.[a-z]{2,6})?[\w\/.-]*\/?/gi;
    const eduUrls = searchResults.match(eduUrlRegex) || [];

    // Filter out generic/unlikely URLs (homepage, admissions, etc.)
    const PROFILE_PATH_PATTERN = /\/(faculty|people|staff|professor|directory|profile|person|bios|members|team|academic|researchers|~)[\/]/i;
    const filteredUrls = eduUrls.filter(u => PROFILE_PATH_PATTERN.test(u) || u.includes('~'));

    // Try each filtered URL, then fallback to any .edu URL
    const urlsToTry = filteredUrls.length > 0 ? filteredUrls.slice(0, 2) : eduUrls.slice(0, 2);
    for (const profileUrl of urlsToTry) {
      console.log(`[Research:SearchByEmail] Scraping: ${profileUrl}`);
      const profile = await scrapeVerifiedProfile(profileUrl, email);
      if (profile && profile.email_verified) {
        console.log(`[Research:SearchByEmail] ✓ Verified profile found at ${profileUrl}`);
        return { profileUrl, profile };
      }
      if (profile && profile.name) {
        console.log(`[Research:SearchByEmail] Found profile but email not verified — keeping as candidate`);
        return { profileUrl, profile };
      }
    }
  }

  console.log(`[Research:SearchByEmail] No profile found for ${email} after ${maxAttempts} attempts`);
  return null;
}

function hasUsefulVerifiedData(dossier) {
  return dossier?.email_verified && (
    dossier?.papers?.length > 0 ||
    dossier?.research_areas?.length > 0 ||
    !!dossier?.department
  );
}

function matchProfileLinkToEmail(link, email) {
  const local = (email || '').split('@')[0].toLowerCase();
  const key = emailLocalKey(email);
  const hay = `${(link.url || '').toLowerCase()} ${(link.name || '').toLowerCase()}`;
  return hay.includes(local) || hay.includes(key);
}

export async function scrapeVerifiedProfile(profileUrl, expectedEmail) {
  if (!profileUrl) return null;
  const profile = await scrapeIndividualProfile(profileUrl);
  if (!profile) return null;
  if (profile.email && !emailsMatch(profile.email, expectedEmail)) {
    console.log(`[Research] Email mismatch on profile: ${profile.email} vs ${expectedEmail}`);
    return null;
  }
  return { ...profile, email_verified: !profile.email || emailsMatch(profile.email, expectedEmail) };
}

export const FALLBACK_TOPIC = 'Machine Learning';
export const FALLBACK_SUBJECT = `[${FALLBACK_TOPIC}] Seeking an MS/PhD Position in Your Lab`;

export async function researchProfessor(email, sourceUrl, profileUrl, attempt = 1) {
  console.log(`[Research] Starting attempt ${attempt} for ${email}`);
  console.log(`[Research] Profile URL: ${profileUrl}`);

  const cacheKey = `${email}:${attempt}`;
  if (profileCache.has(cacheKey)) {
    console.log(`[Research] Cache hit: ${email}`);
    return profileCache.get(cacheKey);
  }

  const dossier = {
    email,
    name: '',
    last_name: lastNameFromEmail(email),
    university: universityFromEmail(email),
    department: '',
    title: '',
    papers: [],
    research_areas: [],
    links: [],
    profile_url: profileUrl || '',
    email_verified: false,
    verified: false,
    research_source: 'email',
    verified_name: '',
    name_source: 'email',
    name_verified: false,
    name_mismatch: null,
  };

  const urls = [profileUrl, sourceUrl].filter(u => u && u.includes('/'));
  if (attempt === 2 && sourceUrl) {
    try {
      const res = await fetchPage(sourceUrl);
      const $ = cheerio.load(res.data);
      const local = email.split('@')[0].toLowerCase();
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().toLowerCase();
        if (href.includes(local) || text.includes(local.replace(/[._-]/g, ' '))) {
          const abs = href.startsWith('http') ? href : new URL(href, sourceUrl).href;
          if (!urls.includes(abs) && !abs.includes('mailto:')) urls.unshift(abs);
        }
      });
    } catch (e) {
      console.error('[Research:LocalName] Link extraction failed:', e.message);
    }
  }

  for (const url of urls) {
    const profile = await scrapeVerifiedProfile(url, email);
    if (!profile) continue;
    if (profile.name) dossier.name = profile.name;
    if (profile.last_name) dossier.last_name = profile.last_name;
    if (profile.first_name) dossier.first_name = profile.first_name;
    if (profile.name_source) dossier.name_source = profile.name_source;
    if (profile.name_verified !== undefined) dossier.name_verified = profile.name_verified;
    if (profile.name_mismatch) dossier.name_mismatch = profile.name_mismatch;
    if (profile.department) dossier.department = profile.department;
    if (profile.title) dossier.title = profile.title;
    if (profile.research_areas?.length) dossier.research_areas = profile.research_areas;
    if (profile.papers?.length) dossier.papers = profile.papers;
    if (profile.links?.length) dossier.links = profile.links;
    dossier.profile_url = profile.profileUrl || url;
    dossier.email_verified = true;
    break;
  }

  // Fallback: search for profile by email if no verified data from provided URLs
  if (!dossier.email_verified && attempt <= 2) {
    console.log(`[Research] No profile from provided URLs — searching by email for ${email}`);
    const searchResult = await searchProfileByEmail(email);
    if (searchResult?.profile) {
      const p = searchResult.profile;
      if (p.name) dossier.name = p.name;
      if (p.last_name) dossier.last_name = p.last_name;
      if (p.first_name) dossier.first_name = p.first_name;
      if (p.name_source) dossier.name_source = p.name_source;
      if (p.name_verified !== undefined) dossier.name_verified = p.name_verified;
      if (p.name_mismatch) dossier.name_mismatch = p.name_mismatch;
      if (p.department) dossier.department = p.department;
      if (p.title) dossier.title = p.title;
      if (p.research_areas?.length) dossier.research_areas = p.research_areas;
      if (p.papers?.length) dossier.papers = p.papers;
      if (p.links?.length) dossier.links = p.links;
      dossier.profile_url = searchResult.profileUrl || p.profileUrl || '';
      dossier.email_verified = p.email_verified;
      dossier.research_source = 'email_search';
      console.log(`[Research] ✓ Email search found profile at ${dossier.profile_url}`);
    }
  }

  // Apply robust name parsing if no scraped name
  const emailLocalPart = email.split('@')[0];
  const emailDomain = email.split('@')[1] || '';

  if (!dossier.name) {
    const emailGuess = fullNameFromEmail(email);
    dossier.name = emailGuess || '';
  }
  if (!dossier.name_source || dossier.name_source === 'email') {
    const parsed = parseFullName(dossier.name, emailLocalPart, emailDomain);
    dossier.name = parsed.fullName;
    dossier.last_name = parsed.lastName;
    dossier.first_name = parsed.firstName;
    dossier.name_source = parsed.nameSource;

    // Verify name against email
    const verification = verifyNameWithEmail(parsed.fullName, parsed.lastName, parsed.firstName, emailLocalPart);
    dossier.name_verified = verification.verified;
    dossier.name_mismatch = verification.mismatchDetail;
  }

  // Log the name parsing decision chain
  console.log(`[Research:NameParse] ${email}: original→"${dossier.name}" | lastName="${dossier.last_name}" | source=${dossier.name_source} | verified=${dossier.name_verified} | mismatch=${dossier.name_mismatch || 'none'}`);

  if (!hasUsefulVerifiedData(dossier) && sourceUrl) {
    try {
      const res = await fetchPage(sourceUrl);
      const $ = cheerio.load(res.data);
      $(`a[href*="${email.split('@')[0]}"]`).each((_, el) => {
        const parent = $(el).closest('tr, li, article');
        parent.find('a[href]').each((__, a) => {
          const href = $(a).attr('href') || '';
          if (href.includes('mailto:') || href.includes('.pdf')) return;
          if (href.length < 3) return;
        });
      });
    } catch (e) {
      console.error('[Research:EmailVerify] Parent link extraction failed:', e.message);
    }
  }

  try {
    const enriched = await researchWithAI({
      ...dossier,
      strict_email: email,
      attempt,
      note: attempt >= 3
        ? 'Final attempt — use ONLY verifiable data for this exact email. Never merge homonymous professors.'
        : 'Use ONLY data for this exact email. Never merge homonymous professors.',
    });
    if (attempt >= 3 || (enriched?.confidence !== 'low' && dossier.email_verified)) {
      if (enriched.research_areas?.length) dossier.research_areas = enriched.research_areas;
      if (sanitizeAIField(enriched.verified_name) && isValidPersonName(enriched.verified_name)) {
        dossier.name = enriched.verified_name;
        const parsed = parseFullName(enriched.verified_name, emailLocalPart, emailDomain);
        dossier.last_name = parsed.lastName;
        dossier.first_name = parsed.firstName;
        dossier.verified_name = enriched.verified_name;
        dossier.name_source = 'ai_verified';
      } else if (sanitizeAIField(enriched.verified_name)) {
        console.log(`[Research] AI returned invalid name '${enriched.verified_name}' for ${email} — keeping scraped/email-derived name`);
      }
      if (sanitizeAIField(enriched.department)) dossier.department = enriched.department;
      if (attempt >= 3 && enriched?.research_areas?.length) dossier.email_verified = true;
      dossier.verified = true;
    }
  } catch (e) {
    console.error('[Research] AI enrichment failed:', e.message);
  }

  if (attempt >= 3 && !dossier.email_verified) {
    dossier.name = dossier.name || fullNameFromEmail(email);
    const parsed = parseFullName(dossier.name, emailLocalPart, emailDomain);
    dossier.last_name = parsed.lastName;
    dossier.first_name = parsed.firstName;
  }

  dossier.research_attempts = attempt;

  dossier.verified = dossier.verified || hasUsefulVerifiedData(dossier);
  dossier.last_name = capitalizeWord(dossier.last_name);

  console.log(`[Research] Results for ${email}:`, {
    name: dossier.name,
    last_name: dossier.last_name,
    name_source: dossier.name_source,
    name_verified: dossier.name_verified,
    research_areas: dossier.research_areas,
    papers_found: dossier.papers?.length || 0,
    email_verified: dossier.email_verified,
    verified: dossier.verified
  });

  if (attempt === 1) cacheSet(cacheKey, dossier);

  return dossier;
}

export async function researchProfessorForced(email, sourceUrl, profileUrl) {
  // Fast path: single scrape attempt + AI enrichment
  console.log(`[Research] Fast attempt for ${email}`);
  const dossier = await researchProfessor(email, sourceUrl, profileUrl, 1);
  if (hasUsefulVerifiedData(dossier)) {
    return { dossier, found: true, attempts: 1 };
  }

  // AI-only fallback: skip further scraping, let AI fill gaps from email/university
  console.log(`[Research] No scraped data — AI-only enrichment for ${email}`);
  const emailLocalPart = email.split('@')[0];
  const emailDomain = email.split('@')[1] || '';
  try {
    const enriched = await researchWithAI({
      email,
      name: dossier.name || fullNameFromEmail(email),
      last_name: dossier.last_name,
      university: dossier.university || universityFromEmail(email),
      research_areas: dossier.research_areas || [],
      strict_email: email,
      note: 'No profile page found. Infer research areas and department from university domain and email context. Never merge homonymous professors.',
    });
    if (enriched?.research_areas?.length) dossier.research_areas = enriched.research_areas;
    if (sanitizeAIField(enriched?.verified_name) && isValidPersonName(enriched?.verified_name)) {
      dossier.name = enriched.verified_name;
      const parsed = parseFullName(enriched.verified_name, emailLocalPart, emailDomain);
      dossier.last_name = parsed.lastName;
      dossier.first_name = parsed.firstName;
      dossier.verified_name = enriched.verified_name;
      dossier.name_source = 'ai_verified';
    }
    if (sanitizeAIField(enriched?.department)) dossier.department = enriched.department;
    if (enriched?.research_areas?.length) dossier.email_verified = true;
    dossier.verified = true;
  } catch (e) {
    console.error('[Research] AI-only fallback failed:', e.message);
  }

  dossier.research_attempts = 1;
  dossier.verified = dossier.verified || hasUsefulVerifiedData(dossier);
  dossier.last_name = capitalizeWord(dossier.last_name);
  return { dossier, found: hasUsefulVerifiedData(dossier), attempts: 1 };
}

// Scrape an individual professor's profile page for full details
function parseProfileFromHtml(rawHtml, profileUrl) {
  const $ = cheerio.load(rawHtml);

  const email = extractEmailsFromHtml($)[0] || '';
  const emailLocalPart = email ? email.split('@')[0] : '';
  const emailDomain = email ? email.split('@')[1] || '' : '';

  const fields = extractProfilePageFields($, { profileUrl, rawHtml, email });
  let name = fields.name || extractNameFromJsonLd(rawHtml) || '';
  if (!name || isPageChromeText(name) || !isValidPersonName(name)) {
    const picked = pickBestProfileName(collectProfileNameCandidates($, profileUrl, rawHtml), { emailLocalPart });
    if (picked?.name) name = picked.name;
  }

  const parsed = parseFullName(name, emailLocalPart, emailDomain);
  const verification = verifyNameWithEmail(parsed.fullName, parsed.lastName, parsed.firstName, emailLocalPart);
  if (!verification.verified && name) {
    console.log(`[Profile:NameVerify] MISMATCH at ${profileUrl}: ${verification.mismatchDetail}`);
  }

  const title = fields.title || '';
  const department = fields.department || '';
  let research_areas = fields.research_areas || [];
  const root = getMainContentRoot($);
  const bodyText = root.text().replace(/\s+/g, ' ');

  const papers = [];
  root.find('[class*="publication"],[class*="paper"],[class*="article"],ol li,ul li').each((i, el) => {
    if (i >= 5 || papers.length >= 5) return;
    const text = $(el).text().trim();
    if (text.length > 30 && text.length < 500 && /\d{4}/.test(text)) {
      const year = text.match(/\d{4}/)?.[0] || '';
      papers.push({ title: text.slice(0, 150), year, source: 'profile' });
    }
  });

  let projects = [];
  const projectPatterns = [
    /research\s+projects?\s*[:\s]*(.*?)(?:\.|;|\n|<)/i,
    /current\s+projects?\s*(?:include|:)?\s*[:\s]*(.*?)(?:\.|;|\n|<)/i,
    /projects?\s*(?:include|:)\s*(.*?)(?:\.|;|\n|<)/i,
  ];
  for (const pat of projectPatterns) {
    const m = bodyText.match(pat);
    if (m) { projects = parseInterestKeywordList(m[1]); break; }
  }
  if (!projects.length) {
    root.find('[class*="project"],[id*="project"]').each((i, el) => {
      if (i >= 3 || projects.length >= 5) return;
      const text = $(el).text().trim().replace(/\s+/g, ' ');
      if (text.length > 20 && text.length < 400 && /project/i.test(text)) {
        const chunk = text.slice(0, 200);
        if (!projects.includes(chunk)) projects.push(chunk);
      }
    });
  }

  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.includes('scholar.google') || href.includes('researchgate') || href.includes('orcid.org')) {
      links.push(href.startsWith('http') ? href : `https://${href}`);
    }
  });

  return {
    name: parsed.fullName,
    last_name: parsed.lastName,
    first_name: parsed.firstName,
    name_source: fields.name_source || parsed.nameSource,
    name_verified: verification.verified,
    name_mismatch: verification.mismatchDetail,
    title,
    department,
    research_areas,
    papers,
    projects,
    email,
    links,
    profileUrl,
  };
}

export async function scrapeIndividualProfile(profileUrl) {
  const cached = profileCache.get(profileUrl);
  if (cached) return cached;

  try {
    let profile = null;

    // Attempt 1: Fast static fetch
    try {
      const res = await fetchPage(profileUrl);
      profile = parseProfileFromHtml(res.data, profileUrl);
    } catch (e) {
      console.log(`[Profile] Static fetch failed for ${profileUrl}: ${e.message}`);
    }

    // Self-healing: if static got a profile but key fields missing, try browser
    const hasGoodData = profile?.name && (profile.research_areas?.length || profile.papers?.length || profile.department);
    if (!hasGoodData) {
      try {
        const browserResult = await fetchWithBrowser(profileUrl, { captureJson: false });
        const browserHtml = typeof browserResult === 'string' ? browserResult : browserResult?.html;
        if (browserHtml) {
          const browserProfile = parseProfileFromHtml(browserHtml, profileUrl);
          profile = profile ? {
            ...profile,
            name: browserProfile.name || profile.name,
            last_name: browserProfile.last_name || profile.last_name,
            email: browserProfile.email || profile.email,
            department: browserProfile.department || profile.department,
            title: browserProfile.title || profile.title,
            research_areas: browserProfile.research_areas?.length ? browserProfile.research_areas : profile.research_areas,
            papers: browserProfile.papers?.length ? browserProfile.papers : profile.papers,
            projects: browserProfile.projects?.length ? browserProfile.projects : profile.projects,
            links: browserProfile.links?.length ? browserProfile.links : profile.links,
          } : browserProfile;
        }
      } catch (e) {
        console.log(`[Profile] Browser fallback also failed for ${profileUrl}: ${e.message}`);
      }
    }

    if (profile) cacheSet(profileUrl, profile);
    return profile;
  } catch (e) {
    console.error(`[Profile] Failed to scrape ${profileUrl}: ${e.message}`);
    return null;
  }
}

export async function buildProfessorDossier(prof) {
  const profileUrl = prof.profile_url || prof.source_url;

  // If scrape already found rich profile data (research areas + name), skip web search
  const scrapeResearchAreas = prof.research_areas
    ? (typeof prof.research_areas === 'string' ? prof.research_areas.split(',').map(s => s.trim()).filter(Boolean) : prof.research_areas)
    : [];
  const scrapePapers = Array.isArray(prof.papers) ? prof.papers : [];
  const scrapeProjects = Array.isArray(prof.projects) ? prof.projects : [];
  const fromDirectoryInterests = ['directory_table', 'directory_card', 'directory_dom', 'profile_deep_scrape'].includes(prof.research_source || prof.source);
  const hasRichProfileData = (
    (fromDirectoryInterests && scrapeResearchAreas.length >= 1 && prof.name)
    || (scrapeResearchAreas.length >= 2 && prof.name && prof.name.includes(' '))
    || (scrapeResearchAreas.length >= 1 && scrapePapers.length >= 2 && prof.name)
    || (scrapeProjects.length >= 1 && prof.name)
    || scrapeResearchAreas.length >= 3
  );

  let dossier;
  if (hasRichProfileData) {
    console.log(`[Dossier] Rich profile data for ${prof.email} — skipping web search`);
    dossier = {
      email: prof.email,
      name: prof.name,
      last_name: lastNameFromFullName(prof.name) || lastNameFromEmail(prof.email),
      university: universityFromEmail(prof.email),
      department: prof.department || '',
      title: prof.title || '',
      papers: scrapePapers,
      projects: scrapeProjects,
      research_areas: scrapeResearchAreas,
      profile_url: profileUrl || '',
      email_verified: true,
      verified: true,
      research_source: fromDirectoryInterests ? 'directory_card' : 'profile_data',
      research_evidence: [
        ...scrapeResearchAreas,
        ...scrapeProjects,
        ...scrapePapers.map(p => p.title || p),
      ].filter(Boolean).join('; '),
      name_source: prof.name_source || 'scrape',
      name_verified: true,
    };
  } else {
    dossier = await researchProfessor(prof.email, prof.source_url || '', profileUrl);

    if (prof.name && !dossier.email_verified) {
      dossier.name = prof.name;
      dossier.last_name = lastNameFromFullName(prof.name) || lastNameFromEmail(prof.email);
    }

    if (scrapeResearchAreas.length > 0 && (!dossier.research_areas || dossier.research_areas.length === 0)) {
      dossier.research_areas = scrapeResearchAreas;
    }
    if (scrapePapers.length > 0 && (!dossier.papers || dossier.papers.length === 0)) {
      dossier.papers = scrapePapers;
    }
    if (scrapeProjects.length > 0 && (!dossier.projects || dossier.projects.length === 0)) {
      dossier.projects = scrapeProjects;
    }
    if (scrapeResearchAreas.length > 0 || scrapePapers.length > 0 || scrapeProjects.length > 0) {
      dossier.research_evidence = [
        ...(dossier.research_areas || []),
        ...(dossier.projects || []),
        ...(dossier.papers || []).map(p => p.title || p),
      ].filter(Boolean).join('; ');
    }
  }

  dossier.roster = {
    full_name: dossier.name,
    email: prof.email,
    university: dossier.university,
    department: dossier.department || prof.department || '',
    designation: dossier.title || prof.title || '',
    phone: prof.phone || '',
    address: prof.address || '',
    research_interest: (dossier.research_areas || []).join(', '),
    profile_url: dossier.profile_url || profileUrl || '',
    email_verified: dossier.email_verified,
  };

  return dossier;
}

export async function scrapeFacultyPage(url, { onProgress, onFound, skipDesignations = [] } = {}) {
  console.log(`[Scrape] Starting: ${url}`);
  const startTime = Date.now();
  onProgress?.({ phase: 'discovering', current: 0, total: 0, label: 'Fetching faculty page…' });
  let html;
  let $ = null;
  let jsonPayloads = [];
  const htmlPages = [];
  const directoryFaculty = [];
  const emailSet = new Set();
  const directoryEmails = new Set();
  let profileLinks = [];
  const discoveryState = { emailSet, directoryFaculty, directoryEmails, profileLinks, onFound };

  // Step 1: Fast static fetch
  try {
    const res = await fetchPage(url);
    html = res.data;
    htmlPages.push(html);
    $ = cheerio.load(html);
    onProgress?.({ phase: 'discovering', current: 0, total: 0, label: `Page loaded (${((Date.now() - startTime) / 1000).toFixed(1)}s)` });
  } catch (e) {
    console.log(`[Scrape] Static fetch failed: ${e.message}`);
    onProgress?.({ phase: 'discovering', current: 0, total: 0, label: 'Static fetch failed — trying browser…' });
  }

  // Step 1b: Direct single-professor profile URL — parse page as one faculty record
  if (html && isLikelySingleProfileUrl(url)) {
    const mailtoCount = countFacultyMailtosOnPage(cheerio.load(html), isValidAcademicEmail);
    if (mailtoCount <= 2) {
      const profile = await scrapeIndividualProfile(url);
      if (profile?.email) {
        const prof = enrichProfessorTitle({
          email: profile.email.toLowerCase(),
          name: profile.name || '',
          last_name: profile.last_name || '',
          title: profile.title || '',
          department: profile.department || '',
          research_areas: profile.research_areas || [],
          papers: profile.papers || [],
          projects: profile.projects || [],
          source_url: url,
          profile_url: profile.profileUrl || url,
          profile_urls: [profile.profileUrl || url],
          research_source: 'profile_deep_scrape',
          name_source: profile.name_source || 'profile',
          name_verified: profile.name_verified || false,
        });
        onProgress?.({ phase: 'discovered', current: 1, total: 1, label: `Profile page: ${prof.name || prof.email}` });
        console.log(`[Scrape] Single profile URL: ${prof.name || prof.email}`);
        return [prof];
      }
    } else {
      console.log(`[Scrape] URL looks like profile path but page has ${mailtoCount} faculty emails — treating as directory`);
    }
  }

  // Step 2: Structured directory + JSON-LD + regex fallback
  if ($) {
    profileLinks = mergeDiscoveriesFromPage($, url, discoveryState);
    if (directoryFaculty.length > 0) {
      console.log(`[Scrape] Directory/JSON-LD found ${directoryFaculty.length} faculty`);
      onProgress?.({ phase: 'discovering', current: directoryFaculty.length, total: directoryFaculty.length, label: `Found ${directoryFaculty.length} faculty from structured data` });
    }
    if (emailSet.size > 0) {
      onProgress?.({ phase: 'discovering', current: emailSet.size, total: emailSet.size, label: `Found ${emailSet.size} emails from HTML` });
    }
    console.log(`[Scrape] Static HTML: ${emailSet.size} emails (${directoryFaculty.length} structured), ${profileLinks.length} profile links`);
  }

  // Step 3: Browser when static is thin, JS-driven, collapsed interests, or many unlinked profiles
  const interestPanels = $ ? hasDirectoryInterestPanels($) : false;
  const sparseInterests = directoryFaculty.length >= 5
    && directoryFaculty.filter(f => (f.research_areas || []).length > 0).length < directoryFaculty.length * 0.3;
  const needsBrowser = emailSet.size === 0 || hasLoadMoreIndicators($) || interestPanels || sparseInterests
    || (profileLinks.length > emailSet.size && emailSet.size < 50)
    || (profileLinks.length >= 10 && emailSet.size < profileLinks.length * 0.5)
    || (directoryFaculty.length >= 5 && emailSet.size < directoryFaculty.length);
  if (needsBrowser) {
    onProgress?.({ phase: 'discovering', current: emailSet.size, total: emailSet.size, label: 'Launching browser for JS content…' });
    console.log(`[Scrape] Trying browser rendering...`);
    const browserResult = await fetchWithBrowser(url, { captureJson: true });
    const browserHtml = typeof browserResult === 'string' ? browserResult : browserResult?.html;
    if (browserResult?.jsonPayloads?.length) jsonPayloads.push(...browserResult.jsonPayloads);
    if (browserHtml) {
      html = browserHtml;
      if (!htmlPages.includes(browserHtml)) htmlPages.push(browserHtml);
      $ = cheerio.load(browserHtml);
      profileLinks = mergeDiscoveriesFromPage($, url, discoveryState);
      onProgress?.({ phase: 'discovering', current: emailSet.size, total: emailSet.size, label: `Browser found ${emailSet.size} emails` });
      console.log(`[Scrape] Browser: ${emailSet.size} emails`);
    }
  }

  // Step 3b: "View All" link — follow before pagination to potentially get all on one page
  if ($) {
    const viewAllUrl = findViewAllLink($, url);
    if (viewAllUrl) {
      console.log(`[Scrape] Found "View All" link: ${viewAllUrl}`);
      onProgress?.({ phase: 'discovering', current: emailSet.size, total: emailSet.size, label: 'Following "View All" link…' });
      try {
        const res = await fetchPage(viewAllUrl);
        htmlPages.push(res.data);
        const page$ = cheerio.load(res.data);
        profileLinks = mergeDiscoveriesFromPage(page$, viewAllUrl, discoveryState);
        console.log(`[Scrape] After "View All": ${emailSet.size} emails`);
      } catch (e) { console.error(`[Scrape] View All failed: ${e.message}`); }
    }
  }

  // Step 3c: Department sidebar — crawl sub-pages if result count seems low
  if ($ && emailSet.size < 20) {
    const sidebarLinks = findDepartmentSidebarLinks($, url);
    if (sidebarLinks.length > 0) {
      onProgress?.({ phase: 'discovering', current: emailSet.size, total: emailSet.size, label: `Checking ${sidebarLinks.length} department links…` });
      for (const deptUrl of sidebarLinks) {
        try {
          await delay(300);
          const res = await fetchPage(deptUrl);
          htmlPages.push(res.data);
          const page$ = cheerio.load(res.data);
          profileLinks = mergeDiscoveriesFromPage(page$, deptUrl, discoveryState);
        } catch (e) { console.error(`[Scrape] Dept link failed: ${e.message}`); }
      }
      console.log(`[Scrape] After dept sidebar: ${emailSet.size} emails`);
    }
  }

  // Step 4: Pagination — static pages first, then browser pagination for load-more / next links
  if ($) {
    const paginationLinks = findPaginationLinks($, url);
    if (paginationLinks.length > 0) {
      onProgress?.({ phase: 'discovering', current: 0, total: paginationLinks.length, label: `Scraping ${paginationLinks.length} paginated pages…`, step: 'pagination' });
      let pageIdx = 0;
      for (const pageUrl of paginationLinks) {
        pageIdx++;
        try {
          await delay(300);
          const res = await fetchPage(pageUrl);
          htmlPages.push(res.data);
          const page$ = cheerio.load(res.data);
          profileLinks = mergeDiscoveriesFromPage(page$, pageUrl, discoveryState);
          onProgress?.({ phase: 'discovering', current: pageIdx, total: paginationLinks.length, label: `Page ${pageIdx}/${paginationLinks.length} scanned — ${emailSet.size} emails`, step: 'pagination' });
        } catch (e) { console.error(`[Scrape] Pagination failed:`, e.message); }
      }
    }

    const useBrowserPagination = paginationLinks.length > 0 || hasLoadMoreIndicators($) ||
      (profileLinks.length > emailSet.size && emailSet.size < 30);

    if (useBrowserPagination) {
      onProgress?.({ phase: 'discovering', current: emailSet.size, total: emailSet.size, label: 'Browser pagination — loading all pages…' });
      const browserPages = await fetchPaginatedPagesWithBrowser(url);
      let browserPageIdx = 0;
      for (const pageHtml of browserPages) {
        browserPageIdx++;
        if (!htmlPages.includes(pageHtml)) htmlPages.push(pageHtml);
        const page$ = cheerio.load(pageHtml);
        profileLinks = mergeDiscoveriesFromPage(page$, url, discoveryState);
        onProgress?.({ phase: 'discovering', current: browserPageIdx, total: browserPages.length, label: `Browser page ${browserPageIdx}/${browserPages.length} — ${emailSet.size} emails`, step: 'pagination' });
      }
      console.log(`[Scrape] After browser pagination: ${emailSet.size} emails, ${profileLinks.length} profiles`);
    }
  }

  // Step 4b: Context-aware filtering — remove footer/sidebar/non-faculty emails
  const allHtml$ = cheerio.load(htmlPages.map(h => h || '').join(''));
  for (const email of emailSet) {
    if (!isLikelyFacultyEmail(allHtml$, email)) {
      console.log(`[Scrape] Filtered non-faculty email: ${email}`);
      emailSet.delete(email);
    }
  }

  let emails = [...emailSet];

  // Step 5: JSON API payloads (XHR) from browser
  const jsonProfessors = extractProfessorsFromJsonPayloads(jsonPayloads, url);
  if (jsonProfessors.length > 0) {
    console.log(`[Scrape] JSON API found ${jsonProfessors.length} professors`);
    for (const p of jsonProfessors) {
      if (!emails.includes(p.email)) emails.push(p.email);
    }
  }

  // Step 6: Crawl profile links when main page has few/no emails
  if (emails.length === 0 && profileLinks.length > 0) {
    const toVisit = profileLinks.slice(0, 200);
    onProgress?.({ phase: 'discovering', current: 0, total: toVisit.length, label: `Crawling ${toVisit.length} profile pages for emails…` });
    console.log(`[Scrape] Crawling ${toVisit.length} profiles for emails...`);
    const BATCH = 5;
    for (let b = 0; b < toVisit.length; b += BATCH) {
      const batch = toVisit.slice(b, b + BATCH);
      const results = await Promise.allSettled(batch.map(link => scrapeIndividualProfile(link.url)));
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value?.email) emails.push(r.value.email);
      }
      onProgress?.({ phase: 'discovering', current: Math.min(b + BATCH, toVisit.length), total: toVisit.length, label: `${emails.length} emails from ${Math.min(b + BATCH, toVisit.length)}/${toVisit.length} profiles` });
      if (b + BATCH < toVisit.length) await delay(200);
    }
  }

  // Step 7: Also visit unmatched profile links when we have emails but many unlinked profiles
  if (emails.length > 0 && profileLinks.length > emails.length) {
    const unmatched = profileLinks.filter(l => !emails.some(e => scoreProfileLinkMatch(l, e) >= 2)).slice(0, 150);
    if (unmatched.length > 0) {
      onProgress?.({ phase: 'discovering', current: 0, total: unmatched.length, label: `Checking ${unmatched.length} extra profile links…` });
      const BATCH = 5;
      for (let b = 0; b < unmatched.length; b += BATCH) {
        const batch = unmatched.slice(b, b + BATCH);
        const results = await Promise.allSettled(batch.map(link => scrapeIndividualProfile(link.url)));
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value?.email && !emails.includes(r.value.email)) {
            emails.push(r.value.email);
          }
        }
        if (b + BATCH < unmatched.length) await delay(200);
      }
    }
  }

  // Step 8: AI fallback
  if (emails.length === 0 && html) {
    onProgress?.({ phase: 'discovering', current: 0, total: 0, label: 'Using AI to extract emails…' });
    console.log('[Scrape] Trying AI extraction...');
    try {
      const pageText = cheerio.load(html)('body').text().replace(/\s+/g, ' ').slice(0, 8000);
      const aiResult = await extractEmailsWithAI(pageText);
      if (aiResult?.professors?.length > 0) {
        const validated = aiResult.professors.filter(p => p.email && isValidAcademicEmail(p.email.toLowerCase()));
        console.log(`[Scrape] AI found ${validated.length} professors`);
        onProgress?.({ phase: 'discovered', current: validated.length, total: validated.length, label: `AI found ${validated.length} professors` });
        return validated.map(p => ({
          email: p.email.toLowerCase(),
          last_name: p.name ? p.name.split(/\s+/).filter(Boolean).pop() : p.email.split('@')[0].split('.').pop(),
          name: p.name || '',
          source_url: url,
        }));
      }
    } catch (e) { console.error('[Scrape] AI extraction failed:', e.message); }
  }

  // Merge JSON professors into list first
  if (jsonProfessors.length > 0 && emails.length === 0) {
    onProgress?.({ phase: 'discovered', current: jsonProfessors.length, total: jsonProfessors.length, label: `Found ${jsonProfessors.length} professors from API` });
    return jsonProfessors;
  }

  // Step 9: Build professor list
  onProgress?.({ phase: 'discovering', current: emails.length, total: emails.length, label: `Extracting context for ${emails.length} professors…` });
  const jsonByEmail = new Map(jsonProfessors.map(p => [p.email, p]));
  const dirByEmail = new Map(directoryFaculty.map(f => [f.email, f]));
  const professors = [];

  for (const email of emails) {
    const fromJson = jsonByEmail.get(email);
    if (fromJson) {
      professors.push({ ...fromJson, email });
      continue;
    }
    const fromDir = dirByEmail.get(email);
    const context = $ ? extractProfessorContext($, email) : { name: '', last_name: '', first_name: '', department: '', title: '', name_source: 'none', name_verified: false, name_mismatch: null };
    const name = fromDir?.name || context.name || fullNameFromEmail(email) || '';
    const dirAreas = fromDir?.research_areas
      ? (Array.isArray(fromDir.research_areas) ? fromDir.research_areas : String(fromDir.research_areas).split(',').map(s => s.trim()).filter(Boolean))
      : [];
    professors.push({
      email,
      last_name: context.last_name || (name ? name.split(/\s+/).filter(Boolean).pop() : '') || lastNameFromEmail(email),
      name,
      department: fromDir?.department || context.department || '',
      title: fromDir?.title || context.title || '',
      phone: fromDir?.phone || '',
      address: fromDir?.address || '',
      research_areas: dirAreas,
      papers: [],
      projects: [],
      source_url: url,
      profile_url: fromDir?.profileUrl || '',
      profile_urls: fromDir?.profileUrls || (fromDir?.profileUrl ? [fromDir.profileUrl] : []),
      research_source: fromDir?.source || (fromDir ? 'directory_card' : (context.name_source || 'none')),
      name_source: fromDir?.source || (fromDir ? 'directory_card' : (context.name_source || 'none')),
      name_verified: context.name_verified || false,
      name_mismatch: context.name_mismatch || null,
      scrape_steps: [],
    });
    onFound?.({ email, name, step: 'confirmed' });
  }

  // Step 10: Match profile URLs — collect every candidate link (1 or many per professor)
  if (profileLinks.length > 0 && professors.length > 0) {
    for (const prof of professors) {
      const matched = findProfileLinksForProfessor(profileLinks, prof.email, prof.name);
      prof._profileLinkCandidates = matched;
      const ranked = rankProfileUrlsForProfessor([
        prof.profile_url && { url: prof.profile_url, nearEmail: true, text: prof.name },
        ...(prof.profile_urls || []).map(u => ({ url: u, nearEmail: true })),
        ...matched.map(l => ({ url: l.url, text: l.name, nearEmail: l.nearEmail })),
      ], { email: prof.email, name: prof.name });
      prof.profile_urls = ranked.map(r => r.url);
      if (ranked[0]?.url) prof.profile_url = ranked[0].url;
    }
  }

  // Step 11: Deep scrape — open each professor's profile URL(s) in small parallel batches.
  // If a card has 2+ links (Profile, CV, Scholar), try ranked URLs until rich data is found.
  const profsToDeepScrape = professors.filter(p => p.profile_url || (p.profile_urls?.length > 0) || p._profileLinkCandidates?.length > 0);
  const deepTotal = profsToDeepScrape.length;
  if (deepTotal > 0) {
    onProgress?.({ phase: 'deep_scraping', current: 0, total: deepTotal, label: `Opening ${deepTotal} professor profile pages…` });
    console.log(`[Scrape] Deep scraping ${deepTotal} professors (${profsToDeepScrape.filter(p => (p.profile_urls?.length || 0) > 1).length} with multiple profile links)`);
    const BATCH = 3;
    let deepDone = 0;
    let deepSuccess = 0;
    for (let b = 0; b < profsToDeepScrape.length; b += BATCH) {
      const batch = profsToDeepScrape.slice(b, b + BATCH);
      const results = await Promise.allSettled(batch.map(async (prof) => {
        const result = await deepScrapeProfessorProfiles(prof, {
          scrapeFn: scrapeIndividualProfile,
          maxUrls: 4,
          onStep: (step) => onFound?.({ email: prof.email, name: prof.name, step: step.phase, url: step.url, status: step.status }),
        });
        applyDeepScrapeToProfessor(prof, result);
        return { prof, result };
      }));
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const { prof, result } = r.value;
        if (result?.urlsSucceeded > 0) {
          deepSuccess++;
          onFound?.({ email: prof.email, name: prof.name, step: 'deep_scrape_done', urlsTried: result.urlsTried, urlsOk: result.urlsSucceeded });
        }
      }
      deepDone = Math.min(b + BATCH, deepTotal);
      onProgress?.({
        phase: 'deep_scraping',
        current: deepDone,
        total: deepTotal,
        label: `${deepDone}/${deepTotal} profiles processed (${deepSuccess} with data)`,
        step: 'deep_scrape',
      });
      if (b + BATCH < profsToDeepScrape.length) await delay(200);
    }
    console.log(`[Scrape] Deep scrape done: ${deepSuccess}/${deepTotal} professors returned profile data`);
  }

  // Step 11b: Name-only match when no profile_url yet
  const profsWithoutResearch = professors.filter(p =>
    !p.profile_url
    && !(Array.isArray(p.research_areas) ? p.research_areas : []).length
    && !(p.papers || []).length
  );
  if (profsWithoutResearch.length > 0 && profileLinks.length > 0) {
    for (const prof of profsWithoutResearch) {
      if (!prof.name || prof.name.length < 3) continue;
      const matched = findProfileLinksForProfessor(profileLinks, prof.email, prof.name);
      if (!matched.length) continue;
      prof._profileLinkCandidates = matched;
      prof.profile_urls = matched.map(m => m.url);
      prof.profile_url = matched[0].url;
      try {
        const result = await deepScrapeProfessorProfiles(prof, {
          scrapeFn: scrapeIndividualProfile,
          maxUrls: 3,
        });
        applyDeepScrapeToProfessor(prof, result);
      } catch { /* skip */ }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const { kept, skipped } = filterProfessorsByDesignation(professors, skipDesignations);
  const enriched = kept.map(p => enrichProfessorTitle(p));
  const professorCount = enriched.filter(p => p.is_professor_rank).length;
  if (professorCount > 0) {
    console.log(`[Scrape] ${professorCount}/${enriched.length} have Professor rank in designation`);
  }
  if (skipped.length > 0) {
    console.log(`[Scrape] Skipped ${skipped.length} professor(s) by designation filter`);
    onProgress?.({ phase: 'discovered', current: enriched.length, total: enriched.length, label: `Skipped ${skipped.length} by designation · ${enriched.length} faculty kept (${professorCount} professors)` });
  }

  onProgress?.({ phase: 'discovered', current: enriched.length, total: enriched.length, label: `Found ${enriched.length} professors in ${elapsed}s` });
  console.log(`[Scrape] Final: ${enriched.length} professors from ${url} (${elapsed}s, ${skipped.length} skipped by designation)`);
  return enriched;
}
