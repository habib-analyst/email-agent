import dotenv from 'dotenv';
import { resolve } from 'path';
import { loadApiKeys, selectModelsForTier } from './loadApiKeys.js';

dotenv.config({ path: resolve(import.meta.dirname, '../../.env') });

// Load API keys + model lists from text files
const apiKeys = loadApiKeys();
const modelTiers = selectModelsForTier(apiKeys.qwenSources);

function validateConfig(cfg) {
  const warnings = [];
  if (!cfg.googleClientId || !cfg.googleClientSecret) warnings.push('GOOGLE_CLIENT_ID/SECRET missing — Gmail auth will fail');
  if (!apiKeys.qwenSources.length && !apiKeys.geminiKeys.length && !apiKeys.openaiApiKey) warnings.push('No AI provider configured');
  if (!cfg.senderEmail || cfg.senderEmail === 'your-email@gmail.com') warnings.push('SENDER_EMAIL not set');
  if (warnings.length) {
    console.warn('[Config] ⚠ Startup warnings:');
    warnings.forEach(w => console.warn(`  - ${w}`));
  }
  return warnings;
}

export const config = {
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/auth/callback',

  // Qwen: API sources parsed from text files
  qwenSources: apiKeys.qwenSources,

  // Gemini: keys parsed from text files
  geminiApiKeys: apiKeys.geminiKeys,
  geminiSources: apiKeys.geminiSources,
  geminiModels: (process.env.GEMINI_MODELS || 'gemini-2.5-flash').split(',').map(s => s.trim()),

  // OpenAI: 1 key parsed from text file
  openaiApiKey: apiKeys.openaiApiKey,
  aiKeyMode: 'global',

  // Model tiers (computed from available models across all Qwen sources)
  lightModels: modelTiers.lightModels,
  heavyModels: modelTiers.heavyModels,
  searchModels: modelTiers.searchModels,

  port: parseInt(process.env.PORT || '3001'),
  senderEmail: process.env.SENDER_EMAIL || '',
  senderName: process.env.SENDER_NAME || '',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  aiFallbackEnabled: process.env.AI_FALLBACK_ENABLED !== 'false',
  dryRunSend: process.env.DRY_RUN_SEND === 'true',
};

export const configWarnings = validateConfig(config);
