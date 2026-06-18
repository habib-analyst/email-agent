import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../../..');
const API_KEYS_DIR = resolve(PROJECT_ROOT, 'API-Keys');

function parseQwenFile(filePath) {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, 'utf-8');
  const apiKey = (content.match(/API\s+Key:\s*(.+)/) || content.match(/API:\s*(.+)/))?.[1]?.trim();
  const baseUrl = content.match(/OpenAI Compatible Endpoint:\s*(.+)/)?.[1]?.trim();
  const modelsSection = content.match(/Available Models list on this Account are following:\s*\n([\s\S]*?)$/)?.[1];
  const models = modelsSection
    ? modelsSection.split('\n').map(m => m.trim()).filter(m => m.length > 0)
    : [];
  return { apiKey, baseUrl, models };
}

function parseGeminiFile(filePath) {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, 'utf-8');
  const apiKey = content.match(/API Key:\s*(.+)/)?.[1]?.trim();
  return apiKey;
}

function parseOpenaiFile(filePath) {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, 'utf-8');
  const apiKey = content.match(/Openai API:\s*(.+)/)?.[1]?.trim();
  if (!apiKey) {
    // Fallback: try to extract any sk-proj-... key
    const match = content.match(/sk-proj-[a-zA-Z0-9_-]+/);
    return match ? match[0] : null;
  }
  return apiKey;
}

export function loadApiKeys() {
  const qwenSources = [];
  for (let i = 1; i <= 4; i++) {
    const fileName = `Qwen-API-${i}.txt`;
    const filePath = resolve(API_KEYS_DIR, 'Qwen API', fileName);
    const parsed = parseQwenFile(filePath);
    if (parsed?.apiKey) {
      qwenSources.push({
        apiKey: parsed.apiKey,
        baseUrl: parsed.baseUrl,
        models: parsed.models,
        source: `qwen${i}`,
      });
      console.log(`[loadApiKeys] Qwen API ${i}: ${parsed.models.length} models, key loaded`);
    } else {
      console.warn(`[loadApiKeys] Qwen API ${i}: file not found or key missing (${filePath})`);
    }
  }

  const geminiKeys = [];
  const geminiSources = [];
  for (let i = 1; i <= 3; i++) {
    const fileName = `Geimini-API -${i}.txt`;
    const filePath = resolve(API_KEYS_DIR, 'Gemini API', fileName);
    const key = parseGeminiFile(filePath);
    if (key) {
      geminiKeys.push(key);
      geminiSources.push({ source: `gemini${i}`, apiKey: key });
      console.log(`[loadApiKeys] Gemini API ${i}: key loaded`);
    } else {
      console.warn(`[loadApiKeys] Gemini API ${i}: file not found or key missing (${filePath})`);
    }
  }

  const openaiFilePath = resolve(API_KEYS_DIR, 'Openapi API', 'Openai-API -1.txt');
  const openaiApiKey = parseOpenaiFile(openaiFilePath);
  if (openaiApiKey) {
    console.log('[loadApiKeys] OpenAI: key loaded');
  } else {
    console.warn(`[loadApiKeys] OpenAI: file not found or key missing`);
  }

  return { qwenSources, geminiKeys, geminiSources, openaiApiKey };
}

export function selectModelsForTier(qwenSources) {
  // Smart rotation: pick best few models per tier from available models
  // Ordered by preference — token-cheapest first
  const LIGHT_PREFERRED = [
    'qwen3.6-flash', 'qwen3.6-flash-2026-04-16', 'qwen-turbo', 'qwen-flash',
    'qwen3.5-flash', 'qwen3.5-flash-2026-02-23',
    'qwen3.6-27b', 'qwen3.6-35b-a3b',
    'qwen3.7-plus', 'qwen3.7-plus-2026-05-26',
    'qwen3.5-plus',
  ];
  const HEAVY_PREFERRED = [
    'qwen3.7-max', 'qwen3.7-max-2026-06-08', 'qwen3.7-max-2026-05-17', 'qwen3.7-max-2026-05-20',
    'qwen3.7-max-preview', 'qwq-plus',
    'qwen3.6-plus-2026-04-02', 'qwen3.5-plus-2026-04-20', 'qwen3.6-max-preview',
    'qwen3-max', 'qwen-max', 'qwen3.5-plus-2026-02-15',
  ];
  const SEARCH_MODEL = 'deepseek-v3.2';

  const allAvailable = qwenSources.flatMap(s => s.models);

  const lightModels = LIGHT_PREFERRED.filter(m => allAvailable.includes(m));
  const heavyModels = HEAVY_PREFERRED.filter(m => allAvailable.includes(m));
  const searchModels = allAvailable.includes(SEARCH_MODEL) ? [SEARCH_MODEL] : [];

  console.log(`[loadApiKeys] Model tiers: light=${lightModels.length}, heavy=${heavyModels.length}, search=${searchModels.length}`);

  return { lightModels, heavyModels, searchModels };
}
