import * as cheerio from 'cheerio';
import { extractBestProfileUrl } from './profileUrlResolver.js';
import { isValidPersonName } from '../utils/professor.js';
import { extractTitleFromText, enrichProfessorTitle } from './facultyTitle.js';

const INTEREST_HEADER =
  /\bareas?\s+of\s+interest\b|\bresearch\s+interests?\b|\bresearch\s+area\b|\bfields?\s+of\s+interest\b|\bexpertise\b|\bspecialization\b/i;
const INTEREST_TRIGGER =
  /\bareas?\s+of\s+interest\b|\bresearch\s+interests?\b|view\s+interest|expertise|\bresearch\s+area\b|show\s+more|read\s+more/i;
const FOOTER_SIDEBAR = 'footer, aside, nav, [class*="footer"], [class*="sidebar"], [class*="widget"], [id*="footer"], [id*="sidebar"]';

const CARD_CONTAINER_SEL = [
  'article', 'li', 'tr', '.vcard', '[itemtype*="Person"]',
  'div[class*="faculty"]', 'div[class*="person"]', 'div[class*="profile"]',
  'div[class*="member"]', 'div[class*="staff"]', 'div[class*="card"]',
  'div[class*="team"]', 'div[class*="directory"]', 'div[class*="listing"]',
  'div[class*="people"]', 'div[class*="col-"]', 'div[class*="grid"]',
  'section[class*="faculty"]', 'section[class*="person"]',
].join(', ');

const FIELD_LABELS = {
  department: /^(department|dept\.?|school|division|unit)\s*:?\s*$/i,
  phone: /^(phone|tel|telephone|office\s+phone|contact)\s*:?\s*$/i,
  address: /^(address|office|location|room|building)\s*:?\s*$/i,
  title: /^(title|position|rank|designation|role)\s*:?\s*$/i,
  email: /^e-?mail\s*:?\s*$/i,
  name: /^name\s*:?\s*$/i,
};

const EMAIL_IN_TEXT = /[a-zA-Z0-9][\w.-]*@[a-zA-Z0-9][\w.-]*\.[a-z]{2,}/i;

function normalizeFieldKey(label) {
  const l = label.toLowerCase().replace(/:+$/, '').trim();
  if (FIELD_LABELS.department.test(l)) return 'department';
  if (FIELD_LABELS.phone.test(l)) return 'phone';
  if (FIELD_LABELS.address.test(l)) return 'address';
  if (FIELD_LABELS.title.test(l)) return 'title';
  if (FIELD_LABELS.email.test(l)) return 'email';
  if (FIELD_LABELS.name.test(l)) return 'name';
  if (INTEREST_HEADER.test(l)) return 'research_interest';
  return l.replace(/\s+/g, '_');
}

