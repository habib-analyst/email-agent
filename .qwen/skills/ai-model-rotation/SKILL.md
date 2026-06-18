---
name: ai-model-rotation
description: 4+ Qwen APIs parsed from text files + 3 Gemini keys + 1 OpenAI key, token-optimized rotation with 1M per-model tracking, exhausted-model skipping, 3-tier dispatch (light/heavy/search), reasoning_content handling, per-source Gemini tracking, Gemini search grounding, keyword extraction on light tier, deduplicated prompts, and auto-reset on restart
source: auto-skill
extracted_at: '2026-06-13T18:33:21.869Z'
---

# AI Model Rotation — Multi-API, Text-File Keys, 3-Tier Dispatch

Free-tier AI APIs parsed from text files at startup. 4 Qwen accounts (269 models total), 3 Gemini keys, 1 OpenAI key. Each Qwen model has ~1M token quota. Three dispatch tiers: light (cheap/fast), heavy (quality), search (deepseek-v3.2 with web search).

## Architecture: Parse Keys from Text Files

API keys live in `API-Keys/` folder (excluded from git), NOT in `.env`. A loader parses them at startup:

```
API-Keys/Qwen API/Qwen-API-{1,2,3,4,...}.txt  → API key, base URL, available models list
API-Keys/Gemini API/Geimini-API-{1,2,3}.txt    → API key
API-Keys/Openapi API/Openai-API-1.txt           → API key
```

**`backend/src/config/loadApiKeys.js`** parses each file:
- Qwen: extract API key line (handles BOTH `API Key:` and `API:` formats — older files use `API:`, newer use `API Key:`), `OpenAI Compatible Endpoint:` line, `Available Models list on this Account are following:` section → `{apiKey, baseUrl, models, source}`
- Gemini: extract `API Key:` line
- OpenAI: extract key from text

Returns `{ qwenSources: [{apiKey, baseUrl, models, source:'qwen1'|'qwen2'|...}], geminiKeys: [3 keys], openaiApiKey }`.

### ⚠️ CRITICAL: baseUrl Must Include /compatible-mode/v1 — NOT Strip It

The Qwen API text files contain a line like:
```
OpenAI Compatible Endpoint: https://llm-xxx.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
```

The `baseUrl` stored in the config must be this **FULL endpoint path** including `/compatible-mode/v1`. The AI dispatch code appends `/chat/completions` to it, so the final URL must be:
```
https://llm-xxx...com/compatible-mode/v1/chat/completions  ← CORRECT
```

**DO NOT strip `/compatible-mode/v1` from the endpoint!** A previous version of `parseQwenFile` had `.replace('/compatible-mode/v1', '')`, which produced:
```
https://llm-xxx...com/chat/completions  ← WRONG → 404 on every model call
```

This caused **ALL 269 Qwen models to return 404** on every API call — the base URL path was wrong. The symptom: massive log output of `[Qwen:qwen1] qwen3.6-flash error: Request failed with status code 404 — trying next` for every single model, every single source, before finally falling through to Gemini.

**Why this was hard to diagnose:** The `/models` endpoint worked fine (returns model list), and the API key was valid. Only chat completion calls failed because the URL path was missing. Always test an actual `POST /chat/completions` call, not just `GET /models`.

### ⚠️ Key Format Variance — Common Bug

Qwen API text files have inconsistent key line formats:
- Keys 1-2 use: `API: sk-ws-...`
- Keys 3-4 use: `API Key: sk-ws-...`

The parser must handle BOTH formats. Current regex:
```js
const apiKey = (content.match(/API\s+Key:\s*(.+)/) || content.match(/API:\s*(.+)/))?.[1]?.trim();
```

If you only match `API:`, keys 3+ will silently fail to parse (file "not found or key missing" even though the file exists). Always test with `node -e "import('./src/config/loadApiKeys.js')..."` after adding new key files.

