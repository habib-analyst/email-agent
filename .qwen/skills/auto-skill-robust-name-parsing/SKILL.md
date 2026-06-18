---
name: robust-name-parsing
description: Multi-step cascade name parser for academic/international names — handles Chinese pinyin, Korean, ALL-CAPS, comma-separated, Western prefixes, European suffixes, hyphenated names, email-based verification, and JSON-LD extraction for authoritative names
source: auto-skill
extracted_at: '2026-06-13T00:00:00.000Z'
---

# Robust Name Parsing for Academic/International Data

When extracting professor names from scraped web pages, naive approaches (last word = surname) fail on Chinese pinyin, Korean, ALL-CAPS academic sites, European prefix names, and comma-separated formats. The cascade pattern handles all these edge cases with email-based verification.

## The Cascade Pattern: 9 Ordered Rules

Parse names through a **ordered cascade** — each rule is checked in sequence, and the first match wins. This prevents later rules from overruling more specific patterns.

```
1. Comma swap     → "Zhong, Sheng" becomes "Sheng Zhong"
2. Case normalise → ALL-CAPS → Title Case; mixed → per-word Title Case
3. ALL-CAPS surname → "Guihai CHEN" → lastName="Chen" (with Korean check inside)
4. Korean surname-first → "Kim Seokjin" → lastName="Kim"
5. Chinese surname list → "Zhang Wei" → lastName="Zhang" (surname-first); "Wei Zhang" → lastName="Zhang" (ambiguous → email hint)
6. Western prefix  → "Ludwig van Beethoven" → lastName="van Beethoven" (prefix lowercase)
7. European suffix → "Johansson" → surname; surname-first "Johansson Erik" → lastName="Johansson"
8. Hyphenated     → "Smith-Jones" → lastName="Smith-Jones"
9. Default Western → last word = surname
```

### Critical ordering insight

ALL-CAPS detection (step 3) must happen **before** Korean detection (step 4), but Korean surname check **inside** step 3 catches ALL-CAPS Korean names like "KIM SEOKJIN". Without this, "KIM SEOKJIN" would be parsed as lastName="Seokjin" (wrong).

## Email-Based Ambiguity Resolution

When both tokens are Chinese surnames (e.g., "Li Wei" where Li and Wei are both in the surname list), use the email local-part as a hint:

```js
// gchen → first letter "g" + surname "chen" → Chen is surname
// szhong → first letter "s" + surname "zhong" → Zhong is surname  
// zhongs → surname "zhong" + initial "s" → Zhong is surname (reversed)
```

Match patterns: `initial+surname`, `surname+initial`, and substring matching. This resolves ~80% of ambiguous Chinese names.

## Verification Against Email

After parsing, verify the extracted name matches the email:

```js
const verification = verifyNameWithEmail(fullName, lastName, firstName, emailLocalPart);
// Returns: { verified: boolean, mismatchDetail: string|null }
```

- If lastName appears in email local-part → verified ✓
- If firstName appears but lastName doesn't → possible reversal, flag for review
- If neither appears and email is initials-based → can't verify, accept
- If neither appears on a long email → mismatch, flag

Log mismatches prominently: `[Research:NameVerify] MISMATCH for szhong@ucsd.edu: possible name reversal`

## JSON-LD for Authoritative Names

Before using h1/h2 selectors (which often grab site titles instead of person names), check for `<script type="application/ld+json">` blocks with `@type: "Person"`:

```js
const jsonLdName = extractNameFromJsonLd(html);
if (jsonLdName) name = jsonLdName; // authoritative — overrides scraped text
```

JSON-LD names are structured data intentionally placed by the site owner, making them far more reliable than CSS selector guesses.

## Chinese Surname List

Maintain a Set of ~100 common Chinese pinyin surnames: Li, Wang, Zhang, Liu, Chen, Yang, Zhao, Huang, Zhou, Wu, Xu, Sun, Hu, Zhu, Gao, Lin, He, Guo, Ma, Luo, Zheng, Zhong, etc. When a name token matches this list, it's likely a family name (surname).

**Ambiguity rule**: If only the **first** token matches → surname-first convention (Zhang Wei → Zhang is family). If only the **last** token matches → Western-order convention (Wei Zhang → Zhang is family). If **both** match → use email hint.

## Western Prefix Handling