/** Walk child elements inside one professor div — like reading F12 Elements panel for that card. */
export function extractLabeledFieldsFromContainer($, $container) {
  const fields = {};

  $container.find('dt').each((_, el) => {
    const label = $(el).text().trim();
    const value = $(el).next('dd').text().trim();
    if (label && value) fields[normalizeFieldKey(label)] = value;
  });

  $container.find('tr').each((_, el) => {
    const cells = $(el).find('th, td');
    if (cells.length >= 2) {
      const label = $(cells[0]).text().trim();
      const value = $(cells[1]).text().trim();
      if (label && value && label.length < 60) fields[normalizeFieldKey(label)] = value;
    }
  });

  $container.find('p, div, li, span, label').each((_, el) => {
    const $el = $(el);
    if ($el.children('p, div, ul, ol, table').length > 1) return;

    const labelEl = $el.children('strong, b, label').first();
    if (labelEl.length) {
      const label = labelEl.text().replace(/:+\s*$/, '').trim();
      const value = $el.text().replace(labelEl.text(), '').replace(/^:+\s*/, '').trim();
      if (label && value && label.length < 60 && value.length < 500) {
        fields[normalizeFieldKey(label)] = value;
      }
      return;
    }

    const text = $el.text().replace(/\s+/g, ' ').trim();
    const colon = text.match(/^([^:]{2,50}):\s*(.+)$/);
    if (colon && colon[2].length < 500) {
      fields[normalizeFieldKey(colon[1])] = colon[2].trim();
    }
  });

  const mailto = $container.find('a[href*="mailto:"]').first();
  if (mailto.length) {
    const m = (mailto.attr('href') || '').match(/mailto:([^?&"'\s]+)/i);
    if (m) fields.email = m[1].toLowerCase().trim();
  }
  if (!fields.email) {
    const match = $container.text().match(EMAIL_IN_TEXT);
    if (match) fields.email = match[0].toLowerCase();
  }

  return fields;
}

function scoreProfessorContainer($, $el) {
  if ($el.closest(FOOTER_SIDEBAR).length) return -1;
  let score = 0;
  if ($el.find('h1, h2, h3, h4, h5').length) score += 2;
  if ($el.find('a[href*="mailto:"]').length === 1) score += 4;
  if ($el.find('a[href*="mailto:"]').length > 1) score -= 2;
  if (INTEREST_HEADER.test($el.text())) score += 2;
  if (/professor|faculty|lecturer|associate|assistant|emeritus/i.test($el.text())) score += 1;
  const len = ($el.text() || '').length;
  if (len > 5000) score -= 4;
  if (len < 30) score -= 3;
  return score;
}

/** Find repeating sibling divs in a grid (2-per-row cards, etc.) — same structure as F12 Elements tree. */
export function findRepeatingProfessorContainers($) {
  const out = [];
  const seenKeys = new Set();

  $('div, article, li, section').each((_, parent) => {
    const $parent = $(parent);
    if ($parent.closest(FOOTER_SIDEBAR).length) return;

    const groups = new Map();
    $parent.children('div, article, li, section').each((__, child) => {
      const $c = $(child);
      const cls = ($c.attr('class') || '').trim();
      const key = cls || $c.prop('tagName')?.toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push($c);
    });

    for (const [cls, siblings] of groups) {
      if (siblings.length < 2) continue;
      const looksLikeGrid = /col-|card|faculty|person|profile|member|staff|people|grid|item|tile|block/i.test(cls)
        || siblings.every(s => scoreProfessorContainer($, s) >= 2);
      if (!looksLikeGrid) continue;

      for (const $card of siblings) {
        const mailtoCount = $card.find('a[href*="mailto:"]').length;
        if (mailtoCount > 1) continue;
        if (scoreProfessorContainer($, $card) < 2) continue;
        const dedupe = $card.find('a[href*="mailto:"]').attr('href')
          || $card.find('h1, h2, h3, h4, h5').first().text().trim()
          || ($card.attr('id') || '') + cls;
        if (!dedupe || seenKeys.has(dedupe)) continue;
        seenKeys.add(dedupe);
        out.push($card);
      }
    }
  });

  return out;
}

function professorRecordFromContainer($, $card, { baseUrl, isLikelyFaculty } = {}) {
  const cardText = $card.text() || '';
  if (isLikelyFaculty && !isLikelyFaculty('', cardText)) return null;

  const fields = extractLabeledFieldsFromContainer($, $card);
  const research_areas = fields.research_interest
    ? parseInterestKeywordList(fields.research_interest)
    : extractAreaOfInterestFromNode($, $card);

  let name = fields.name || '';
  if (!name) {
    const heading = $card.find('h1, h2, h3, h4, h5, a[class*="name"], [class*="name"]').first().text().trim();
    if (heading && !heading.includes('@') && isValidPersonName(heading)) name = heading;
  }
  if (!name) {
    const profileLink = $card.find('a[href*="profile"], a[href*="faculty"], a[href*="people"], a[href*="staff"]').first();
    const t = profileLink.text().trim();
    if (t && t.length >= 3 && !t.includes('@') && isValidPersonName(t)) name = t;
  }

  let title = fields.title || '';
  if (!title) {
    title = $card.find('[class*="title"], [class*="position"], [class*="role"], .rank, .designation').first().text().trim();
  }
  if (!title) title = extractTitleFromText(cardText);

  const email = (fields.email || '').toLowerCase().trim();
  if (!email) return null;

  const { profileUrl, profileUrls } = extractBestProfileUrl($, $card, baseUrl);

  return enrichProfessorTitle({
    email,
    name,
    title,
    department: fields.department || $card.find('[class*="dept"], [class*="department"]').first().text().trim(),
    phone: fields.phone || '',
    address: fields.address || '',
    research_areas,
    profileUrl,
    profileUrls,
    source: 'directory_dom',
    dom_fields: fields,
    _cardText: cardText,
  });
}

/**
 * F12-style DOM extraction: find each professor's div in the page tree,
 * walk its child elements, and pull labeled fields (name, email, dept, interests…).
 */
export function extractFacultyFromDomContainers($, { isValidEmail, seenEmails, baseUrl, isLikelyFaculty } = {}) {
  const results = [];

  for (const $card of findRepeatingProfessorContainers($)) {
    const record = professorRecordFromContainer($, $card, { baseUrl, isLikelyFaculty });
    if (!record) continue;
    if (!isValidEmail?.(record.email) || seenEmails.has(record.email)) continue;
    seenEmails.add(record.email);
    results.push(record);
  }

  return results;
}

export function parseInterestKeywordList(text) {
  if (!text) return [];
  return [...new Set(
    String(text)
      .split(/[,;•·|\n]+/)
      .map(s => s
        .trim()
        .replace(/^and\s+/i, '')
        // Remove accordion header fragments accidentally captured in the first token
        .replace(/^(areas?\s+of\s+interest|research\s+interests?|research\s+area|fields?\s+of\s+interest)\s*/i, '')
        .replace(/\s+/g, ' ')
      )
      .filter(s => s.length >= 3 && s.length < 100 && !/^(areas?\s+of\s+interest|research\s+interests?|click|more|view|show|hide)$/i.test(s)),
  )];
}

function extractLabeledValue($, $node, labelPattern) {
  let value = '';
  $node.find('dt, th, label, strong, b, span, div, p, td').each((_, el) => {
    if (value) return;
    const label = $(el).text().trim();
    if (!labelPattern.test(label) || label.length > 60) return;
    const next = $(el).next();
    if (next.length) {
      const t = next.text().trim();
      if (t && t !== label) { value = t; return; }
    }
    const parent = $(el).parent();
    const remainder = parent.text().replace(label, '').trim();
    if (remainder && remainder.length < 200) value = remainder;
  });
  return value.replace(/\s+/g, ' ').trim();
}

function extractSelectInterests($, $node) {
  const keywords = new Set();
  $node.find('select option, datalist option').each((_, el) => {
    const t = $(el).text().trim();
    if (t && !/^(select|choose|all|--|none)$/i.test(t)) keywords.add(t);
  });
  return [...keywords];
}

/** Extract research keywords from a directory card/row — including collapsed dropdown panels. */
export function extractAreaOfInterestFromNode($, node) {
  const $node = $(node);
  const keywords = new Set();

  extractSelectInterests($, $node).forEach(k => keywords.add(k));

  $node.find('details, .collapse, .accordion-body, .dropdown-menu, [class*="interest"], [class*="research-area"], [class*="expertise"], [aria-expanded="true"]').each((_, el) => {
    parseInterestKeywordList($(el).text()).forEach(k => keywords.add(k));
  });

  $node.find('ul li, ol li').each((_, el) => {
    const parent = $(el).parent().prev();
    const prevText = parent.text() || $(el).closest('div').find('strong, b, label').first().text() || '';
    if (INTEREST_HEADER.test(prevText) || INTEREST_HEADER.test($(el).closest('div, section').find('> strong, > b, > h3, > h4').first().text())) {
      parseInterestKeywordList($(el).text()).forEach(k => keywords.add(k));
    }
  });

  $node.find('th, td, dt, label, strong, b, span, div, p').each((_, el) => {
    const label = $(el).text().trim();
    if (!INTEREST_HEADER.test(label) || label.length > 80) return;
    const next = $(el).next();
    if (next.length) parseInterestKeywordList(next.text()).forEach(k => keywords.add(k));
    const parent = $(el).parent();
    const remainder = parent.text().replace(label, '').trim();
    parseInterestKeywordList(remainder).forEach(k => keywords.add(k));
  });

  const full = $node.text();
  const m = full.match(/areas?\s+of\s+interest[:\s]+([\s\S]{3,500}?)(?:phone|email|address|department|$)/i)
    || full.match(/research\s+interests?[:\s]+([\s\S]{3,500}?)(?:phone|email|address|department|$)/i);
  if (m) parseInterestKeywordList(m[1]).forEach(k => keywords.add(k));

  return [...keywords].slice(0, 15);
}

function headerIndex(headers, pattern) {
  return headers.findIndex(h => pattern.test(h));
}

function pickCardContainer($, $mailto) {
  const candidates = [];
  let $el = $mailto.parent();
  for (let depth = 0; depth < 8 && $el.length; depth++) {
    if ($el.is(FOOTER_SIDEBAR) || $el.closest(FOOTER_SIDEBAR).length) return null;
    if ($el.is(CARD_CONTAINER_SEL)) {
      const mailtoCount = $el.find('a[href*="mailto:"]').length;
      candidates.push({ $el, mailtoCount, depth });
    }
    $el = $el.parent();
  }
  if (!candidates.length) {
    const row = $mailto.closest('tr, li, article, div');
    return row.length ? row : $mailto.parent();
  }
  candidates.sort((a, b) => {
    if (a.mailtoCount !== b.mailtoCount) return a.mailtoCount - b.mailtoCount;
    return b.depth - a.depth;
  });
  const best = candidates.find(c => c.mailtoCount <= 2) || candidates[0];
  return best.$el;
}

function extractNameFromCard($, $card, $mailto) {
  const headings = $card.find('h1, h2, h3, h4, h5, h6, a[class*="name"], [class*="name"]');
  for (let i = 0; i < headings.length; i++) {
    const t = $(headings[i]).text().trim();
    if (t && t.length >= 3 && t.length < 80 && !t.includes('@')
      && !/^(email|phone|department)$/i.test(t)
      && isValidPersonName(t)
      && !/^skip\s+to\b/i.test(t)) return t;
  }
  const linkText = $mailto.text().trim();
  if (linkText && !linkText.includes('@') && linkText.length >= 3 && isValidPersonName(linkText)) return linkText;
  const profileLink = $card.find('a[href*="profile"], a[href*="faculty"], a[href*="people"], a[href*="staff"]').first();
  if (profileLink.length) {
    const t = profileLink.text().trim();
    if (t && t.length >= 3 && !t.includes('@') && isValidPersonName(t)) return t;
  }
  const strong = $card.find('strong, b').first().text().trim();
  if (strong && isValidPersonName(strong)) return strong;
  return '';
}

function extractProfileUrl($, $card, baseUrl, ctx = {}) {
  const { profileUrl, profileUrls } = extractBestProfileUrl($, $card, baseUrl, ctx);
  return profileUrl;
}

/**
 * Mailto-centric card extraction — reliable for 2-column grid faculty directories.
 * Each mailto link maps to the smallest card-like container on the page.
 */
export function extractFacultyFromMailtoCards($, { isValidEmail, seenEmails, baseUrl, isLikelyFaculty } = {}) {
  const results = [];

  $('a[href*="mailto:"]').each((_, el) => {
    if ($(el).closest(FOOTER_SIDEBAR).length) return;

    const href = $(el).attr('href') || '';
    const m = href.match(/mailto:([^?&"'\s]+)/i);
    if (!m) return;
    const email = m[1].toLowerCase().trim();
    if (!isValidEmail?.(email) || seenEmails.has(email)) return;

    const $card = pickCardContainer($, $(el));
    if (!$card || !$card.length) return;

    const cardText = $card.text() || '';
    if (isLikelyFaculty && !isLikelyFaculty('', cardText)) return;

    const name = extractNameFromCard($, $card, $(el));
    let title = extractLabeledValue($, $card, FIELD_LABELS.title);
    if (!title) {
      title = $card.find('[class*="title"], [class*="position"], [class*="role"], .rank, .designation').first().text().trim();
    }
    const department = extractLabeledValue($, $card, FIELD_LABELS.department)
      || $card.find('[class*="dept"], [class*="department"], .department').first().text().trim();
    const phone = extractLabeledValue($, $card, FIELD_LABELS.phone);
    const address = extractLabeledValue($, $card, FIELD_LABELS.address);
    const research_areas = extractAreaOfInterestFromNode($, $card);
    const { profileUrl, profileUrls } = extractBestProfileUrl($, $card, baseUrl);

    seenEmails.add(email);
    results.push({
      email,
      name,
      title,
      department,
      phone,
      address,
      research_areas,
      profileUrl,
      profileUrls,
      source: 'directory_card',
    });
  });

  return results;
}

/** True when page likely hides interests behind JS toggles — needs browser expand. */
export function hasDirectoryInterestPanels($) {
  if (!$) return false;
  let triggers = 0;
  $('a, button, summary, [role="button"], [data-toggle], [data-bs-toggle], [aria-expanded="false"]').each((_, el) => {
    const t = `${$(el).text() || ''} ${$(el).attr('aria-label') || ''} ${$(el).attr('title') || ''}`.toLowerCase();
    if (INTEREST_TRIGGER.test(t)) triggers++;
  });
  if (triggers >= 2) return true;
  if ($('[class*="interest"][class*="collapse"], .accordion, details:not([open])').length >= 2) return true;
  return $('select option').length >= 6 && INTEREST_HEADER.test($('body').text());
}

/** Parse faculty directory tables with Area of Interest column + expandable cells. */
export function extractFacultyFromInterestTable($, { isValidEmail, seenEmails }) {
  const results = [];

  $('table').each((_, table) => {
    const $table = $(table);
    if ($table.closest('footer, aside, nav').length) return;

    let headerCells = $table.find('thead tr').first().find('th, td');
    if (!headerCells.length) headerCells = $table.find('tr').first().find('th, td');
    const headers = headerCells.map((_, el) => $(el).text().trim().toLowerCase()).get();
    if (!headers.length) return;

    const emailIdx = headerIndex(headers, /e-?mail/);
    const nameIdx = headerIndex(headers, /^(name|faculty|member)/);
    const deptIdx = headerIndex(headers, /dept|department/);
    const titleIdx = headerIndex(headers, /title|designation|rank|position|role/);
    const phoneIdx = headerIndex(headers, /phone|tel/);
    const addressIdx = headerIndex(headers, /address|office|location|room/);
    const interestIdx = headerIndex(headers, INTEREST_HEADER);
    if (emailIdx < 0 && interestIdx < 0) return;

    const bodyRows = $table.find('tbody tr').length ? $table.find('tbody tr') : $table.find('tr').slice(1);
    bodyRows.each((_, row) => {
      const $row = $(row);
      const cells = $row.find('td');
      if (!cells.length) return;

      let email = '';
      if (emailIdx >= 0) {
        const mailto = cells.eq(emailIdx).find('a[href*="mailto:"]').first();
        if (mailto.length) {
          const em = (mailto.attr('href') || '').match(/mailto:([^?&"'\s]+)/i);
          if (em) email = em[1].toLowerCase().trim();
        }
        if (!email) {
          const match = cells.eq(emailIdx).text().match(/[a-zA-Z0-9][\w.-]*@[a-zA-Z0-9][\w.-]*\.[a-z]{2,}/i);
          if (match) email = match[0].toLowerCase();
        }
      }
      if (!email) {
        const mailto = $row.find('a[href*="mailto:"]').first();
        if (mailto.length) {
          const em = (mailto.attr('href') || '').match(/mailto:([^?&"'\s]+)/i);
          if (em) email = em[1].toLowerCase().trim();
        }
      }
      if (!email || !isValidEmail(email) || seenEmails.has(email)) return;

      const name = nameIdx >= 0 ? cells.eq(nameIdx).text().trim() : $row.find('strong, a').first().text().trim();
      const department = deptIdx >= 0 ? cells.eq(deptIdx).text().trim() : '';
      const title = titleIdx >= 0 ? cells.eq(titleIdx).text().trim() : '';
      const phone = phoneIdx >= 0 ? cells.eq(phoneIdx).text().trim() : '';
      const address = addressIdx >= 0 ? cells.eq(addressIdx).text().trim() : '';

      let research_areas = [];
      if (interestIdx >= 0 && cells.eq(interestIdx).length) {
        research_areas = extractAreaOfInterestFromNode($, cells.eq(interestIdx));
        if (!research_areas.length) research_areas = parseInterestKeywordList(cells.eq(interestIdx).text());
      }
      if (!research_areas.length) research_areas = extractAreaOfInterestFromNode($, $row);

      let profileUrl = '';
      const link = $row.find('a[href*="profile"], a[href*="faculty"], a[href*="people"]').first();
      if (link.length) profileUrl = link.attr('href') || '';

      seenEmails.add(email);
      results.push({
        email,
        name: name || '',
        title,
        department,
        phone,
        address,
        research_areas,
        profileUrl,
        source: 'directory_table',
      });
    });
  });

  return results;
}

export async function expandDirectoryInterestPanels(page) {
  try {
    await page.evaluate(() => {
      const triggers = [...document.querySelectorAll('a, button, summary, [role="button"], [data-toggle], [data-bs-toggle], [aria-expanded="false"]')];
      for (const el of triggers) {
        const t = `${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.toLowerCase();
        if (!/area\s+of\s+interest|research\s+interest|view\s+interest|expertise|research\s+area|show\s+more|read\s+more|expand/i.test(t)) continue;
        try { el.click(); } catch { /* ignore */ }
      }
      document.querySelectorAll('details:not([open])').forEach(d => { try { d.open = true; } catch { /* ignore */ } });
    });
    await new Promise(r => setTimeout(r, 800));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 400));
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 300));
  } catch { /* ignore */ }
}