**`backend/src/config/index.js`** imports loadApiKeys and builds config:
- `config.qwenSources` — dynamic number of entries (currently 4), each with apiKey/baseUrl/models/source
- `config.geminiApiKeys` — 3 keys from parsed files
- `config.openaiApiKey` — parsed from file
- `config.lightModels/heavyModels/searchModels` — computed from `selectModelsForTier(qwenSources)`
- No `QWEN_API_KEY`, `QWEN2_API_KEY`, `QWEN_MODELS` env vars needed — all from files

## Per-Source Token Tracking (1M Limit)

Token usage tracked per model per source: `{ 'qwen3.7-plus@qwen1': 123456 }`. When `model@source` hits 1M, skip that combo:

```js
const modelTokenUsage = {};       // { 'qwen3.7-plus@qwen1': 123456, ... }
const MODEL_TOKEN_LIMIT = 1_000_000;
// Dynamic — auto-populated from config.qwenSources at module load
const apiCallStats = {};
config.qwenSources.forEach(s => { apiCallStats[s.source] = 0; });
apiCallStats.gemini = 0;
apiCallStats.openai = 0;

function isModelExhausted(model, source) {
  const key = `${model}@${source}`;
  const used = modelTokenUsage[key] || 0;
  return used >= MODEL_TOKEN_LIMIT;
}
```

**Important:** `apiCallStats`, `resetTokenUsage()`, and `getApiStats()` must be dynamic — they derive source names from `config.qwenSources`, NOT hardcoded `qwen1/qwen2/qwen3`. When adding a new key, these automatically pick up the new source name (e.g., `qwen4`). `getApiStats()` sums Qwen totals via `config.qwenSources.reduce(...)`.

Export `getTokenUsage()`, `getTotalQwenTokens()`, `getApiStats()` for `/api-usage` endpoint. Total capacity: 269 models × 1M = **~269M free tokens**.

### Reasoning Token Handling (Thinking Models)

Thinking/reasoning models like `qwq-plus` return `reasoning_content` alongside `content` in the response message, and `completion_tokens_details.reasoning_tokens` in the usage object. These burn thousands of tokens for internal reasoning that must be:

1. **Stripped before JSON parsing** — `message.content` is the actual output; `message.reasoning_content` is thinking text that pollutes JSON parsing
2. **Tracked separately** — `reasoningTokenUsage` map stores reasoning costs per model@source, distinct from `modelTokenUsage` (output costs)

```js
const reasoningTokenUsage = {};  // { 'qwq-plus@qwen1': 5000, ... }
// In trackTokenUsage: if reasoning_tokens > 0, log separately
if (reasoning > 0) {
  reasoningTokenUsage[key] = (reasoningTokenUsage[key] || 0) + reasoning;
}
// getTokenUsage() returns { output: {...modelTokenUsage}, reasoning: {...reasoningTokenUsage} }
```

3. **Never filter from pool** — qwq-plus stays in HEAVY_PREFERRED so it's still selectable. Handle the output properly, don't exclude the model.

### Per-Source Gemini Tracking

Gemini keys are tracked per-source (gemini1/gemini2/gemini3) instead of a single `gemini` counter:

```js
// loadApiKeys returns geminiSources alongside geminiKeys
geminiSources: [{ source: 'gemini1', apiKey: '...' }, { source: 'gemini2', apiKey: '...' }, ...]
// config/index.js exports: geminiSources, geminiApiKeys, geminiModels
// In callGemini: determine which source this key belongs to
const geminiSource = config.geminiSources.find(s => s.apiKey === combo.key)?.source || 'gemini';
apiCallStats[geminiSource]++;
trackTokenUsage(usage, geminiSource);  // per-source, not 'gemini'
```

`resetTokenUsage()` and `getApiStats()` iterate `config.geminiSources` to reset/sum per-key counts. `getApiStats()` returns `{ qwenTotal, geminiTotal }` computed from per-source arrays.

## 3-Tier Dispatch: Light, Heavy, Search

