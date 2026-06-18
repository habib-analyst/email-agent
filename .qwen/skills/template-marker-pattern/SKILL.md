---
name: template-marker-pattern
description: Reliable HTML email personalization — use AI to detect placeholder text, auto-wrap with {{MARKERS}}, replaceAll for every occurrence, enforce interest line constraints (max 30 words, 3 keywords, no paper titles, NO sentence wrapper duplication), and validate before sending
source: auto-skill
extracted_at: '2026-06-10T20:50:39.565Z'
---

# Template Marker Pattern for Email Personalization

When personalizing HTML emails, you have two fragile approaches:
- **Regex replace on detected text**: the detected text might appear elsewhere in the HTML, or the regex might escape incorrectly
- **Full AI regeneration**: loses formatting, fonts, colors, and signature

The marker pattern solves both: AI finds the *text to change*, then you wrap it in unambiguous `{{MARKERS}}` for reliable programmatic replacement.

## The Pattern

### 1. AI detects the placeholder text from raw HTML
```js
const placeholders = await detectPlaceholders(rawHtml);
// → { lastName: "Dr. Smith", interestLine: "I am particularly interested in your work on..." }
```

### 2. Wrap detected text with unambiguous markers
```js
let markedHtml = rawHtml;
if (placeholders.lastName && markedHtml.includes(placeholders.lastName)) {
  markedHtml = markedHtml.replaceAll(placeholders.lastName, '{{LAST_NAME}}');
}
if (placeholders.interestLine && markedHtml.includes(placeholders.interestLine)) {
  markedHtml = markedHtml.replaceAll(placeholders.interestLine, '{{INTEREST_LINE}}');
}
// Store markedHtml in DB
```

