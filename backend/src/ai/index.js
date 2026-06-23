import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { config } from '../config/index.js';
import { performWebSearch, WEB_SEARCH_TOOL } from './webSearch.js';
import { delay } from '../pipeline/utils.js';
import { NAME_RULES_PROMPT } from '../prompts/nameRules.js';
import { normalizeInterestLineKeywords } from '../utils/interestLine.js';
import { currentTenantKey } from '../db/index.js';

function safeParseJSON(text) {
  if (!text) throw new Error('AI returned empty response');
  try { return JSON.parse(text); } catch {}

  // Find the outermost balanced JSON object using bracket counting
  let bestStart = -1;
  let bestDepth = Infinity;

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let valid = true;

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
          try { return JSON.parse(candidate); } catch { valid = false; break; }
        }
      }
    }

    // Track smallest valid-lookalike block for fallback
    if (!valid && depth >= 0) {
      // no valid parse from this start
    }
  }

  // Fallback: try regex but only on the smallest match first
  const matches = text.match(/\{[^{}]*\}/g);
  if (matches) {
    for (const m of matches) {
      try { return JSON.parse(m); } catch {}
    }
  }

  throw new Error('AI returned invalid JSON: ' + text.slice(0, 100));
}

// ── Model rotation state + token tracking ────────────────────────
const tenantAiStates = new Map();
const MODEL_TOKEN_LIMIT = 1_000_000;  // 1M per model per API

function aiState() {
  const tenant = currentTenantKey() || 'anonymous';
  if (!tenantAiStates.has(tenant)) {
    tenantAiStates.set(tenant, {
      geminiComboIndex: 0,
      qwenComboIndex: 0,
      modelTokenUsage: {},
      reasoningTokenUsage: {},
      apiCallStats: { openai: 0 },
    });
  }
  return tenantAiStates.get(tenant);
}

function isModelExhausted(model, source) {
  const key = source ? `${model}@${source}` : model;
  const used = aiState().modelTokenUsage[key] || 0;
  if (used >= MODEL_TOKEN_LIMIT) {
    console.log(`[Tokens] ${key} exhausted (${used}/${MODEL_TOKEN_LIMIT}) — skipping`);
    return true;
  }
  return false;
}

function trackTokenUsage(usage, source) {
  if (!usage) return;
  const model = usage.model;
  const total = usage.total_tokens || 0;
  const reasoning = usage.reasoning_tokens || 0;
  const key = source ? `${model}@${source}` : model;
  if (model) {
    const state = aiState();
    state.modelTokenUsage[key] = (state.modelTokenUsage[key] || 0) + total;
    if (reasoning > 0) {
      state.reasoningTokenUsage[key] = (state.reasoningTokenUsage[key] || 0) + reasoning;
      console.log(`[Tokens] ${key}: reasoning=${reasoning}, total=${total}`);
    }
  }
}

export function getTokenUsage() {
  const state = aiState();
  return { output: { ...state.modelTokenUsage }, reasoning: { ...state.reasoningTokenUsage } };
}
export function resetTokenUsage() {
  tenantAiStates.delete(currentTenantKey() || 'anonymous');
}

// Get total available tokens across all Qwen APIs
export function getTotalQwenTokens() {
  return config.qwenSources.reduce((sum, s) => sum + s.models.length, 0) * MODEL_TOKEN_LIMIT;
}

// Get API usage statistics
export function getApiStats() {
  const apiCallStats = aiState().apiCallStats;
  const qwenTotal = config.qwenSources.reduce((sum, s) => sum + (apiCallStats[s.source] || 0), 0);
  const geminiTotal = config.geminiSources.reduce((sum, s) => sum + (apiCallStats[s.source] || 0), 0);
  return {
    ...apiCallStats,
    total: qwenTotal + geminiTotal + apiCallStats.openai,
    qwenTotal,
    geminiTotal,
  };
}

function isRateLimitError(e) {
  const msg = e.message || '';
  return msg.includes('429') || msg.includes('rate') || msg.includes('quota') || msg.includes('Too Many Requests');
}

// ── Gemini: 2 keys × 7 models = 14 combos, each with its own 20/day quota ──
function getGeminiCombos() {
  const combos = [];
  for (const key of config.geminiApiKeys) {
    for (const model of config.geminiModels) {
      combos.push({ key, model });
    }
  }
  return combos;
}

async function callGemini(prompt, preferredModel, timeout, options = {}) {
  const combos = getGeminiCombos();
  if (!combos.length) throw new Error('No Gemini keys/models configured');

  const { enableSearchGrounding = false } = options;

  // If a preferred model is specified, start from the first combo with that model
  let startIdx = 0;
  if (preferredModel) {
    const idx = combos.findIndex(c => c.model === preferredModel);
    if (idx >= 0) startIdx = idx;
  } else {
    startIdx = aiState().geminiComboIndex % combos.length;
  }

  for (let i = 0; i < combos.length; i++) {
    const idx = (startIdx + i) % combos.length;
    const combo = combos[idx];
    // Determine which Gemini source this key belongs to
    const geminiSource = config.geminiSources.find(s => s.apiKey === combo.key)?.source || 'gemini';
    try {
      const genAI = new GoogleGenerativeAI(combo.key);
      const modelConfig = {
        model: combo.model,
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      };
      // Add Google Search grounding for search-tier calls
      if (enableSearchGrounding) {
        modelConfig.tools = [{ google_search: {} }];
      }
      const model = genAI.getGenerativeModel(modelConfig);
      const result = await model.generateContent(
        { contents: [{ role: 'user', parts: [{ text: prompt }] }] },
        { timeout }
      );
      aiState().geminiComboIndex = idx + 1;  // advance rotation on success
      const apiCallStats = aiState().apiCallStats;
      apiCallStats[geminiSource] = (apiCallStats[geminiSource] || 0) + 1;
      // Track token usage from Gemini response
      const geminiUsage = result.response?.usageMetadata;
      if (geminiUsage) {
        trackTokenUsage({
          model: combo.model,
          total_tokens: geminiUsage.totalTokenCount || 0,
          prompt_tokens: geminiUsage.promptTokenCount || 0,
          completion_tokens: geminiUsage.candidatesTokenCount || 0,
        }, geminiSource);
      }
      console.log(`[Gemini] ✓ ${combo.model} (${geminiSource})`);
      const parsed = safeParseJSON(result.response.text());
      parsed.__model = combo.model;
      parsed.__provider = geminiSource;
      return parsed;
    } catch (e) {
      if (isRateLimitError(e)) {
        console.log(`[Gemini] 429 on ${combo.model} — rotating to next combo`);
        continue;  // try next combo
      }
      if (i === combos.length - 1) throw e;  // non-rate-limit error, exhausted all combos
      console.log(`[Gemini] ${combo.model} error: ${e.message.slice(0, 60)} — trying next`);
    }
  }
  throw new Error('All Gemini combos rate-limited');
}