Model tiers are computed dynamically from available models across all Qwen APIs:

```js
// Ordered by preference — token-cheapest first
LIGHT_PREFERRED = [
  'qwen3.6-flash', 'qwen3.6-flash-2026-04-16', 'qwen-turbo', 'qwen-flash',
  'qwen3.5-flash', 'qwen3.5-flash-2026-02-23',
  'qwen3.6-27b', 'qwen3.6-35b-a3b',
  'qwen3.7-plus', 'qwen3.7-plus-2026-05-26',
  'qwen3.5-plus',
]
HEAVY_PREFERRED = [
  'qwen3.7-max', 'qwen3.7-max-2026-06-08', 'qwen3.7-max-2026-05-17', 'qwen3.7-max-2026-05-20',
  'qwen3.7-max-preview', 'qwq-plus',
  'qwen3.6-plus-2026-04-02', 'qwen3.5-plus-2026-04-20', 'qwen3.6-max-preview',
  'qwen3-max', 'qwen-max', 'qwen3.5-plus-2026-02-15',
]
SEARCH_MODEL    = ['deepseek-v3.2']
```

`selectModelsForTier(qwenSources)` filters preferred models against all available models, returns `{lightModels, heavyModels, searchModels}`.

### Task-to-Tier Mapping

```js
classifyReply()       → callAI(prompt, 'light')
detectPlaceholders()  → callAI(prompt, 'light')
researchWithAI()      → callAI(prompt, 'light')
extractAccurateKeywords() → callAI(prompt, 'light')  // KEYWORD extraction uses light tier — saves tokens vs heavy
generateEmail()       → callAI(prompt, 'heavy')
verifyDraft()         → callAI(prompt, 'heavy')
suggestReply()        → callAI(prompt, 'heavy')
webSearch tasks       → callAI(prompt, 'search')  // deepseek-v3.2 with enableWebSearch
```

**Why keyword extraction is LIGHT tier:** `extractAccurateKeywords` only needs to pick 3 keywords from provided text — no deep reasoning needed. Using heavy models wastes ~5x tokens. On validation failure, fall back directly to local TF-IDF (no redundant 2nd AI attempt).

### Tiered Timeouts

```js
const TIER_TIMEOUTS = { light: 15000, heavy: 25000, search: 30000 };
```

Search tier gets 30s because web search tool calls add latency.

## Multi-Source Qwen Rotation

`callQwen()` builds combos from all sources dynamically:

```js
const combos = [];
for (const src of config.qwenSources) {
  for (const model of src.models) {
    combos.push({ model, apiKey: src.apiKey, baseUrl: src.baseUrl, source: src.source });
  }
}
```

Round-robin `qwenComboIndex` rotates across all combos. On success, advance index. On 429, skip to next. On exhausted, skip.

When `qwenApiSource` is specified (e.g., 'qwen1'), filter to that source only.

**Key insight:** The number of sources is not hardcoded anywhere in `callQwen()` or `selectModelsForTier()` — they use `config.qwenSources` dynamically. Adding a new key file just requires bumping the loop in `loadApiKeys.js`.

## Gemini: 3 Keys × Models = Combos

Same combo pattern. 3 keys × models = more quota slots.

### Gemini Search Grounding

When using Gemini for search-tier or preferGemini calls, add `google_search` tool grounding for real-time web data:

```js
// callGemini accepts options parameter
async function callGemini(prompt, preferredModel, timeout, options = {}) {
  const { enableSearchGrounding = false } = options;
  const modelConfig = { model: combo.model, generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } };
  if (enableSearchGrounding) {
    modelConfig.tools = [{ google_search: {} }];  // Google Search grounding tool
  }
  const model = genAI.getGenerativeModel(modelConfig);
}
```

In `callAI`, search-tier and preferGemini Gemini calls pass `{ enableSearchGrounding: true }`. This gives Gemini grounded web results without needing deepseek-v3.2's separate web search tool.

