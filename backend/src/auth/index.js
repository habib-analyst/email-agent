import { google } from 'googleapis';
import { config } from '../config/index.js';
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { encryptJson, decryptJson } from '../utils/secrets.js';
import { currentTenantKey } from '../db/index.js';
import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes } from 'crypto';

const LEGACY_TOKEN_PATH = resolve(import.meta.dirname, '../../.tokens.json');
const USER_DATA_DIR = resolve(import.meta.dirname, '../../user-data');
const ACTIVE_USER_PATH = resolve(USER_DATA_DIR, '.active-user');
const PROFILE_CACHE_MS = 30 * 60 * 1000;
const profileCaches = new Map();
const userInfoUnavailable = new Set();
const lastProfileLogKeys = new Map();
const pendingTokenContext = new AsyncLocalStorage();
const oauthStates = new Map();
export const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.settings.basic',
];

function createOAuth2Client() {
  return new google.auth.OAuth2(config.googleClientId, config.googleClientSecret, config.googleRedirectUri);
}

function activeTokenPath() {
  const tenant = currentTenantKey();
  if (tenant) return resolve(USER_DATA_DIR, tenant, '.tokens.json');
  try {
    const key = readFileSync(ACTIVE_USER_PATH, 'utf8').trim();
    if (key) return resolve(USER_DATA_DIR, key, '.tokens.json');
  } catch {}
  return LEGACY_TOKEN_PATH;
}

// Serialize concurrent token writes to prevent race conditions on .tokens.json
let writeLock = false;
let writeQueue = [];

function drainWriteQueue() {
  while (writeQueue.length > 0 && !writeLock) {
    const { tokens, path, resolve: res } = writeQueue.shift();
    writeLock = true;
    try {
      mkdirSync(resolve(path, '..'), { recursive: true });
      writeFileSync(path, encryptJson(tokens));
    } finally { writeLock = false; }
    res();
  }
}

function saveTokens(tokens, path = activeTokenPath()) {
  if (writeLock) {
    return new Promise(resolve => { writeQueue.push({ tokens, path, resolve }); });
  }
  writeLock = true;
  try {
    mkdirSync(resolve(path, '..'), { recursive: true });
    writeFileSync(path, encryptJson(tokens));
  } finally { writeLock = false; drainWriteQueue(); }
}

function loadTokens() {
  const pending = pendingTokenContext.getStore();
  if (pending) return pending;
  const path = activeTokenPath();
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  try {
    return decryptJson(raw);
  } catch {
    return JSON.parse(raw);
  }
}

export function getAuthUrl() {
  const client = createOAuth2Client();
  const state = randomBytes(24).toString('base64url');
  oauthStates.set(state, Date.now());
  for (const [key, createdAt] of oauthStates) {
    if (Date.now() - createdAt > 10 * 60 * 1000) oauthStates.delete(key);
  }
  return client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent', state });
}

/** Parse `"Habib Ur Rehman" <email@...>` → Habib Ur Rehman */
export function parseDisplayNameFromFromHeader(fromHeader) {
  if (!fromHeader) return null;
  const quoted = fromHeader.match(/^"((?:[^"\\]|\\.)+)"\s*</);
  if (quoted) return quoted[1].replace(/\\"/g, '"').trim();
  const plain = fromHeader.match(/^([^<]+)</);
  if (plain) {
    const n = plain[1].trim();
    if (n && !n.includes('@')) return n;
  }
  return null;
}

async function fetchNameFromUserInfo(auth) {
  const tenant = currentTenantKey() || 'anonymous';
  if (userInfoUnavailable.has(tenant)) return null;
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth });
    const { data } = await oauth2.userinfo.get();
    return data.name?.trim() || null;
  } catch {
    userInfoUnavailable.add(tenant);
    return null;
  }
}

async function fetchNameFromSendAs(gmail, email) {
  try {
    const sendAsRes = await gmail.users.settings.sendAs.list({ userId: 'me' });
    const aliases = sendAsRes.data?.sendAs || [];
    const match = aliases.find(s => s.sendAsEmail?.toLowerCase() === email.toLowerCase())
      || aliases.find(s => s.isPrimary)
      || aliases[0];
    if (!match) return null;
    let name = match.displayName?.trim() || null;
    if (!name && match.sendAsEmail) {
      const one = await gmail.users.settings.sendAs.get({
        userId: 'me',
        sendAsEmail: match.sendAsEmail,
      });
      name = one.data?.displayName?.trim() || null;
    }
    return name;
  } catch (e) {
    console.warn('[Auth] send-as display name unavailable:', e.message);
    return null;
  }
}