Prefixes (van, von, de, da, del, della, di, du, le, la, el, al, bin, ibn, ben, mac, mc, o') should stay **lowercase** in the lastName per convention:

```
"Ludwig van Beethoven" → lastName = "van Beethoven"  (NOT "Van Beethoven")
```

## European Surname-First Names

Scandinavian/Slavic names with patronymic suffixes (-sson, -sen, -ova, -ski, -enko, -ić) can appear in surname-first order:

```
"Erik Johansson" → lastName = "Johansson"  (standard Western, suffix at end)
"Johansson Erik" → lastName = "Johansson"  (surname-first, suffix at start)
```

Check **both** first and last word for suffix patterns. When suffix is at position 0 and email confirms, treat as surname-first.

## Constrained Keyword Extraction Pattern

For generating subject keywords and interest keywords from professor research data:

1. **Zero-shot constrained prompt**: "Based ONLY on the following research information, output keywords that appear verbatim or are direct synonyms of phrases found in the provided text"
2. **Post-validation**: After AI output, check each keyword appears in source texts (case-insensitive, with acronym expansion: LLM ↔ "large language model")
3. **Retry with tighter constraints**: If validation fails, re-prompt saying "keywords were NOT found in source text — only output verifiable terms"
4. **TF-IDF fallback**: If AI fails twice, extract bigrams/trigrams from publication titles ranked by frequency, with boosted research interest terms

```js
// Validation with acronym expansion
const ACRONYM_MAP = { 'llm': 'large language model', 'nlp': 'natural language processing', ... };
function keywordFoundInSource(keyword, sourceTexts) {
  if (combined.includes(kw)) return true;               // direct
  if (combined.includes(ACRONYM_MAP[kw])) return true;   // acronym expansion
  // reverse: keyword is expansion, text has acronym
}
```

## Test-Driven Edge Case Discovery

Write tests BEFORE finalizing the parser. Include edge cases that expose failures:
- ALL-CAPS Korean names ("KIM SEOKJIN") → expose ALL-CAPS-before-Korean ordering bug
- Western prefix case ("van Beethoven" vs "Van Beethoven") → expose capitalizeWord on prefixes
- Surname-first European ("Johansson Erik") → expose missing suffix-at-position-0 check
- Both-Chinese-surname ambiguity ("Li Wei") → expose need for email hint

Run tests iteratively — each failure reveals a missing rule in the cascade. Add the rule, re-run, repeat until 100%.

## Name Validation in Extraction Contexts

When extracting candidate names from scraped HTML elements, always use `isValidPersonName()` instead of raw checks like `/[A-Z]/.test(t)` or `t.length > 3 && t.length < 60`. The `/[A-Z]/` test rejects romanized CJK/Korean names that lack uppercase Latin letters in the candidate text, while `isValidPersonName` properly accepts them and rejects department/field names like "Engineering" or "Computer Science".

```js
// WRONG: /[A-Z]/ rejects "张伟" (CJK), "김민수" (Korean), "guihai chen" (lowercase pinyin)
if (t && !t.includes('@') && t.length > 3 && t.length < 60 && /[A-Z]/.test(t)) { ... }

// RIGHT: isValidPersonName accepts romanized names, rejects non-person strings
if (isValidPersonName(t) && !t.includes('@')) { ... }
```

This applies everywhere candidate names are filtered: mailto link text, parent container name elements, profile h1/h2 selectors, and AI-extracted names.

## Counter Patterns (Don't Do This)

```js
// Naive: last word = surname (fails on Chinese surname-first, Korean, European prefix)
const lastName = name.split(' ').pop();

// ALL-CAPS check without Korean awareness: "KIM SEOKJIN" → lastName="Seokjin" (WRONG)
if (lastWord === lastWord.toUpperCase()) return capitalizeWord(lastWord);

// Capitalizing Western prefixes: lastName="Van Beethoven" (wrong convention)
return `${capitalizeWord(prefix)} ${capitalizeWord(base)}`;

// Skipping email verification: "Sheng Zhong" with email szhong → could be reversed
// Without verification, you'd never flag the ambiguity

// Using h1 selector first (often grabs "Faculty Directory" instead of person name)
const name = $('h1').first().text().trim();

// Using /[A-Z]/ to validate candidate names (rejects CJK/Korean/lowercase romanized)
if (t && /[A-Z]/.test(t)) { acceptAsName(t); }
```

## When to Use

Any system that:
- Scrapes person names from web pages with international/academic naming conventions
- Needs to correctly identify last names for email greetings ("Dear Professor {lastName}")
- Processes Chinese, Korean, Scandinavian, or hyphenated names
- Has access to email addresses for verification
- Generates research keywords that must be grounded in actual publication data
