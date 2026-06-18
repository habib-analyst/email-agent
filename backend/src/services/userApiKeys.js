import axios from 'axios';
import { randomUUID } from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import db from '../db/index.js';
import { config } from '../config/index.js';
import { loadApiKeys, selectModelsForTier } from '../config/loadApiKeys.js';
import { roleForEmail } from './tenantRegistry.js';

const DEFAULT_QWEN_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_QWEN_MODELS = ['qwen-turbo', 'qwen-plus', 'qwen-flash'];

export function parseUserApiKeys(raw) {
  if (!raw) return { keys: [] };
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return normalizeStoredKeys(parsed);
  } catch {
    return { keys: [] };
  }
}

export function normalizeStoredKeys(parsed) {
  if (!parsed || typeof parsed !== 'object') return { keys: [] };
  if (Array.isArray(parsed.keys)) {
    return {
      keys: parsed.keys
        .filter(k => k?.key)
        .map(k => ({
          id: k.id || randomUUID(),
          key: k.key,
          baseUrl: k.baseUrl || k.base_url || '',
        })),
    };
  }
  const keys = [];
  if (parsed.gemini?.key) keys.push({ id: 'legacy-gemini', key: parsed.gemini.key, baseUrl: '' });
  if (parsed.qwen?.key) keys.push({ id: 'legacy-qwen', key: parsed.qwen.key, baseUrl: parsed.qwen.baseUrl || '' });
  if (parsed.openai?.key) keys.push({ id: 'legacy-openai', key: parsed.openai.key, baseUrl: '' });
  return { keys };
}

export function serializeUserApiKeys(obj) {
  return JSON.stringify(normalizeStoredKeys(obj));
}

export function maskApiKey(key) {
  if (!key || key.length < 8) return key ? '••••' : '';
  return `••••••••${key.slice(-4)}`;
}

export function isMaskedKey(value) {
  return typeof value === 'string' && value.startsWith('••••');
}

export function userApiKeysForClient(stored) {
  const { keys } = parseUserApiKeys(stored);
  return {
    keys: keys.map(k => ({
      id: k.id,
      masked: maskApiKey(k.key),
      base_url: k.baseUrl || '',
    })),
  };
}

export function mergeUserApiKeys(existing, incoming) {
  const stored = parseUserApiKeys(existing);
  if (!incoming?.keys || !Array.isArray(incoming.keys)) return stored;

  const existingById = new Map(stored.keys.map(k => [k.id, k]));
  const result = [];

  for (const item of incoming.keys) {
    if (item.remove && item.id) {
      existingById.delete(item.id);
      continue;
    }
    const prev = item.id ? existingById.get(item.id) : null;
    const key = item.key && !isMaskedKey(item.key) ? item.key.trim() : prev?.key;
    if (!key) continue;
    const baseUrl = item.baseUrl !== undefined
      ? String(item.baseUrl || '').trim()
      : (prev?.baseUrl || '');
    result.push({
      id: item.id || randomUUID(),
      key,
      baseUrl,
    });
  }

  return { keys: result };
}

export function detectProvider(key, baseUrl) {
  const k = String(key || '').trim();
  if (baseUrl) return 'compatible';
  if (k.startsWith('AIza')) return 'gemini';
  if (k.startsWith('sk-')) return 'openai';
  return 'compatible';
}