**Important: Use `replaceAll()` not `replace()`**. `.replace()` only replaces the *first* occurrence. If the placeholder text (e.g., a professor's last name) appears twice in the HTML, the second occurrence stays hardcoded and won't be personalized. `.replaceAll()` replaces every occurrence.

### 3. Enforce interest line constraints in DEFAULT_INSTRUCTIONS and AI prompt

The interest line must be constrained: **max 30 words, exactly 3 research keywords (comma-separated), NO paper titles or publication citations**. Enforce this in 3 places:

**DEFAULT_INSTRUCTIONS** (stored in DB and passed to AI on every email generation):
```
3. INTEREST LINE: Replace {{INTEREST_LINE}} with EXACTLY 3 comma-separated research keywords
   from the professor's profile. The template already says "I am particularly interested in your
   work in {{INTEREST_LINE}}" — so {{INTEREST_LINE}} gets replaced with just the keywords, e.g.
   "Distributed Systems, Cloud Computing, Big Data Processing". DO NOT repeat the sentence wrapper.
```

**AI generate prompt** (enforced at generation time):
```
2. Interest Line:
   - Output ONLY 3 comma-separated research area keywords — NOT a full sentence
   - The template already contains "I am particularly interested in your work in {{INTEREST_LINE}}"
   - So {{INTEREST_LINE}} is replaced with just the keywords
   - DO NOT repeat "I am particularly interested in your work in" — that's already in the template
   - DO NOT cite paper titles or publications — only research area keywords
Self-Check:
   - pass=false if interestLine contains the phrase "I am particularly interested"
     (the template already has it — interestLine must be ONLY keywords)
   - pass=false if interestLine cites paper titles
```

**Pipeline validation** (enforced before sending):
```js
if (!email.interestLine || email.interestLine.length < 5
    || email.interestLine.split(/\s+/).length > 30) {
  updateState(item.id, 'failed', { error: 'Interest line constraint violation' });
}
```

### 4. At send time, simple string replace
```js
const html = template.raw_html
  .replace(/\{\{LAST_NAME\}\}/g, prof.last_name)
  .replace(/\{\{INTEREST_LINE\}\}/g, item.interest_line);
```

### 5. Pre-send validation before hitting the API
```js
if (html.includes('{{LAST_NAME}}')) throw new Error('LAST_NAME not replaced');
if (html.includes('{{INTEREST_LINE}}')) throw new Error('INTEREST_LINE not replaced');
if (!item.interest_line) throw new Error('Interest line empty');
if (!/^\[.+\]/.test(item.subject)) throw new Error('Subject missing [Topic]');
```

### 6. CRITICAL: Prevent sentence wrapper duplication

**The most common bug in this pattern**: When the template contains a full sentence with the placeholder (e.g., `"I am particularly interested in your work in {{INTEREST_LINE}}"`), the AI prompt must tell the model to output ONLY the keywords — NOT the full sentence. Otherwise the substitution produces doubled text:

```
Template: "I am particularly interested in your work in {{INTEREST_LINE}}"
AI outputs: interestLine = "I am particularly interested in your work in Distributed Systems, Cloud Computing"
After substitution: "I am particularly interested in your work in I am particularly interested in your work in Distributed Systems, Cloud Computing"
```

**Fix (2 layers)**: The AI prompt must explicitly state that the placeholder value should be ONLY the keywords, because the sentence wrapper is already in the template. Add a self-check that rejects any `interestLine` containing the sentence wrapper phrase. But this only prevents future bad data — existing DB entries with the wrong format still cause duplication. Add a **runtime stripping layer** at substitution to handle legacy data.

### Defense-in-depth: Runtime stripping at substitution

Even after fixing all AI prompts, existing queue items may already have `interest_line` stored as the full sentence. Strip the wrapper before substituting into the template, at both the backend (send) and frontend (preview/edit) layers:

```js
// Backend: gmail/index.js sendEmail()
let interestLine = item.interest_line || '';
interestLine = interestLine.replace(/I am (?:particularly )?interested in your work (?:on|in) ?/gi, '').trim();
html = tpl.raw_html
  .replace(/\{\{LAST_NAME\}\}/g, formatGreetingLastName(prof.last_name))
  .replace(/\{\{INTEREST_LINE\}\}/g, stripInterest ? '' : interestLine);

// Frontend: Instant.jsx ApprovalCard
const cleanInterestLine = (line) => (line || '').replace(/I am (?:particularly )?interested in your work (?:on|in) ?/gi, '').trim();
// Use in baseHtml and edit mode HTML substitution
```

**Why runtime stripping?** Fixing prompts prevents future bad data, but can't retroactively fix existing DB entries. Without the stripping layer, users see duplicated text in pending approval emails that were already generated. The stripping regex is cheap (one `.replace()` call) and harmless — if the interestLine is already just keywords, the regex doesn't match anything.

### AI prompt fix must be consistent across ALL locations

This must be fixed in **all 4+ locations** where the instruction appears:
1. `ai/index.js` `generateTopicAndInterest` — the fallback prompt
2. `ai/index.js` `generateFromInstructions` — the primary prompt with rules
3. `ai/index.js` self-check — validation rules
4. `routes/index.js` DEFAULT_INSTRUCTIONS — stored in DB
5. `db/index.js` DEFAULT_INSTRUCTIONS — seed/reset instructions
6. `frontend/GmailComposeChrome.jsx` DEFAULT_INSTRUCTIONS — UI display

**Why 6 locations?** The DEFAULT_INSTRUCTIONS get stored in the DB on first run or reset, but the AI module reads them from the DB and uses them in the prompt. If any one location still has the old wording ("Output the full sentence"), the AI will sometimes generate the full sentence from that source, causing duplication. All must be consistent.

## Why It Works

- **One-time AI cost**: placeholder detection happens once when the template is saved, not on every send
- **No regex escape bugs**: `{{LAST_NAME}}` doesn't contain special regex characters, unlike arbitrary text like "Dr. Chen (Stanford)"
- **Unambiguous**: the markers can't accidentally match other parts of the HTML
- **Validation**: the pre-send check catches any case where the marker wasn't replaced, preventing broken emails
- **Byte-for-byte preservation**: everything except the markers stays identical to the original sent email
- **Constraint enforcement**: 3-layer defense (instructions → AI prompt → pipeline validation) ensures interest lines are always brief, keyword-focused, and never mention publications
- **No duplication**: explicit instruction that the placeholder value is ONLY keywords (the sentence wrapper is in the template) prevents the doubled-sentence bug

## Counter Pattern (Don't Do This)
```js
// Fragile: regex on arbitrary text
html.replace(new RegExp(escapeRegex(detectedText), 'g'), replacement);
// Problem: detectedText could be "Dr. S" which matches "Dr. Smith" AND "Dr. Stone"

// Fragile: .replace() without g flag or replaceAll — second occurrence stays hardcoded
markedHtml.replace(placeholders.lastName, '{{LAST_NAME}}');
// Problem: if "Smith" appears in both greeting and signature, second stays "Smith"

// Fragile: AI citing paper titles in interest line
// "I am particularly interested in your work on Deep Learning for Image Recognition, especially your paper 'A Novel Approach to Semantic Segmentation' (2024)"
// Problem: 45+ words, mentions specific paper — too detailed, looks copy-pasted, can't be verified

// CRITICAL BUG: AI outputting full sentence when template already has the wrapper
// Template: "I am particularly interested in your work in {{INTEREST_LINE}}"
// AI prompt says: interestLine = "I am particularly interested in your work in [keywords]"
// Result: "I am particularly interested in your work in I am particularly interested in your work in [keywords]"
// Fix: AI prompt must say interestLine = "[keywords]" only, NOT the full sentence
```

## When to Use

Any system that:
- Sends personalized emails based on a user's existing sent email as template
- Needs to change only specific parts (name, custom sentence) while preserving everything else
- Uses AI to identify *what* to change but wants reliable programmatic replacement
- Needs to constrain AI output length and content (brief keywords, not detailed citations)
- Has a template with sentence wrappers around placeholders (must prevent duplication)