// ── Qwen: Multiple APIs with model rotation ────────────────────────
async function callQwen(prompt, preferredModel, timeout, options = {}) {
  const { enableWebSearch = false, maxToolCalls = 3, qwenApiSource = null } = options;

  // Build combined model pool from all Qwen API sources
  const combos = [];
  for (const src of config.qwenSources) {
    for (const model of src.models) {
      combos.push({
        model,
        apiKey: src.apiKey,
        baseUrl: src.baseUrl,
        source: src.source,
      });
    }
  }

  // Filter by API source if explicitly specified
  let filteredCombos = combos;
  if (qwenApiSource) {
    filteredCombos = combos.filter(c => c.source === qwenApiSource);
    console.log(`[Qwen] Explicit source: ${qwenApiSource} (Agent assigned)`);
  }

  if (!filteredCombos.length) throw new Error('No Qwen models configured');

  // Determine starting point for rotation
  let startIdx = 0;
  if (preferredModel) {
    const idx = filteredCombos.findIndex(c => c.model === preferredModel);
    if (idx >= 0) startIdx = idx;
  } else {
    startIdx = aiState().qwenComboIndex % filteredCombos.length;
  }

  for (let i = 0; i < filteredCombos.length; i++) {
    const idx = (startIdx + i) % filteredCombos.length;
    const combo = filteredCombos[idx];
    if (!combo.apiKey || !combo.baseUrl) continue;
    if (isModelExhausted(combo.model, combo.source)) continue;

    try {
      const isDeepseek = combo.model === 'deepseek-v3.2';
      let messages = [
        { role: 'system', content: 'JSON only. No markdown.' },
        { role: 'user', content: prompt },
      ];

      const body = {
        model: combo.model,
        messages,
        temperature: 0.2,
      };

      // Enable web search ONLY for deepseek-v3.2
      if (isDeepseek && enableWebSearch) {
        body.tools = [WEB_SEARCH_TOOL];
        body.tool_choice = 'auto';
        // Can't use JSON mode with tools
      } else {
        body.response_format = { type: 'json_object' };
      }

      let toolCallCount = 0;

      // Tool calling loop
      while (toolCallCount <= maxToolCalls) {
        const res = await axios.post(`${combo.baseUrl}/chat/completions`, body, {
          headers: { Authorization: `Bearer ${combo.apiKey}` },
          timeout: timeout * (toolCallCount + 1), // Extend timeout for tool calls
        });

        // Update rotation index and track usage
        aiState().qwenComboIndex = idx + 1;  // Next call starts from next combo in pool
        const usage = res.data.usage || {};
        // Track reasoning_tokens from thinking models separately
        if (usage.completion_tokens_details?.reasoning_tokens) {
          trackTokenUsage({ model: combo.model, total_tokens: usage.total_tokens, reasoning_tokens: usage.completion_tokens_details.reasoning_tokens }, combo.source);
        } else {
          trackTokenUsage(usage, combo.source);
        }
        const apiCallStats = aiState().apiCallStats;
        apiCallStats[combo.source] = (apiCallStats[combo.source] || 0) + 1;

        const tokenKey = `${combo.model}@${combo.source}`;
        const used = aiState().modelTokenUsage[tokenKey] || 0;

        const choice = res.data.choices[0];
        const message = choice.message;

        // Strip reasoning_content from thinking models before JSON parsing
        if (message.reasoning_content) {
          console.log(`[Qwen:${combo.source}:${combo.model}] Thinking model — stripped reasoning (${message.reasoning_content.length} chars)`);
        }

        // Check if model wants to call web_search tool
        if (message.tool_calls?.length > 0 && toolCallCount < maxToolCalls) {
          console.log(`[Qwen:${combo.source}:${combo.model}] Tool calls requested: ${message.tool_calls.length}`);

          // Execute each tool call
          for (const toolCall of message.tool_calls) {
            if (toolCall.function.name === 'web_search') {
              const args = JSON.parse(toolCall.function.arguments);
              const searchResult = await performWebSearch(args.query);

              messages.push(message); // Add assistant message with tool_calls
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                name: 'web_search',
                content: searchResult
              });

              console.log(`[Qwen:${combo.source}:${combo.model}] Web search: "${args.query}" → ${searchResult.length} chars`);
            }
          }

          // Update body with new messages for next iteration
          body.messages = messages;
          toolCallCount++;
          continue; // Loop again to get final response
        }

        // No tool calls - return final response
        console.log(`[Qwen:${combo.source}] ✓ ${combo.model} tokens:${used}/${MODEL_TOKEN_LIMIT}`);

        const content = message.content || '';  // reasoning_content already stripped — not included

        // If we used tools, extract JSON from text response
        if (toolCallCount > 0) {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            parsed.__model = combo.model;
            parsed.__provider = combo.source;
            parsed.__tool_calls_used = toolCallCount;
            return parsed;
          }
          // No JSON found, wrap response
          return {
            extracted_data: content,
            tool_calls_used: toolCallCount,
            __model: combo.model,
            __provider: combo.source
          };
        }

        // Standard JSON response
        const parsed = safeParseJSON(content);
        parsed.__model = combo.model;
        parsed.__provider = combo.source;
        return parsed;
      }

      throw new Error(`Max tool calls (${maxToolCalls}) reached for ${combo.model}`);

    } catch (e) {
      if (isRateLimitError(e)) {
        console.log(`[Qwen:${combo.source}] 429 on ${combo.model} — rotating to next model`);
        continue;
      }
      if (i === combos.length - 1) throw e;
      console.log(`[Qwen:${combo.source}] ${combo.model} error: ${e.message?.slice(0, 60)} — trying next`);
    }
  }
  throw new Error('All Qwen models rate-limited');
}