## Provider Priority in callAI

Qwen always first:

```js
// tier='search' → deepseek-v3.2 first with enableWebSearch, then fallback
// tier='heavy'  → Qwen heavy model → Gemini → OpenAI
// tier='light'  → Qwen light model → Gemini → OpenAI
const hasQwenSources = config.qwenSources.length > 0;
providers = [
  { name: 'qwen', fn: () => callQwen(prompt, preferred.qwen, timeout, options), enabled: hasQwenSources },
  { name: 'gemini', fn: () => callGemini(prompt, preferred.gemini, timeout), enabled: config.geminiApiKeys.length > 0 },
  { name: 'openai', fn: () => callOpenAI(prompt, timeout), enabled: !!config.openaiApiKey },
].filter(p => p.enabled);
```

With `aiFallbackEnabled`, providers cascade on failure with exponential backoff.

## Token Optimization — Prompt Compression

Shorter prompts = fewer tokens. Reduce by ~60%:
- Use key:value format: `Name:${dossier.name}`
- Truncate: `pageText.slice(0, 3000)`
- System message: just "JSON only. No markdown."

### Deduplicated Prompt Constants

Repeated prompt fragments (like NAME_RULES) were previously inlined 3× across different prompts (search, processing, researchWithAI). Now extracted to a shared constant:

```js
// backend/src/prompts/nameRules.js
export const NAME_RULES_PROMPT = `STRICT NAME RULES:
- "name" MUST be a real person name (e.g. "Guihai Chen", "Xuandong Li"), NOT a title/department/field
- For Chinese names like "Prof. Guihai CHEN": surname is the ALL-CAPS word → "Chen"
...`;
```

Imported in `threeAgentResearch.js` and `ai/index.js` via `${NAME_RULES_PROMPT}` template interpolation. Deduplicating saves ~200 tokens per professor processed.

### Auto-Reset Token Usage on Scheduler Start

`resetTokenUsage()` is called in `startScheduler()` so token quotas start fresh each server restart. Without this, accumulated tokens from a previous run would incorrectly mark models as exhausted.

## Adding a New Qwen API Key — Step-by-Step

1. Add text file: `API-Keys/Qwen API/Qwen-API-{N}.txt` with the same format
2. Bump loop in `loadApiKeys.js`: `for (let i = 1; i <= N; i++)` (currently `i <= 4`)
3. Verify the key line format in the file — some files use `API:` others use `API Key:`
4. Test parsing: `cd backend && node -e "import('./src/config/loadApiKeys.js').then(m => { const r = m.loadApiKeys(); console.log(r.qwenSources.map(s => s.source + ' (' + s.models.length + ' models)')); })"`
5. Check the new key's models against tier preferred lists — add any new capable models
6. Restart backend

**No changes needed** in `ai/index.js` or `config/index.js` — they use `config.qwenSources` dynamically. `apiCallStats` auto-populates. `getApiStats()` auto-sums.

## .gitignore

`API-Keys/` must be in `.gitignore` — these are secrets. `.env` also gitignored.

## When to Apply

- When adding a new Qwen/Gemini/OpenAI account — just add a text file, bump loop, restart
- When changing model selection — update `selectModelsForTier()` preferred lists
- When user says "optimize tokens", "use models wisely", "add more API accounts"
- When a model is permanently throttled (503) — remove from preferred lists in `selectModelsForTier`

## Diagnostic Signals

- `[loadApiKeys] Qwen API 1: 15 models, key=sk-ws-H.ILLR...` → keys loaded correctly from text files
- `[loadApiKeys] Qwen API 3: file not found or key missing` → **likely regex mismatch** — check if file uses `API Key:` instead of `API:`
- `[Qwen:qwen1:qwen3.7-plus] 429 — rotating` → quota hit, rotation working
- `[Qwen] 503 ServiceUnavailable` → model throttled, remove from preferred list
- `/api-usage` endpoint returns all qwen source stats → dynamically tracked