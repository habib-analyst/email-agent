/** Shared professor parsing — always anchor identity on email, not display name. */

export function sanitizeAIField(value) {
  if (value === 'null' || value === 'Null' || value === 'NULL' || value === 'none' || value === 'N/A') return null;
  return value;
}

export function capitalizeWord(word) {
  if (!word) return '';
  const w = String(word).trim();
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

export function lastNameFromEmail(email) {
  const local = (email || '').split('@')[0];
  const parts = local.split(/[._-]/).filter(Boolean);

  // Chinese academic patterns: gchen → first letter "g" + surname "chen"
  // lxd → initials l.x.d. → can't determine surname from initials alone
  // Single-letter prefix followed by surname: jkoller → surname "koller"
  if (parts.length >= 2) {
    // Check for single-letter prefix (Chinese/Western pattern): "gchen" → ["g","chen"]
    if (parts[0].length === 1) {
      // The rest is likely the surname: "chen" from "g.chen"
      return capitalizeWord(parts[parts.length - 1]);
    }
    // Standard Western: last part is surname (john.koller → koller, john_smith → smith)
    return capitalizeWord(parts[parts.length - 1]);
  }

  // Single-part local: initials like "lxd" — can't determine surname
  // 3+ letter initials are likely initials, not a name
  if (local.length <= 3 && local === local.toLowerCase()) {
    return ''; // AI research must determine real name
  }

  // Longer single-part: could be a nickname or concatenated name
  return '';
}

export function fullNameFromEmail(email) {
  const local = (email || '').split('@')[0];
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return parts.map(capitalizeWord).join(' ');
  // Single-part initials or short: AI research must determine real name
  return '';
}

// Common academic subdomains to strip for university name
const STRIP_SUBDOMAINS = /^(cs|ee|ece|me|math|stat|phys|chem|bio|med|law|bus|edu|info|cse|ese|ise|mse|sse|www|mail|ftp|web)\./i;

export function universityFromEmail(email) {
  const domain = (email || '').split('@')[1] || '';
  const cleaned = domain.replace(STRIP_SUBDOMAINS, '').replace(/\.edu$/i, '').replace(/\./g, ' ');
  return cleaned.replace(/\b\w/g, c => c.toUpperCase());
}

// Common title prefixes to strip from professor names (global)
const TITLE_PREFIXES = /^(Prof\.?|Professor|Dr\.?|Doctor|Mr\.?|Mrs\.?|Ms\.?|Miss|Academician|Hon\.?|Sir|Madam|Dean|Director|Chair|Head|教授|博士|先生|女士|교수|박사)\s+/i;

// Korean surname detection — ~18 common Korean surnames
const KOREAN_SURNAMES = /^(Kim|Lee|Park|Choi|Jung|Cho|Yoo|Lim|Han|Shin|Oh|Kang|Song|Chang|Hong|Yoon|Seo|Nam|Bae|Ryu|Jo|Jeon|Ha|Yang|Ko|Yi|Hwang|Min|Jang|Byun)\b/i;

// Common European surname patterns (patronymic suffixes)
const EURO_SURNAMES_SUFFIXES = /^(.*(?:sson|sen|ova|ová|ev|ova|ski|sky|ska|icz|wicz|vich|vic|ova|escu|eau|elli|ini|idis|oglou|ian|yan|ovich|ovna|enko|yev|ev|ova|ić))$/i;

// ── Common Chinese pinyin surnames (top ~100) ──
const CHINESE_SURNAMES = new Set([
  'Li','Wang','Zhang','Liu','Chen','Yang','Zhao','Huang','Zhou','Wu',
  'Xu','Sun','Hu','Zhu','Gao','Lin','He','Guo','Ma','Luo',
  'Zheng','Liang','Xie','Song','Tang','Han','Feng','Cao','Deng','Xiao',
  'Pan','Jiang','Shen','Wei','Yuan','Lu','Yu','Cai','Ren','Yu',
  'Ding','Peng','Zeng','Wu','Su','Pan','Ge','Fan','Peng','Lu',
  'Wei','Cai','Tian','Du','Deng','Ning','Bu','Qiu','Qin','Yan',
  'Mu','Mao','Jiang','Shao','Gong','Wei','Yu','Hou','Yin','Hao',
  'Yan','Miao','Zhan','Yan','Zhu','Zhong','Qiu','Luo','Dong','Gong',
  'Gan','Ruan','Xiang','Yi','Shen','Liao','Kuang','Zhan','Zeng','Wen',
  'Hong','Ban','Que','Bai','Hou','Fei','Lian','Rao','Xin','Kuai',
  'Yan','Qin','Gui','Hai','Zhu','Luan','Mi','Jing','Qing','Tu',
]);

// ── Western surname prefixes (Dutch, German, Spanish, Italian) ──
const WESTERN_PREFIXES = /^(van|von|de|da|del|della|di|du|le|la|el|al|bin|ibn|ben|mac|mc|o')\b/i;

/**
 * parseFullName — robust name parser that handles comma-separated, Chinese, Korean,
 * European, hyphenated, and compound names.
 *
 * @param {string} rawName  — the full name string extracted from page or email
 * @param {string} emailLocalPart — e.g. "gchen" from "gchen@nju.edu.cn"
 * @param {string} emailDomain — e.g. "nju.edu.cn"
 * @returns {{ fullName: string, lastName: string, firstName: string, nameSource: string }}
 */
export function parseFullName(rawName, emailLocalPart = '', emailDomain = '') {
  if (!rawName?.trim()) return { fullName: '', lastName: '', firstName: '', nameSource: 'empty' };

  let cleaned = rawName.trim().replace(TITLE_PREFIXES, '').trim();
  cleaned = cleaned.replace(/[,.;:]+$/, '').replace(/\s*\(.*?\)\s*$/, '').trim();

  // ── Step 1: Comma-separated format → swap ──
  // "Zhong, Sheng" → "Sheng Zhong", "Smith, John A." → "John A. Smith"
  if (cleaned.includes(',')) {
    const [before, after] = cleaned.split(',').map(s => s.trim());
    if (before && after) {
      cleaned = `${after} ${before}`;
    }
  }

  // ── Step 2: Normalise case ──
  // ALL-CAPS → Title Case; mixed case → Title Case per word
  const words = cleaned.split(/\s+/).filter(Boolean);
  const isAllUpper = words.every(w => w === w.toUpperCase() && w.length > 1);
  const normalised = isAllUpper
    ? words.map(capitalizeWord).join(' ')
    : words.map(w => {
        // Keep hyphenated internal caps: "Al-Hosban" stays as-is after title-casing
        if (w.includes('-')) return w.split('-').map(capitalizeWord).join('-');
        // Keep known ALL-CAPS surname pattern already handled below
        return capitalizeWord(w);
      }).join(' ');

  const parts = normalised.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { fullName: '', lastName: '', firstName: '', nameSource: 'empty' };
  if (parts.length === 1) return { fullName: normalised, lastName: capitalizeWord(parts[0]), firstName: '', nameSource: 'single_word' };

  // ── Step 3: ALL-CAPS surname detection (Chinese/East Asian academic sites) ──
  // "Guihai CHEN" → "Chen", "Xuandong LI" → "Li", "KIM SEOKJIN" → "Kim"
  const originalParts = cleaned.split(/\s+/).filter(Boolean);
  const origLast = originalParts[originalParts.length - 1];
  const origFirst = originalParts[0];

  // Check for ALL-CAPS last word
  if (origLast.length >= 2 && origLast === origLast.toUpperCase() && /[A-Z]/.test(origLast)) {
    // Before concluding it's just a standard ALL-CAPS surname, check if first word is Korean surname
    if (KOREAN_SURNAMES.test(capitalizeWord(origFirst))) {
      return { fullName: normalised, lastName: capitalizeWord(origFirst), firstName: parts.slice(1).join(' '), nameSource: 'allcaps_korean' };
    }
    const lastName = capitalizeWord(origLast);
    const firstName = parts.slice(0, -1).join(' ');
    return { fullName: normalised, lastName, firstName, nameSource: 'allcaps_last' };
  }

  // Check for ALL-CAPS first word (surname-first ordering)
  if (origFirst.length >= 2 && origFirst === origFirst.toUpperCase() && /[A-Z]/.test(origFirst)) {
    // Check if last word is Korean surname (already in normalised title case)
    if (KOREAN_SURNAMES.test(parts[parts.length - 1])) {
      return { fullName: normalised, lastName: capitalizeWord(parts[parts.length - 1]), firstName: parts.slice(0, -1).join(' '), nameSource: 'allcaps_korean_last' };
    }
    // Also check if ALL-CAPS first word is Korean surname
    if (KOREAN_SURNAMES.test(capitalizeWord(origFirst))) {
      return { fullName: normalised, lastName: capitalizeWord(origFirst), firstName: parts.slice(1).join(' '), nameSource: 'allcaps_korean_first' };
    }
    const lastName = capitalizeWord(origFirst);
    const firstName = parts.slice(1).join(' ');
    return { fullName: normalised, lastName, firstName, nameSource: 'allcaps_first' };
  }

  // ── Step 4: Korean surname-first ──
  if (KOREAN_SURNAMES.test(parts[0])) {
    return { fullName: normalised, lastName: capitalizeWord(parts[0]), firstName: parts.slice(1).join(' '), nameSource: 'korean_surname' };
  }

  // ── Step 5: Chinese surname detection via known list ──
  // For two-token names where the first token is a known Chinese surname → surname-first
  // "Sheng Zhong" — Zhong is also in the list, but "Sheng" is NOT → last-token is surname
  // "Zhang Wei" — Zhang IS a surname → Zhang is last name (surname-first convention)
  // But "Wei Zhang" — Wei is NOT, Zhang IS → ambiguous; check email hint
  if (parts.length === 2) {
    const firstIsChinese = CHINESE_SURNAMES.has(capitalizeWord(parts[0]));
    const lastIsChinese = CHINESE_SURNAMES.has(capitalizeWord(parts[parts.length - 1]));

    if (firstIsChinese && !lastIsChinese) {
      // "Zhang Wei" → surname-first (Zhang is family name)
      return { fullName: normalised, lastName: capitalizeWord(parts[0]), firstName: parts[1], nameSource: 'chinese_surname_first' };
    }
    if (!firstIsChinese && lastIsChinese) {
      // "Wei Zhang" → ambiguous but treat last as surname (Western order)
      return { fullName: normalised, lastName: capitalizeWord(parts[1]), firstName: parts[0], nameSource: 'chinese_surname_last' };
    }
    if (firstIsChinese && lastIsChinese) {
      // Both tokens are Chinese surnames — use email hint to decide
      const emailHint = resolveLastNameFromEmailHint(emailLocalPart, parts);
      if (emailHint) return { fullName: normalised, lastName: emailHint.lastName, firstName: emailHint.firstName, nameSource: emailHint.source };
      // No email hint → default to last-token as surname (Western order safer)
      return { fullName: normalised, lastName: capitalizeWord(parts[1]), firstName: parts[0], nameSource: 'chinese_both_default_last' };
    }
  }

  // ── Step 6: Western prefix handling ──
  // "Ludwig van Beethoven" → lastName "van Beethoven" (prefix stays lowercase per convention)
  // "Amal Alhosban" → lastName "Alhosban" (Al is prefix)
  const lastTwo = parts.slice(-2).join(' ');
  if (WESTERN_PREFIXES.test(parts[parts.length - 2])) {
    const prefix = parts[parts.length - 2].toLowerCase();  // Keep prefix lowercase (van, von, de, etc.)
    const base = capitalizeWord(parts[parts.length - 1]);
    return {
      fullName: normalised,
      lastName: `${prefix} ${base}`,
      firstName: parts.slice(0, -2).join(' ') || '',
      nameSource: 'western_prefix',
    };
  }

  // ── Step 7: European patronymic suffixes ──
  // Check BOTH first and last word — some European names are surname-first
  // "Johansson Erik" → surname "Johansson" (surname-first)
  // "Erik Johansson" → surname "Johansson" (standard Western)
  if (EURO_SURNAMES_SUFFIXES.test(parts[parts.length - 1])) {
    return { fullName: normalised, lastName: capitalizeWord(parts[parts.length - 1]), firstName: parts.slice(0, -1).join(' '), nameSource: 'european_suffix' };
  }
  // Surname-first European: first word has suffix and email hints confirm
  if (parts.length === 2 && EURO_SURNAMES_SUFFIXES.test(parts[0])) {
    const emailHint = resolveLastNameFromEmailHint(emailLocalPart, parts);
    if (emailHint) return { fullName: normalised, lastName: emailHint.lastName, firstName: emailHint.firstName, nameSource: emailHint.source };
    // Without email hint, assume surname-first for Scandinavian-style names
    return { fullName: normalised, lastName: capitalizeWord(parts[0]), firstName: parts[1], nameSource: 'european_suffix_first' };
  }

  // ── Step 8: Hyphenated last word ──
  const lastPart = parts[parts.length - 1];
  if (lastPart.includes('-')) {
    return { fullName: normalised, lastName: lastPart.split('-').map(capitalizeWord).join('-'), firstName: parts.slice(0, -1).join(' '), nameSource: 'hyphenated' };
  }

  // ── Step 9: Default Western — last word is surname ──
  return { fullName: normalised, lastName: capitalizeWord(lastPart), firstName: parts.slice(0, -1).join(' '), nameSource: 'western_last_word' };
}

/**
 * Resolve last name from email local-part hint when Chinese surname is ambiguous.
 * e.g. emailLocalPart="gchen" → first letter "g" + surname "chen" → Chen is last name
 * e.g. emailLocalPart="zhongs" → surname "zhong" + first letter "s" → Zhong is last name
 * e.g. emailLocalPart="szhong" → first letter "s" + surname "zhong" → Zhong is last name
 */
function resolveLastNameFromEmailHint(emailLocalPart, nameParts) {
  if (!emailLocalPart) return null;
  const local = emailLocalPart.toLowerCase().replace(/[._-]/g, '');
  const firstName = nameParts[0].toLowerCase();
  const lastName = nameParts[nameParts.length - 1].toLowerCase();

  // Pattern: firstInitial + surname → "gchen" matches if "chen" is in local
  // Check if local contains one of the name parts as a contiguous substring
  // and the other name part's first letter is at the start
  const firstInit = firstName.charAt(0);
  const lastInit = lastName.charAt(0);

  // gchen → "g" + "chen" → Chen is surname
  if (local.startsWith(firstInit) && local.includes(lastName) && local.length === firstInit.length + lastName.length) {
    return { lastName: capitalizeWord(nameParts[nameParts.length - 1]), firstName: nameParts[0], source: 'email_init_plus_surname' };
  }
  // zhongs → "zhong" + "s" → Zhong is surname
  if (local.startsWith(lastName) && local.endsWith(lastInit) && local.length === lastName.length + lastInit.length) {
    return { lastName: capitalizeWord(nameParts[0]), firstName: nameParts[nameParts.length - 1], source: 'email_surname_plus_init' };
  }
  // szhong → "s" + "zhong" → Zhong is surname (initial + surname)
  if (local.startsWith(firstInit) && local.slice(1) === lastName) {
    return { lastName: capitalizeWord(nameParts[nameParts.length - 1]), firstName: nameParts[0], source: 'email_init_plus_surname_v2' };
  }
  // zhongs → surname + initial
  if (local.startsWith(lastName) && local.slice(lastName.length) === firstInit) {
    return { lastName: capitalizeWord(nameParts[0]), firstName: nameParts[nameParts.length - 1], source: 'email_surname_plus_init_v2' };
  }

  // Fuzzy: check if any name part appears as substring
  for (let i = 0; i < nameParts.length; i++) {
    const partLow = nameParts[i].toLowerCase();
    if (local.includes(partLow) && partLow.length >= 2) {
      // This part appears in the email → likely surname
      return { lastName: capitalizeWord(nameParts[i]), firstName: nameParts.filter((_, j) => j !== i).join(' '), source: 'email_substring_match' };
    }
  }

  return null;
}

/**
 * verifyNameWithEmail — confirm parsed name matches email local-part.
 * Returns { verified: boolean, mismatchDetail: string|null }
 */
export function verifyNameWithEmail(fullName, lastName, firstName, emailLocalPart) {
  if (!emailLocalPart) return { verified: true, mismatchDetail: null }; // no email to verify against
  const local = emailLocalPart.toLowerCase().replace(/[._-]/g, '');
  const ln = lastName.toLowerCase();
  const fn = firstName.toLowerCase();

  // Check if last name or first name appears in the email local part
  const lastNameInEmail = local.includes(ln) && ln.length >= 2;
  const firstNameInEmail = local.includes(fn) && fn.length >= 2;
  const firstInitInEmail = local.includes(fn.charAt(0));

  if (lastNameInEmail) return { verified: true, mismatchDetail: null };
  if (firstNameInEmail && !lastNameInEmail) {
    // First name found but last name not — could be reversed
    return { verified: false, mismatchDetail: `Email contains firstName "${firstName}" but not lastName "${lastName}" — possible name reversal` };
  }
  // Neither found — possible initials-based email or completely mismatched
  if (firstInitInEmail && local.length <= 5) {
    return { verified: true, mismatchDetail: null }; // initials-based email, can't verify further
  }
  return { verified: false, mismatchDetail: `Neither "${lastName}" nor "${firstName}" found in email local part "${local}"` };
}

/**
 * extractNameFromJsonLd — find authoritative name from schema.org/JSON-LD markup.
 * Returns name string or null.
 */
export function extractNameFromJsonLd(html) {
  // Match <script type="application/ld+json"> blocks
  const matches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of matches) {
    try {
      const jsonStr = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
      const data = JSON.parse(jsonStr);
      // Check for Person type with a name field
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Person' && item.name) {
          return item.name;
        }
        // Also check @graph arrays
        if (item['@graph']) {
          for (const g of item['@graph']) {
            if (g['@type'] === 'Person' && g.name) return g.name;
          }
        }
      }
    } catch { /* invalid JSON-LD, skip */ }
  }
  return null;
}