// ── OpenAI fallback (unchanged) ─────────────────────────────────────
async function callOpenAI(prompt, timeout) {
  if (!config.openaiApiKey) throw new Error('No OpenAI key');
  const res = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'JSON only. No markdown.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  }, {
    headers: { Authorization: `Bearer ${config.openaiApiKey}` },
    timeout,
  });
  const apiCallStats = aiState().apiCallStats;
  apiCallStats.openai = (apiCallStats.openai || 0) + 1;
  // Track token usage from OpenAI response
  if (res.data.usage) {
    trackTokenUsage({
      model: 'gpt-4o-mini',
      total_tokens: res.data.usage.total_tokens || 0,
      prompt_tokens: res.data.usage.prompt_tokens || 0,
      completion_tokens: res.data.usage.completion_tokens || 0,
    }, 'openai');
  }
  console.log(`[OpenAI] ✓ gpt-4o-mini`);
  const parsed = safeParseJSON(res.data.choices[0].message.content);
  parsed.__model = 'gpt-4o-mini';
  parsed.__provider = 'openai';
  return parsed;
}

// ── Tiered AI dispatch ───────────────────────────────────────────────
// Model tiers — populated from config (parsed from text files)
// Light: fast/cheap models for research, extraction, classification
// Heavy: quality models for email generation, verification
// Search: deepseek-v3.2 exclusively for web search tasks
const TIER_TIMEOUTS = { light: 15000, heavy: 25000, search: 30000 };

function pickPreferredModel(tier) {
  const qwenPool = tier === 'light' ? config.lightModels
    : tier === 'heavy' ? config.heavyModels
    : tier === 'search' ? config.searchModels
    : config.heavyModels;
  const geminiPool = tier === 'light' ? ['gemini-2-flash-lite', 'gemini-2.5-flash-lite', 'gemini-3.1-flash-lite']
    : tier === 'heavy' ? ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-3-flash']
    : [];
  const gemini = geminiPool.find(m => config.geminiModels.includes(m));
  const qwen = qwenPool[0];
  return { gemini, qwen };
}

async function callAI(prompt, tier = 'heavy', options = {}) {
  const {
    enableWebSearch = false,
    preferDeepseek = false,
    preferQwen = false,
    preferGemini = false,
    qwenApiSource = null,
  } = options;

  const preferred = pickPreferredModel(tier);
  const timeout = TIER_TIMEOUTS[tier] || 25000;
  const hasQwenSources = config.qwenSources.length > 0;

  let providers = [];

  if (tier === 'search') {
    // Search tier: deepseek-v3.2 exclusively, then Gemini with search grounding, then heavy models
    providers = [
      { name: 'qwen', fn: () => callQwen(prompt, 'deepseek-v3.2', timeout, { ...options, enableWebSearch: true }), enabled: hasQwenSources && config.searchModels.includes('deepseek-v3.2') },
      { name: 'qwen', fn: () => callQwen(prompt, preferred.qwen, timeout, options), enabled: hasQwenSources },
      { name: 'gemini', fn: () => callGemini(prompt, preferred.gemini, timeout, { enableSearchGrounding: true }), enabled: config.geminiApiKeys.length > 0 && config.geminiModels.length > 0 },
      { name: 'openai', fn: () => callOpenAI(prompt, timeout), enabled: !!config.openaiApiKey },
    ];
  } else if (preferDeepseek) {
    providers = [
      { name: 'qwen', fn: () => callQwen(prompt, 'deepseek-v3.2', timeout, options), enabled: hasQwenSources && config.searchModels.includes('deepseek-v3.2') },
      { name: 'qwen', fn: () => callQwen(prompt, preferred.qwen, timeout, options), enabled: hasQwenSources },
      { name: 'gemini', fn: () => callGemini(prompt, preferred.gemini, timeout, { enableSearchGrounding: true }), enabled: config.geminiApiKeys.length > 0 && config.geminiModels.length > 0 },
      { name: 'openai', fn: () => callOpenAI(prompt, timeout), enabled: !!config.openaiApiKey },
    ];
  } else if (preferQwen) {
    providers = [
      { name: 'qwen', fn: () => callQwen(prompt, preferred.qwen, timeout, options), enabled: hasQwenSources },
      { name: 'gemini', fn: () => callGemini(prompt, preferred.gemini, timeout), enabled: config.geminiApiKeys.length > 0 && config.geminiModels.length > 0 },
      { name: 'openai', fn: () => callOpenAI(prompt, timeout), enabled: !!config.openaiApiKey },
    ];
  } else if (preferGemini) {
    providers = [
      { name: 'gemini', fn: () => callGemini(prompt, preferred.gemini, timeout, { enableSearchGrounding: true }), enabled: config.geminiApiKeys.length > 0 && config.geminiModels.length > 0 },
      { name: 'qwen', fn: () => callQwen(prompt, preferred.qwen, timeout, options), enabled: hasQwenSources },
      { name: 'openai', fn: () => callOpenAI(prompt, timeout), enabled: !!config.openaiApiKey },
    ];
  } else {
    providers = [
      { name: 'qwen', fn: () => callQwen(prompt, preferred.qwen, timeout, options), enabled: hasQwenSources },
      { name: 'gemini', fn: () => callGemini(prompt, preferred.gemini, timeout), enabled: config.geminiApiKeys.length > 0 && config.geminiModels.length > 0 },
      { name: 'openai', fn: () => callOpenAI(prompt, timeout), enabled: !!config.openaiApiKey },
    ];
  }

  providers = providers.filter(p => p.enabled);

  if (!providers.length) throw new Error('No AI providers configured');

  if (!config.aiFallbackEnabled) {
    return await providers[0].fn();
  }

  let backoffCount = 0;
  for (const provider of providers) {
    try {
      return await provider.fn();
    } catch (e) {
      const isLast = providers.indexOf(provider) === providers.length - 1;
      if (isRateLimitError(e) && !isLast) {
        backoffCount++;
        const backoffMs = 1000 * 2 ** (backoffCount - 1);  // 1s, 2s, 4s, ...
        console.log(`[AI] ${provider.name} rate-limited — waiting ${backoffMs}ms before next provider`);
        await delay(backoffMs);
        continue;
      }
      if (!isRateLimitError(e) && !isLast) {
        backoffCount = 0;  // reset backoff on non-rate-limit errors
        console.log(`[AI] ${provider.name} failed: ${e.message?.slice(0, 60)} — waiting 500ms before next provider`);
        await delay(500);
        continue;
      }
      throw e;
    }
  }
  throw new Error('All AI providers failed');
}

// ── Public API functions ──────────────────────────────────────────────

// Export callAI for three-agent research system
export { callAI };

// ── Keyword extraction with validation and fallback ────────────────────