export function mergeUserKeysIntoConfig(userKeys) {
  const fileKeys = loadApiKeys();
  const { keys } = parseUserApiKeys(userKeys);
  const usingUserKeys = keys.length > 0;
  const senderEmail = db.prepare('SELECT sender_email FROM settings WHERE id=1').get()?.sender_email;
  const isAdmin = roleForEmail(senderEmail) === 'admin';
  const includeGlobalKeys = isAdmin || !usingUserKeys;

  const qwenSources = includeGlobalKeys ? [...fileKeys.qwenSources] : [];
  const geminiKeys = includeGlobalKeys ? [...fileKeys.geminiKeys] : [];
  const geminiSources = includeGlobalKeys ? [...fileKeys.geminiSources] : [];
  let openaiApiKey = includeGlobalKeys ? fileKeys.openaiApiKey : null;

  const fileModels = fileKeys.qwenSources.flatMap(s => s.models || []);
  const defaultModels = fileModels.length ? [...new Set(fileModels)].slice(0, 8) : DEFAULT_QWEN_MODELS;

  keys.forEach((entry, i) => {
    const provider = detectProvider(entry.key, entry.baseUrl);
    const source = `user_${i + 1}`;

    if (provider === 'gemini') {
      geminiKeys.unshift(entry.key);
      geminiSources.unshift({ source, apiKey: entry.key });
      return;
    }

    if (provider === 'openai' && !entry.baseUrl) {
      openaiApiKey = entry.key;
      return;
    }

    const baseUrl = (entry.baseUrl || DEFAULT_QWEN_BASE).replace(/\/$/, '');
    qwenSources.unshift({
      apiKey: entry.key,
      baseUrl,
      models: defaultModels,
      source,
    });
  });

  config.qwenSources = qwenSources;
  config.geminiApiKeys = geminiKeys;
  config.geminiSources = geminiSources;
  config.openaiApiKey = openaiApiKey;
  config.aiKeyMode = isAdmin
    ? (usingUserKeys ? 'admin_global_and_custom' : 'admin_global')
    : (usingUserKeys ? 'user_only' : 'global');

  const tiers = selectModelsForTier(qwenSources);
  config.lightModels = tiers.lightModels;
  config.heavyModels = tiers.heavyModels;
  config.searchModels = tiers.searchModels;
}

export function applyUserApiKeysFromDb() {
  try {
    const row = db.prepare('SELECT user_api_keys FROM settings WHERE id=1').get();
    mergeUserKeysIntoConfig(row?.user_api_keys);
    import('../ai/index.js').then(({ resetTokenUsage }) => resetTokenUsage()).catch(() => {});
  } catch (e) {
    console.warn('[userApiKeys] Could not apply keys from DB:', e.message);
  }
}

async function testGemini(key) {
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await model.generateContent('Reply with exactly: OK');
  const text = result.response?.text?.()?.trim() || '';
  if (!text) throw new Error('Empty response from API');
  return 'Gemini key verified';
}

async function testOpenai(key) {
  const res = await axios.get('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
    timeout: 30000,
  });
  if (!res.data?.data?.length) throw new Error('OpenAI returned no models');
  return 'OpenAI key verified';
}

async function testCompatible(key, baseUrl) {
  const url = (baseUrl || DEFAULT_QWEN_BASE).replace(/\/$/, '');
  const res = await axios.post(`${url}/chat/completions`, {
    model: DEFAULT_QWEN_MODELS[0],
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    max_tokens: 10,
  }, {
    headers: { Authorization: `Bearer ${key}` },
    timeout: 30000,
  });
  if (!res.data?.choices?.length) throw new Error('API returned no choices');
  return 'API key verified (compatible endpoint)';
}

export async function testApiKeyAuto(apiKey, baseUrl) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('API key is required');

  const base = String(baseUrl || '').trim();
  if (base) {
    const msg = await testCompatible(key, base);
    return { ok: true, message: msg };
  }

  if (key.startsWith('AIza')) {
    const msg = await testGemini(key);
    return { ok: true, message: msg };
  }

  if (key.startsWith('sk-')) {
    try {
      const msg = await testOpenai(key);
      return { ok: true, message: msg };
    } catch (openaiErr) {
      try {
        const msg = await testCompatible(key, DEFAULT_QWEN_BASE);
        return { ok: true, message: msg };
      } catch {
        throw openaiErr;
      }
    }
  }

  const msg = await testCompatible(key, DEFAULT_QWEN_BASE);
  return { ok: true, message: msg };
}

/** @deprecated use testApiKeyAuto */
export async function testApiKey(provider, apiKey, baseUrl) {
  const result = await testApiKeyAuto(apiKey, baseUrl);
  return { ...result, provider: provider || detectProvider(apiKey, baseUrl) };
}