export function lastNameFromFullName(fullName) {
  const parsed = parseFullName(fullName);
  return parsed.lastName;
}

/**
 * Validate that a name looks like a real person name (not a title, department, field, etc.)
 * Covers: English, Chinese romanized, Korean, Japanese, European
 * Rejects: "Engineering", "Computer Science", "Department of...", initials-only, etc.
 */
export function isValidPersonName(name) {
  if (!name || name.length < 2) return false;
  const trimmed = name.trim();

  // Must contain at least one romanized letter or CJK character
  if (!/[a-zA-Z\u4e00-\u9fff\uac00-\ud7af\u3040-\u309f\u30a0-\u30ff]/.test(trimmed)) return false;

  // Reject page chrome / accessibility labels (e.g. "Skip To Content")
  if (/^skip\s+to\b/i.test(trimmed)) return false;
  if (/^(main|page)\s+content$/i.test(trimmed)) return false;
  if (/^(navigation|menu|search|home|close)$/i.test(trimmed)) return false;

  // Reject section headings mistaken for person names
  if (/\b(joint\s+appointment|emeritus|adjunct|visiting|affiliate)\s+faculty\b/i.test(trimmed)) return false;
  if (/\bfaculty\s*(directory|listing)?$/i.test(trimmed)) return false;
  if (/^areas?\s+of\s+interest$/i.test(trimmed)) return false;

  // Reject common non-person patterns
  const BAD_STARTS = /^(Department|Faculty|School|College|University|Lab|Laboratory|Research|Institute|Center|Office|Group|Division|Program|Course|Class|Seminar|Workshop|Conference|Journal|Team|Staff|Engineering|Computing|Sciences|Technology|Systems|Networks|Analytics|Intelligence|Architecture|Theory|Applied|Mathematics|Statistics|Philosophy|Economics|Finance|Management|Operations|Humanities|Medicine|Chemistry|Physics|Biology|Law|Business|Marketing|Public|Health|Environmental|Digital|Cyber|Cloud|IoT|Blockchain|Web|Mobile|Game|Graphics|Multimedia|Natural Language|Computer Science|Data Science|Machine Learning|Deep Learning|Artificial Intelligence|Information|Security|Software|Hardware|Vision|Robotics|Embedded|Distributed|Parallel|Concurrent|Autonomous|Quantum|Privacy|Cryptography|Optimization|Algorithm|Verification|Testing|Reliability|Scalability|Performance|Framework|Platform|Infrastructure|Methodology|Approach|Technique|Strategy|Protocol|Specification|Requirement|Evaluation|Assessment|Survey|Study|Analysis|Investigation|Exploration|Discovery|Innovation|Invention|Creation|Development|Evolution|Transformation|Migration|Integration|Deployment|Implementation|Administration|Governance|Compliance|Regulation|Legislation|Ethics|History|Culture|Society|Community|Organization|Institution|Enterprise|Industry|Market|Economy|Progress|Advancement|Achievement|Recognition|Award|Funding|Investment|Budget|Revenue|Profit|Loss|Risk|Threat|Vulnerability|Attack|Defense|Protection|Prevention|Recovery|Resilience|Adaptation|Knowledge|Understanding|Awareness|Perception|Cognition|Expertise|Competence|Capability|Potential|Probability|Certainty|Precision|Accuracy|Validity|Consistency|Completeness|Comprehensiveness|Architecture|Design|Blueprint|Database|Storage|Memory|Buffer|Queue|Pipeline|Workflow|Sequence|Iteration|Recursion|Configuration|Parameter|Variable|Constant|Function|Procedure|Process|Monitoring|Surveillance|Control|Management|Leadership|Direction|Communication|Education|Teaching|Learning|Investigation|Administration|Coordination|Collaboration|Cooperation|Partnership|Alliance|Agreement|Contract|Transaction|Exchange|Trade|Service|Treatment|Therapy|Medicine|Vaccine|Immunity|Safety|Prevention|Standard|Guideline|Regulation|Policy|Convention|Custom|Tradition|Heritage|Legacy|Record|Archive|Document|Science|Technology|Engineering|Mathematics|Statistics|Logic|Philosophy|Art|Literature|Language|Professor|Doctor|Dean|Director|Chair|Head|Coordinator|Manager|Assistant|Associate|Lecturer|Adjunct|Visiting|Postdoc|Student|Alumni|Emeritus|Retired|Acting|Interim|Temporary|Permanent|Distinguished|Honorary|Clinical|Academic|Professional|Technical|Administrative|Fellow|Scholar|Scientist|Engineer|Analyst|Consultant|Advisor|Mentor|Supervisor|Organizer|Leader|Chief|Principal|Scientist)/i;

  if (BAD_STARTS.test(trimmed)) return false;

  // Reject initials-only names (like "L X D" or "lxd" or "G C")
  const wordsOnly = trimmed.replace(/[^a-zA-Z\s]/g, '').trim();
  const words = wordsOnly.split(/\s+/).filter(Boolean);
  if (words.length > 0 && words.every(w => w.length <= 2)) return false;

  // Reject if it's purely CJK characters without romanized letters
  if (/^[\u4e00-\u9fff\uac00-\ud7af\u3040-\u309f\u30a0-\u30ff]+$/.test(trimmed)) return false;

  // Reject if too short or too long
  if (trimmed.length < 2 || trimmed.length > 80) return false;

  // Reject numbers, emails, URLs
  if (/\d/.test(trimmed) || trimmed.includes('@') || /^https?:\/\//i.test(trimmed)) return false;

  // Must have at least 2 romanized letters OR valid CJK
  const letters = trimmed.replace(/[^a-zA-Z]/g, '');
  const hasCJK = /[\u4e00-\u9fff\uac00-\ud7af]/.test(trimmed);
  if (letters.length < 2 && !hasCJK) return false;

  return true;
}

export function formatGreetingLastName(lastName) {
  if (!lastName || lastName.length < 2) {
    throw new Error('Cannot format greeting: last name is empty or invalid');
  }
  return capitalizeWord(lastName);
}

export function emailLocalKey(email) {
  return (email || '').split('@')[0].toLowerCase().replace(/[._-]/g, '');
}

export function emailsMatch(a, b) {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
