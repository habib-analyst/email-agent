import { google } from 'googleapis';
import { getAuthedClient } from '../auth/index.js';
import { currentTenantKey } from '../db/index.js';
import { extractBody, cleanReplyBody } from './replies.js';

const MIN_SAMPLE_CHARS = 40;
const MAX_SAMPLE_CHARS = 1200;
const CACHE_TTL_MS = 10 * 60 * 1000;
const styleCaches = new Map();

export function selectReplyStyleSamples(messages, maxSamples = 3) {
  const seen = new Set();
  const samples = [];
  for (const message of messages || []) {
    const body = cleanReplyBody(extractBody(message?.payload));
    const normalized = body.replace(/\s+/g, ' ').trim();
    if (normalized.length < MIN_SAMPLE_CHARS) continue;
    const key = normalized.slice(0, 120).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    samples.push(body.length > MAX_SAMPLE_CHARS ? `${body.slice(0, MAX_SAMPLE_CHARS)}…` : body);
    if (samples.length >= maxSamples) break;
  }
  return samples;
}

export async function fetchUserReplyStyleSamples({ maxSamples = 3, force = false } = {}) {
  const tenant = currentTenantKey() || 'anonymous';
  const cached = styleCaches.get(tenant);
  if (!force && cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.samples;

  const auth = getAuthedClient();
  if (!auth) return [];
  const gmail = google.gmail({ version: 'v1', auth });
  const list = await gmail.users.messages.list({
    userId: 'me',
    labelIds: ['SENT'],
    q: 'subject:Re:',
    maxResults: 12,
  });
  const messages = [];
  for (const item of list.data.messages || []) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const full = await gmail.users.messages.get({ userId: 'me', id: item.id, format: 'full' });
      messages.push(full.data);
    } catch { /* skip unreadable message */ }
  }
  const samples = selectReplyStyleSamples(messages, maxSamples);
  styleCaches.set(tenant, { samples, ts: Date.now() });
  return samples;
}

export function clearReplyStyleCache() {
  const tenant = currentTenantKey() || 'anonymous';
  styleCaches.delete(tenant);
}
