---
name: balanced-bracket-json-parser
description: Extract valid JSON from AI responses that include explanatory text — use balanced bracket counting instead of greedy regex to avoid capturing invalid JSON
source: auto-skill
extracted_at: '2026-06-12T05:56:10.927Z'
---

# Balanced Bracket JSON Parser for AI Responses

AI models often return JSON wrapped in explanatory text, markdown, or commentary. Extracting the JSON object reliably is harder than it looks — greedy regex captures too much, lazy regex captures too little.

## The Bug: Greedy and Lazy Regex Both Fail

```js
// LAZY: captures the SMALLEST {...} block — misses outer object when nested
const match = text.match(/\{[\s\S]*?\}/);
// Input: "Here is the result: {"topic":"AI","data":{"nested":true}} Hope this helps!"
// Captures: {"topic":"AI","data":{"nested":true}} ← this is actually correct by luck
// But: "Result: {"a":1} and also {"b":2}" → captures {"a":1} (the first, smaller one)

// GREEDY: captures the LARGEST {...} block — grabs explanatory text with braces
const greedyMatch = text.match(/\{[\s\S]*\}/);
// Input: "The professor works in {computer science} and the JSON is {"topic":"CS"}"
// Captures: {computer science} and the JSON is {"topic":"CS"} → invalid JSON!
```

## The Fix: Balanced Bracket Counting

Walk through the text character-by-character. When you find a `{`, count nested braces (respecting strings and escape sequences). When the count returns to 0, you've found a complete, balanced object. Try `JSON.parse` on it. If it fails, keep scanning for the next `{`.

```js
function safeParseJSON(text) {
  if (!text) throw new Error('AI returned empty response');
  try { return JSON.parse(text); } catch {}

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0, inStr = false, esc = false;

    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (esc) { esc = false; continue; }
      if (ch === '\\' && inStr) { esc = true; continue; }
      if (ch === '"' && !esc) inStr = !inStr;
      if (inStr) continue;
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(i, j + 1);
          try { return JSON.parse(candidate); } catch { break; }
        }
      }
    }
  }

  // Fallback: try smallest non-nested blocks
  const matches = text.match(/\{[^{}]*\}/g);
  if (matches) {
    for (const m of matches) {
      try { return JSON.parse(m); } catch {}
    }
  }

  throw new Error('AI returned invalid JSON: ' + text.slice(0, 100));
}
```

## Why It Works

- **Respects nesting**: depth counting handles `{ "a": { "b": 1 } }` correctly
- **Respects strings**: `inStr` flag prevents `{` inside `"text with {braces}"` from incrementing depth
- **Respects escapes**: `\\"` and `\\{` don't trigger string/depth changes
- **Validates before returning**: `JSON.parse(candidate)` confirms the extracted text is actually valid JSON
- **Scans all `{` positions**: if the first candidate fails, continues scanning for the next one
- **First valid JSON wins**: returns immediately on the first successfully parsed block

## When to Use

Any code that calls AI APIs and expects JSON responses but may receive:
- JSON wrapped in markdown code blocks
- JSON preceded by explanatory text ("Here is the result:")
- JSON followed by commentary ("I chose this topic because...")
- Multiple JSON-like blocks where only one is the real response

## What Not to Do

```js
// DON'T: greedy regex — captures text between unrelated braces
text.match(/\{[\s\S]*\}/);

// DON'T: lazy regex — may capture only inner nested object
text.match(/\{[\s\S]*?\}/);

// DON'T: assume AI always returns pure JSON — models add commentary
JSON.parse(text); // throws if any text outside the JSON
```