/**
 * Validate that a keyword appears in the source text (case-insensitive, fuzzy for acronyms).
 * Returns true if the keyword (or a known acronym expansion) is found in the concatenated texts.
 */
export function keywordFoundInSource(keyword, sourceTexts) {
  const kw = keyword.toLowerCase().trim();
  const combined = sourceTexts.join(' ').toLowerCase();

  // Direct match
  if (combined.includes(kw)) return true;

  // Fuzzy acronym expansion: "LLM" ↔ "large language model", "NLP" ↔ "natural language processing", etc.
  const ACRONYM_MAP = {
    'llm': 'large language model',
    'nlp': 'natural language processing',
    'cv': 'computer vision',
    'ml': 'machine learning',
    'dl': 'deep learning',
    'ai': 'artificial intelligence',
    'ir': 'information retrieval',
    'hci': 'human computer interaction',
    'iot': 'internet of things',
    'rl': 'reinforcement learning',
    'gnn': 'graph neural network',
    'gan': 'generative adversarial network',
    'cnn': 'convolutional neural network',
    'rnn': 'recurrent neural network',
    'lstm': 'long short-term memory',
    'slam': 'simultaneous localization and mapping',
    'sdr': 'software defined radio',
    'sdn': 'software defined networking',
    'federated learning': 'federated learning',
    'neural network': 'neural network',
    'deep neural network': 'deep neural network',
  };
  const expanded = ACRONYM_MAP[kw];
  if (expanded && combined.includes(expanded)) return true;

  // Reverse: keyword might be an expansion of an acronym in the text
  for (const [acro, full] of Object.entries(ACRONYM_MAP)) {
    if (kw === full && combined.includes(acro)) return true;
  }

  // Token overlap: accept if most keyword words appear in source
  const kwTokens = kw.split(/[\s,/]+/).filter(t => t.length > 2);
  if (kwTokens.length > 0) {
    const matched = kwTokens.filter(t => combined.includes(t)).length;
    if (matched / kwTokens.length >= 0.67) return true;
  }

  return false;
}

/** Build all text sources for keyword validation from a dossier. */
export function buildKeywordSourceTexts(dossier) {
  const papers = (dossier?.papers || []).map(p => p.title || p).filter(Boolean);
  const projects = (dossier?.projects || []).map(p => (typeof p === 'string' ? p : p?.title || '')).filter(Boolean);
  const interests = (dossier?.research_areas || []).join(', ');
  const rosterKeywords = [
    dossier?.subject_keyword || '',
    dossier?.interest_line || '',
    dossier?.roster?.research_interest || '',
  ].filter(Boolean).join(', ');
  return [
    interests,
    rosterKeywords,
    projects.join(', '),
    papers.slice(0, 15).join('\n'),
    dossier?.department || '',
    dossier?.title || '',
    dossier?.profile_summary || '',
    dossier?.research_evidence || '',
    ...(dossier?.research_areas || []),
    ...projects,
  ].filter(Boolean);
}

/** Uploaded roster rows with explicit subject + interest keywords — trust without scrape validation. */
export function hasRosterUploadedKeywords(dossier) {
  if (!dossier || dossier.research_source !== 'roster') return false;
  const subject = String(dossier.subject_keyword || '').trim();
  const interest = String(dossier.interest_line || '').trim();
  if (!subject || !interest) return false;
  const parts = interest.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
  return parts.length >= 1;
}

const VAGUE_SINGLE_WORDS = new Set([
  'research', 'study', 'studies', 'analysis', 'academic', 'novel', 'efficient',
  'effective', 'general', 'advanced', 'modern', 'innovative', 'work', 'field',
  'area', 'areas', 'topic', 'topics', 'based', 'using', 'approach', 'method',
  'framework', 'application', 'problem', 'solution', 'process', 'result', 'results',
]);

/** Reject vague or non-specific keywords that are not real professor research labels. */
export function isGenericKeyword(keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw || kw.length < 3) return true;
  if (VAGUE_SINGLE_WORDS.has(kw)) return true;
  const tokens = kw.split(/[\s,/]+/).filter(t => t.length > 0);
  if (tokens.length > 0 && tokens.every(t => VAGUE_SINGLE_WORDS.has(t) || t.length < 3)) return true;
  if (/^(research|study|analysis|academic|novel|efficient|effective)$/i.test(kw)) return true;
  if (/^areas?\s+of\s+interest(s)?$/i.test(kw)) return true;
  if (/^research\s+interests?$/i.test(kw)) return true;
  return false;
}