/** Read display name from the user's most recent sent message From header. */
async function fetchNameFromSentMail(gmail) {
  try {
    const list = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['SENT'],
      maxResults: 5,
    });
    for (const msg of list.data?.messages || []) {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From'],
      });
      const from = full.data.payload?.headers?.find(h => h.name?.toLowerCase() === 'from')?.value;
      const name = parseDisplayNameFromFromHeader(from);
      if (name) return name;
    }
  } catch (e) {
    console.warn('[Auth] sent-mail From header lookup failed:', e.message);
  }
  return null;
}

export function clearProfileCache() {
  const tenant = currentTenantKey() || 'anonymous';
  profileCaches.delete(tenant);
  userInfoUnavailable.delete(tenant);
  lastProfileLogKeys.delete(tenant);
}

export async function fetchGmailProfile({ force = false } = {}) {
  const tenant = currentTenantKey() || 'anonymous';
  const profileCache = profileCaches.get(tenant);
  if (!force && profileCache && Date.now() - profileCache.at < PROFILE_CACHE_MS) {
    return { email: profileCache.email, name: profileCache.name };
  }

  const auth = getAuthedClient();
  if (!auth) return null;

  const gmail = google.gmail({ version: 'v1', auth });
  const profileRes = await gmail.users.getProfile({ userId: 'me' });
  const email = profileRes.data?.emailAddress || null;
  if (!email) return null;

  const name =
    (await fetchNameFromUserInfo(auth))
    || (await fetchNameFromSendAs(gmail, email))
    || (await fetchNameFromSentMail(gmail))
    || null;

  profileCaches.set(tenant, { email, name, at: Date.now() });

  const logKey = `${email}|${name || ''}`;
  if (logKey !== lastProfileLogKeys.get(tenant)) {
    lastProfileLogKeys.set(tenant, logKey);
    if (name) {
      console.log(`[Auth] Gmail display name resolved: "${name}" <${email}>`);
    } else {
      console.warn(`[Auth] Could not resolve Gmail display name for ${email} — reconnect Gmail if name is wrong`);
    }
  }

  return { email, name };
}

export async function handleCallback(code, state) {
  const createdAt = oauthStates.get(String(state || ''));
  oauthStates.delete(String(state || ''));
  if (!createdAt || Date.now() - createdAt > 10 * 60 * 1000) {
    throw new Error('Invalid or expired OAuth state');
  }
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}

export function runWithPendingTokens(tokens, fn) {
  return pendingTokenContext.run(tokens, fn);
}

export function commitPendingTokens(tokens) {
  if (tokens) saveTokens(tokens);
}

export async function discardPendingTokens(tokens) {
  const token = tokens?.access_token || tokens?.refresh_token;
  if (!token) return;
  try {
    const client = createOAuth2Client();
    await client.revokeToken(token);
  } catch {}
}

export function getAuthedClient() {
  const tokens = loadTokens();
  if (!tokens) return null;
  const tokenPath = activeTokenPath();
  const client = createOAuth2Client();
  client.setCredentials(tokens);
  client.on('tokens', (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    saveTokens(merged, tokenPath);
    client.setCredentials(merged);
  });
  return client;
}

export function isAuthenticated() {
  if (!pendingTokenContext.getStore() && !existsSync(activeTokenPath())) return false;
  const tokens = loadTokens();
  return !!tokens && !!tokens.refresh_token;
}

export async function validateToken() {
  const tokens = loadTokens();
  if (!tokens || !tokens.refresh_token) return { valid: false, reason: 'missing' };

  const VALIDATE_TIMEOUT_MS = 12000;

  try {
    const client = createOAuth2Client();
    client.setCredentials(tokens);
    await Promise.race([
      client.refreshAccessToken(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Token validation timed out')), VALIDATE_TIMEOUT_MS),
      ),
    ]);
    return { valid: true, reason: 'ok' };
  } catch (e) {
    if (e.message?.includes('timed out')) {
      console.warn('[Auth] Token validation timed out — keeping existing tokens');
      return { valid: true, reason: 'timeout' };
    }
    if (
      e.message?.includes('invalid_grant') ||
      e.message?.includes('Token has been revoked') ||
      e.message?.includes('400')
    ) {
      console.error('[Auth] Token validation failed — tokens are invalid/revoked:', e.message);
      try { unlinkSync(activeTokenPath()); } catch { /* ignore */ }
      return { valid: false, reason: 'invalid' };
    }
    console.warn('[Auth] Token validation error (keeping tokens):', e.message);
    return { valid: isAuthenticated(), reason: 'error' };
  }
}

export async function disconnect() {
  const tokenPath = activeTokenPath();
  if (!existsSync(tokenPath)) return;

  try {
    const tokens = loadTokens();
    const client = createOAuth2Client();
    client.setCredentials(tokens);
    const tokenToRevoke = tokens.access_token || tokens.refresh_token;
    if (tokenToRevoke) await client.revokeToken(tokenToRevoke);
  } catch (e) {
    console.error('[Auth] Token revocation failed:', e.message);
  }

  clearProfileCache();
  try { unlinkSync(tokenPath); } catch {}
}