export function normalizeProfessorKeyword(term) {
  return String(term || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function uniqueProfessorKeywords(terms) {
  const seen = new Set();
  const out = [];
  for (const term of terms) {
    const normalized = normalizeProfessorKeyword(term);
    const key = normalized.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function parseResearchAreaPhrases(dossier) {
  const phrases = [];
  for (const raw of dossier?.research_areas || []) {
    for (const part of String(raw).split(/[,;|•·]/)) {
      for (const sub of part.split(/[/&]/)) {
        const cleaned = sub.trim().replace(/\s+/g, ' ');
        if (cleaned.length >= 3) phrases.push(cleaned);
      }
    }
  }
  return uniqueProfessorKeywords(phrases);
}

/** Every keyword must appear in professor source text and be non-generic. */
export function validateKeywordSet(subject, interestKeywords, sourceTexts) {
  if (!subject || isGenericKeyword(subject)) return false;
  if (!keywordFoundInSource(subject, sourceTexts)) return false;

  const interests = (interestKeywords || []).map(s => String(s).trim()).filter(Boolean);
  if (interests.length < 2) return false;

  const seen = new Set([subject.toLowerCase()]);
  for (const kw of interests) {
    if (!kw || isGenericKeyword(kw)) return false;
    if (!keywordFoundInSource(kw, sourceTexts)) return false;
    const key = kw.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/**
 * Pick subject + interest keywords only from verified professor research areas and papers.
 * Never invents terms — returns empty when nothing is grounded in source text.
 */
export function selectVerifiedProfessorKeywords(dossier) {
  const sourceTexts = buildKeywordSourceTexts(dossier);
  const areaCandidates = parseResearchAreaPhrases(dossier).filter(
    t => !isGenericKeyword(t) && keywordFoundInSource(t, sourceTexts),
  );

  const papers = (dossier?.papers || []).map(p => p.title || p).filter(Boolean);
  const local = localKeywordExtractor(papers, areaCandidates.join(', ') || (dossier?.research_areas || []).join(', '));
  const localCandidates = uniqueProfessorKeywords([
    local?.subject_keyword,
    ...(local?.interest_keywords || []),
  ].filter(Boolean)).filter(
    t => !isGenericKeyword(t) && keywordFoundInSource(t, sourceTexts),
  );

  const allCandidates = uniqueProfessorKeywords([...areaCandidates, ...localCandidates]);
  if (!allCandidates.length) {
    return { subject_keyword: '', interest_keywords: [], error: 'no verified keywords', source: 'none' };
  }

  // Explicit scraped research areas are the most trustworthy — use them directly when possible.
  if (areaCandidates.length >= 2) {
    const subject = areaCandidates[0];
    const interest_keywords = areaCandidates.slice(1, 4);
    if (validateKeywordSet(subject, interest_keywords, sourceTexts)) {
      return {
        subject_keyword: subject,
        interest_keywords,
        interest_line: interest_keywords.join(', '),
        source: 'profile_scrape',
        validated: true,
      };
    }
  }

  const subject = areaCandidates[0] || allCandidates[0];
  const subjectKey = subject.toLowerCase();

  const interestPool = uniqueProfessorKeywords([
    ...areaCandidates.slice(1),
    ...allCandidates.filter(c => c.toLowerCase() !== subjectKey),
  ]).filter(t => t.toLowerCase() !== subjectKey);

  const interest_keywords = interestPool.slice(0, 3);
  if (interest_keywords.length < 2) {
    return { subject_keyword: '', interest_keywords: [], error: 'insufficient verified keywords', source: 'none' };
  }

  if (!validateKeywordSet(subject, interest_keywords, sourceTexts)) {
    return { subject_keyword: '', interest_keywords: [], error: 'keyword validation failed', source: 'none' };
  }

  const rawLine = interest_keywords.join(', ');
  return {
    subject_keyword: subject,
    interest_keywords,
    interest_line: interest_keywords.join(', '),
    source: areaCandidates.length ? 'profile_scrape' : 'profile_local',
    validated: true,
  };
}

function storedKeywordsAreVerified(dossier) {
  if (!dossier?.subject_keyword || !dossier?.interest_line) return false;
  const interests = dossier.interest_line.split(',').map(s => s.trim()).filter(Boolean);
  return validateKeywordSet(dossier.subject_keyword, interests, buildKeywordSourceTexts(dossier));
}

/**
 * Local TF-IDF-like keyword extractor as fallback when AI fails.
 * Extracts bigrams and trigrams from publication titles, ranks by frequency.
 */
export function localKeywordExtractor(publicationTitles, researchInterestsText) {
  const allTexts = [...publicationTitles, researchInterestsText];
  const combined = allTexts.join(' ').toLowerCase();

  // Stopwords to filter out
  const STOPWORDS = new Set([
    'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
    'from','as','is','was','are','were','be','been','being','have','has','had',
    'do','does','did','will','would','could','should','may','might','can',
    'this','that','these','those','it','its','they','them','their','we','our',
    'you','your','he','his','she','her','i','my','me','not','no','nor',
    'so','if','then','than','too','very','just','also','only','even','still',
    'already','yet','ever','never','always','often','usually','sometimes',
    'here','there','where','when','how','what','which','who','whose','whom',
    'all','each','every','both','few','many','much','more','most','some',
    'any','other','another','such','same','different','new','old','big',
    'small','long','short','high','low','good','bad','best','worst',
    'using','based','approach','method','model','system','study','research',
    'analysis','investigation','framework','algorithm','technique','performance',
    'evaluation','result','data','problem','solution','application','process',
    'effect','impact','comparison','novel','proposed','efficient','effective',
  ]);

  const words = combined.replace(/[^\w\s-]/g, '').split(/\s+/).filter(w => w.length >= 2 && !STOPWORDS.has(w));

  // Extract bigrams
  const bigramCounts = {};
  for (let i = 0; i < words.length - 1; i++) {
    const bg = `${words[i]} ${words[i + 1]}`;
    bigramCounts[bg] = (bigramCounts[bg] || 0) + 1;
  }

  // Extract trigrams
  const trigramCounts = {};
  for (let i = 0; i < words.length - 2; i++) {
    const tg = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    trigramCounts[tg] = (trigramCounts[tg] || 0) + 1;
  }

  // Also include single research interest terms
  const interestTerms = researchInterestsText.toLowerCase().split(/[,;•·]/).map(s => s.trim()).filter(s => s.length >= 3);
  const interestCounts = {};
  for (const term of interestTerms) {
    const key = term.replace(/[^\w\s-]/g, '').trim();
    if (key && !STOPWORDS.has(key)) interestCounts[key] = 10; // boost interest terms
  }

  // Merge and rank
  const allCandidates = { ...bigramCounts, ...trigramCounts, ...interestCounts };
  const ranked = Object.entries(allCandidates)
    .sort((a, b) => b[1] - a[1])
    .filter(([term]) => term.length >= 3 && term.length <= 60 && !isGenericKeyword(term))
    .slice(0, 12)
    .map(([term]) => term);

  if (ranked.length === 0) {
    return { subject_keyword: '', interest_keywords: [], error: 'insufficient data' };
  }

  const capitalizeTerm = (term) => normalizeProfessorKeyword(term);

  return {
    subject_keyword: capitalizeTerm(ranked[0]),
    interest_keywords: ranked.slice(1, 4).map(capitalizeTerm).filter(k => k && !isGenericKeyword(k)),
    source: 'local_tf_idf',
  };
}

const GENERIC_KEYWORDS = /^(research|study|analysis|academic)$/i;

/** Derive keywords directly from scraped profile data — no web search. */
export function keywordsFromProfileOnly(dossier) {
  const areas = (dossier?.research_areas || []).filter(Boolean);
  const papers = dossier?.papers || [];
  if (!areas.length && !papers.length) return null;

  const result = selectVerifiedProfessorKeywords(dossier);
  if (result.error || !result.subject_keyword || result.interest_keywords?.length < 2) return null;
  return result;
}

/**
 * extractAccurateKeywords — constrained AI keyword extraction with post-validation.
 * Zero-shot prompt ensures keywords are derived only from provided research info.
 * Falls back to TF-IDF extraction if AI fails twice.
 */
export async function extractAccurateKeywords(professorContext, publicationTitles, researchInterestsText, options = {}) {
  const department = professorContext.department || 'Unknown';
  const titles = publicationTitles || professorContext.papers || [];
  const interests = researchInterestsText || professorContext.research_areas?.join(', ') || '';
  const allowWebAi = options.allowWebAi ?? !!(
    professorContext.web_search_requested
    || professorContext.research_source === 'web_search'
    || professorContext.profile_research_status === 'web_complete'
    || professorContext.search_model
  );

  if (!interests && titles.length === 0) {
    return { subject_keyword: '', interest_keywords: [], error: 'insufficient data', source: 'none' };
  }

  const verifiedFirst = selectVerifiedProfessorKeywords({
    ...professorContext,
    research_areas: professorContext.research_areas || interests.split(',').map(s => s.trim()).filter(Boolean),
    papers: titles,
  });
  if (verifiedFirst?.subject_keyword && verifiedFirst.interest_keywords?.length >= 2 && !verifiedFirst.error) {
    console.log(`[AI:Keywords] Verified profile keywords for ${professorContext.email || 'unknown'}`);
    return verifiedFirst;
  }

  const profileSources = new Set(['profile_data', 'profile_verified', 'directory_card', 'directory_dom', 'profile_deep_scrape', 'json_ld']);
  const hasScrapedProfile = profileSources.has(professorContext.research_source)
    || (professorContext.research_evidence && interests);
  if (hasScrapedProfile || (interests && titles.length > 0)) {
    const fromProfile = keywordsFromProfileOnly({
      ...professorContext,
      research_areas: professorContext.research_areas || interests.split(',').map(s => s.trim()).filter(Boolean),
      papers: titles,
    });
    if (fromProfile?.subject_keyword && !fromProfile.error) {
      console.log(`[AI:Keywords] Using profile-scraped keywords for ${professorContext.email || 'unknown'}`);
      return fromProfile;
    }
  }

  const sourceTexts = buildKeywordSourceTexts(professorContext);
  const local = localKeywordExtractor(titles, interests);
  if (
    local?.subject_keyword
    && local.interest_keywords?.length >= 2
    && !isGenericKeyword(local.subject_keyword)
    && validateKeywordSet(local.subject_keyword, local.interest_keywords, sourceTexts)
  ) {
    return { ...local, source: 'profile_local', validated: true };
  }

  if (!allowWebAi) {
    return { subject_keyword: '', interest_keywords: [], error: 'insufficient data', source: 'profile_only' };
  }

  const titlesStr = titles.slice(0, 15).map(p => p.title || p).join('\n');

  const prompt = `You are an academic research assistant. Based ONLY on the following professor's actual research information from internet search and profile (do not invent or generalise), output a JSON object with exactly:
{
  "subject_keyword": "one broad, high-level term that best categorises their research area (e.g., Cybersecurity, Transportation Engineering, Speech Recognition)",
  "interest_keywords": ["specific term 1", "specific term 2", "specific term 3"]
}

Rules:
- Keywords MUST come from the professor's REAL research_areas, publication titles, or department focus
- Choose the most dominant verified area for subject_keyword (1-3 words max)
- The three interest_keywords must be specific sub-topics from their papers or stated interests
- Do NOT use generic words like "research", "study", "analysis", "system", "model" alone
- Do NOT use the student's background (AI/ML) — only the PROFESSOR's work
- If insufficient verified information, return {"error": "insufficient data"}

Professor:
- Name: ${professorContext.name || 'unknown'}
- Email: ${professorContext.email || 'unknown'}
- Department: ${department}
- Research Areas: ${interests}
- Publication Titles: ${titlesStr}
- Profile evidence: ${(professorContext.research_evidence || '').slice(0, 1500)}`;

  // Attempt 1: AI generation (LIGHT tier — keyword extraction doesn't need heavy models)
  try {
    const result = await callAI(prompt, 'light');
    if (result.error === 'insufficient data') {
      const verifiedFallback = selectVerifiedProfessorKeywords({
        ...professorContext,
        research_areas: professorContext.research_areas || interests.split(',').map(s => s.trim()).filter(Boolean),
        papers: titles,
      });
      if (verifiedFallback?.subject_keyword) return verifiedFallback;
      return { subject_keyword: '', interest_keywords: [], error: 'insufficient data', source: 'none' };
    }

    const subjectKw = result.subject_keyword || '';
    const interestKws = result.interest_keywords || [];

    // Post-validation: check each keyword appears in source texts
    const invalidKeywords = [];
    if (subjectKw && !keywordFoundInSource(subjectKw, sourceTexts)) {
      invalidKeywords.push({ type: 'subject_keyword', keyword: subjectKw });
    }
    for (const kw of interestKws) {
      if (!keywordFoundInSource(kw, sourceTexts)) {
        invalidKeywords.push({ type: 'interest_keyword', keyword: kw });
      }
    }

    if (invalidKeywords.length === 0 && validateKeywordSet(subjectKw, interestKws, sourceTexts)) {
      return {
        subject_keyword: subjectKw,
        interest_keywords: interestKws.slice(0, 3),
        source: 'ai_constrained',
        validated: true,
      };
    }

    console.log(`[AI:Keywords] Validation failed — invalid keywords: ${JSON.stringify(invalidKeywords)}. Falling back to verified profile keywords.`);
    const verifiedFallback = selectVerifiedProfessorKeywords({
      ...professorContext,
      research_areas: professorContext.research_areas || interests.split(',').map(s => s.trim()).filter(Boolean),
      papers: titles,
    });
    if (verifiedFallback?.subject_keyword && verifiedFallback.interest_keywords?.length >= 2) {
      return verifiedFallback;
    }
    return localKeywordExtractor(titlesStr ? titles : [], interests);
  } catch (e) {
    console.error('[AI:Keywords] Attempt 1 failed:', e.message);
    // Skip redundant second attempt — go directly to local TF-IDF
    return localKeywordExtractor(titlesStr ? titles : [], interests);
  }
}

export async function generateTopicAndInterest(dossier, resume, topTopics, targetingHints = '') {
  const hints = targetingHints ? `\nAnalytics:${targetingHints}` : '';
  const prompt = `Generate research topic+interest for cold email to professor.
Dossier:${JSON.stringify(dossier)} Resume:${resume} Topics:${topTopics}${hints}
RULE: interestLine must be ONLY 3 comma-separated research keywords from the professor's profile — NOT a full sentence. The template already says "I am particularly interested in your work in {{INTEREST_LINE}}." so {{INTEREST_LINE}} gets replaced with just the keywords (no period).
Example: interestLine="Distributed Systems, Cloud Computing, Big Data Processing"
JSON:{"topic":"1-3 word field","interestLine":"keyword1, keyword2, keyword3"}`;
  return await callAI(prompt, 'heavy');
}

export async function verifyDraft(subject, lastName, interestLine, dossier, email) {
  const reasons = [];
  const subjectWords = (subject || '').trim().split(/\s+/).filter(Boolean).length;
  const interestWords = (interestLine || '').trim().split(/\s+/).filter(Boolean).length;

  if (!lastName || String(lastName).trim().length < 2) reasons.push('Last name missing or too short');
  if (subjectWords > 8) reasons.push('Subject too long');
  if (!interestLine || interestLine.length < 5) reasons.push('Interest line too short');
  if (interestWords > 30) reasons.push('Interest line exceeds 30 words');
  if (/^(research|study|analysis|academic)$/i.test((dossier?.subject_keyword || '').trim())) {
    reasons.push('Generic subject keyword');
  }

  const sourceTexts = buildKeywordSourceTexts(dossier);
  const interestParts = (interestLine || '').split(',').map(s => s.trim()).filter(Boolean);
  if (interestParts.length >= 2) {
    if (!validateKeywordSet(dossier?.subject_keyword || subject.match(/^\[([^\]]+)\]/)?.[1] || subject, interestParts, sourceTexts)) {
      reasons.push('Interest keywords not grounded in professor research');
    }
  }

  const profileOnly = !!(
    !dossier?.web_search_requested
    && !dossier?.search_model
    && dossier?.profile_research_status !== 'web_complete'
    && (
      ['profile_scrape', 'profile_local', 'roster'].includes(dossier?.keyword_source)
      || (dossier?.subject_keyword && dossier?.interest_line && dossier.profile_research_status === 'profile_found')
      || dossier?.research_source === 'roster'
    )
  );

  if (profileOnly) return { pass: reasons.length === 0, reasons };
  if (reasons.length === 0) return { pass: true, reasons: [] };

  const prompt = `Verify email draft for ${email}:
Subject:${subject} LastName:${lastName} InterestLine:${interestLine} Dossier:${JSON.stringify(dossier)}
Check: 1) Subject SHORT (2-4 words+&), FAIL if >5 or sentence 2) LastName matches 3) InterestLine cites REAL work 4) No hallucinations 5) FAIL if email_verified=false and cites papers
JSON:{"pass":true/false,"reasons":["reason if fail"]}`;
  return await callAI(prompt, 'heavy');
}

export async function classifyReply(body, scenarios = []) {
  const scenarioList = scenarios.map(s => ({
    id: s.id,
    name: s.name,
    description: s.description || '',
  }));
  const prompt = `Analyze this professor email reply accurately.
Reply:
${body}

Active reply scenarios:
${JSON.stringify(scenarioList)}

Rules:
- classification must be positive, negative, auto_reply, or other.
- auto_reply includes out-of-office, leave, vacation, and automated acknowledgements.
- Only select a scenario when the email clearly matches it.
- If uncertain, scenario_id must be null and confidence must be below 0.75.
- Do not invent facts.

JSON:{"classification":"positive/negative/auto_reply/other","summary":"one line","scenario_id":null,"scenario_confidence":0.0}`;
  return await callAI(prompt, 'light');
}

export async function detectPlaceholders(html) {
  const prompt = `Find last name+interest line placeholders in email HTML.\nHTML:${html}\nJSON:{"lastName":"exact text","interestLine":"exact text"}`;
  return await callAI(prompt, 'light');
}

export async function researchWithAI(dossier) {
  const prompt = `Verify professor data. No hallucination. ${NAME_RULES_PROMPT}
Name:${dossier.name} Email:${dossier.email} Uni:${dossier.university} Areas:${dossier.research_areas?.join(',')} Papers:${JSON.stringify(dossier.papers?.slice(0,2))}
${dossier.note || ''}
JSON:{"verified_name":"Full Person Name or null","department":"dept or null","research_areas":["verified only, max 5","no paper titles"],"confidence":"high/low"}`;
  return await callAI(prompt, 'light');
}

export async function extractEmailsWithAI(pageText) {
  const prompt = `Extract professor emails from page. Only real academic emails.\nPage:${pageText.slice(0, 3000)}\nJSON:{"professors":[{"email":"prof@uni.edu","name":"Full Name"}]}`;
  return await callAI(prompt, 'light');
}

export async function generateFromInstructions(dossier, templateInstructions, sampleSubject, targetingHints = '') {
  const hints = targetingHints ? `\nAnalytics (what works best):${targetingHints}` : '';
  const prompt = `You are an email personalization assistant for a student seeking MS/PhD positions in Computer Science and related fields (AI, ML, NLP, Data Science, Computer Vision, Software Engineering).

STRICT RULES:
1. Topic: Pick 1-3 SPECIFIC keywords from professor's research_areas that overlap with CS/AI/ML fields
   - Available areas: ${(dossier.research_areas || []).join(', ')}
   - Pick the MOST SPECIFIC sub-field, not generic terms
2. Interest Line:
   - Output ONLY 3 comma-separated research area keywords — NOT a full sentence
   - The email template already contains "I am particularly interested in your work in {{INTEREST_LINE}}."
   - So {{INTEREST_LINE}} is replaced with just the keywords, e.g. "Distributed Systems, Cloud Computing, Big Data Processing"
   - DO NOT repeat "I am particularly interested in your work in" — that's already in the template
   - DO NOT add a period — the template already has the period after {{INTEREST_LINE}}
   - DO NOT cite paper titles, publications, or citation details — only research area keywords
   - NEVER use generic phrases like "Computer Science" or "your research"

Professor Data:
- Email: ${dossier.email}
- Name: ${dossier.name}
- Last Name: ${dossier.last_name || dossier.name?.split(/\s/).pop()}
- Department: ${dossier.department || 'unknown'}
- Research Areas: ${(dossier.research_areas || []).join(', ') || 'unknown'}
- Recent Papers: ${(dossier.papers || []).slice(0, 5).map(p => p.title || p).join('; ') || 'none'}
- Email Verified: ${dossier.email_verified ? 'YES' : 'NO'}

Template Instructions:
${templateInstructions}${hints}

Subject Format: ${sampleSubject || '[Keyword] Seeking MS/PhD Position'}

Self-Check (be STRICT):
- pass=false if interest line exceeds 30 words
- pass=false if topic doesn't match any research_area
- pass=false if interestLine contains the phrase "I am particularly interested" (the template already has it — interestLine must be ONLY keywords)
- pass=false if interestLine cites paper titles or publications (should be keywords only)
- pass=false if interestLine uses generic phrases
- pass=false if you had to make up or guess paper titles
- pass=true ONLY if interestLine is 3 comma-separated keywords, max 30 words, no paper titles, no sentence wrapper

Return JSON: {"topic":"...", "interestLine":"...", "pass":true/false, "selfCheck":"reason"}`;
  return await callAI(prompt, 'heavy');
}

export async function generateEmail(dossier, instructions, sampleSubject, targetingHints, profLastName) {
  const hasStoredKeywords = !!(dossier?.subject_keyword && dossier?.interest_line);
  const keywordSource = dossier?.keyword_source || dossier?.profile_research_status || 'profile_scrape';

  if (
    hasStoredKeywords
    && (hasRosterUploadedKeywords(dossier) || storedKeywordsAreVerified(dossier))
    && (dossier.profile_research_status === 'profile_found' || dossier.profile_research_status === 'web_complete' || dossier.research_source === 'roster')
  ) {
    const il = normalizeInterestLineKeywords(dossier.interest_line || '');
    return {
      topic: dossier.subject_keyword,
      interestLine: il,
      pass: true,
      reasons: [],
      model: keywordSource,
      provider: keywordSource,
      keyword_source: keywordSource,
      keyword_validated: true,
    };
  }

  const hasResearchData = (dossier.research_areas?.length >= 1) || (dossier.papers?.length >= 1);

  if (hasResearchData) {
    try {
      const kwResult = await extractAccurateKeywords(
        dossier,
        dossier.papers || [],
        (dossier.research_areas || []).join(', ')
      );

      if (kwResult.subject_keyword && kwResult.interest_keywords?.length >= 2 && !kwResult.error) {
        const interestLine = normalizeInterestLineKeywords(kwResult.interest_keywords.slice(0, 3).join(', '));
        const topic = kwResult.subject_keyword;
        const sourceTexts = buildKeywordSourceTexts(dossier);

        let pass = validateKeywordSet(topic, kwResult.interest_keywords.slice(0, 3), sourceTexts);
        const reasons = [];
        if (interestLine.split(/\s+/).length > 30) { pass = false; reasons.push('interestLine exceeds 30 words'); }
        if (topic.split(/\s+/).length > 6) { pass = false; reasons.push('topic too long'); }
        if (isGenericKeyword(topic)) { pass = false; reasons.push('generic subject keyword'); }

        if (pass) {
          return {
            topic,
            interestLine,
            pass: true,
            reasons: [],
            model: kwResult.source || 'unknown',
            provider: 'constrained_keywords',
            keyword_source: kwResult.source,
            keyword_validated: kwResult.validated || false,
          };
        }
      }
    } catch (e) {
      console.log('[AI:Email] extractAccurateKeywords failed:', e.message);
    }
  }

  const usedWebSearch = !!(dossier.web_search_requested || dossier.research_source === 'web_search' || dossier.profile_research_status === 'web_complete');
  if (!usedWebSearch) {
    return {
      topic: '',
      interestLine: '',
      pass: false,
      reasons: ['Insufficient profile data — use Web Search in the queue'],
      model: 'profile_only',
      provider: 'profile_only',
    };
  }

  // Web-researched dossier only — AI drafting from verified internet data
  const result = instructions
    ? await generateFromInstructions(dossier, instructions, sampleSubject, targetingHints)
    : await generateTopicAndInterest(dossier, '', '', targetingHints);

  let topic = result.topic || '';
  if (topic.split(/\s+/).length > 6) topic = topic.split(/\s+/).slice(0, 4).join(' ');

  return {
    topic,
    interestLine: normalizeInterestLineKeywords(result.interestLine || ''),
    pass: result.pass === true,
    reasons: result.pass === false ? [result.selfCheck || 'Self-check failed'] : [],
    model: result.__model || 'unknown',
    provider: result.__provider || 'unknown',
  };
}

export async function suggestReply({ professor_email, original_subject, reply_classification, reply_summary, original_email_html, style_samples = [] }) {
  const toneGuide = {
    positive: 'Write an enthusiastic, grateful acceptance. Express sincere excitement about the opportunity and appreciation for the professor\'s willingness to connect.',
    negative: 'Write a polite, respectful decline. Thank the professor for their time and consideration. Keep it gracious and professional.',
    neutral: 'Write a concise, professional informational reply. Acknowledge the professor\'s response and address any points raised. Keep it brief and clear.',
  };
  const tone = toneGuide[reply_classification] || toneGuide.neutral;

  const styleGuide = Array.isArray(style_samples) && style_samples.length
    ? `\nWRITING STYLE — mirror the tone, length, vocabulary, greeting, and sign-off of these replies the sender actually wrote to professors. Match their voice; do NOT copy their content:\n${style_samples.map((sample, index) => `Past reply ${index + 1}:\n${sample}`).join('\n\n')}\n`
    : '';

  const prompt = `You are writing a reply email from a student seeking MS/PhD positions.

ORIGINAL EMAIL FROM PROFESSOR (HTML):
${original_email_html || 'Not provided'}

CLASSIFICATION: ${reply_classification}
SUMMARY OF PROFESSOR\'S REPLY: ${reply_summary}

TONE: ${tone}
${styleGuide}
RULES:
1. Reply must be SHORT — 3-5 sentences maximum, never more than 6 sentences
2. Professional and personalized — reference specific points from the professor\'s reply summary
3. Format as clean HTML suitable for Gmail compose (simple <p> tags, no fancy styling, no CSS, no colors, no images)
4. Subject must be "Re: " followed by the original subject (strip any existing "Re:" prefix first to avoid stacking)
5. Do NOT include email headers, signatures with phone numbers, or lengthy introductions
6. Match the tone described above based on classification
7. If classification is positive, show genuine enthusiasm but remain professional
8. If classification is negative, be gracious — no pushiness or complaint
9. Sign off with just your first name (no full signature block)

JSON:{"suggested_reply_html":"<p>...</p>","reply_subject":"Re: Original Subject"}`;

  const result = await callAI(prompt, 'heavy');

  // Ensure subject follows Re: pattern (strip stacked Re: prefixes)
  const baseSubject = original_subject ? original_subject.replace(/^Re:\s*/i, '') : 'Your Email';
  const replySubject = result.reply_subject || `Re: ${baseSubject}`;

  return {
    suggested_reply_html: result.suggested_reply_html || '',
    reply_subject: replySubject,
  };
}
