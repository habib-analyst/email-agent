import { google } from 'googleapis';
import { config } from '../config/index.js';
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { encryptJson, decryptJson } from '../utils/secrets.js';

const LEGACY_TOKEN_PATH = resolve(import.meta.dirname, '../../.tokens.json');
const USER_DATA_DIR = resolve(import.meta.dirname, '../../user-data');
const ACTIVE_USER_PATH = resolve(USER_DATA_DIR, '.active-user');
const PROFILE_CACHE_MS = 30 * 60 * 1000;
let profileCache = null;
let userInfoUnavailable = false;
let lastProfileLogKey = '';
let pendingTokens = null;
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
  if (pendingTokens) return pendingTokens;
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
  return client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
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
  if (userInfoUnavailable) return null;
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth });
    const { data } = await oauth2.userinfo.get();
    return data.name?.trim() || null;
  } catch {
    userInfoUnavailable = true;
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
  profileCache = null;
  userInfoUnavailable = false;
  lastProfileLogKey = '';
}

export async function fetchGmailProfile({ force = false } = {}) {
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

  profileCache = { email, name, at: Date.now() };

  const logKey = `${email}|${name || ''}`;
  if (logKey !== lastProfileLogKey) {
    lastProfileLogKey = logKey;
    if (name) {
      console.log(`[Auth] Gmail display name resolved: "${name}" <${email}>`);
    } else {
      console.warn(`[Auth] Could not resolve Gmail display name for ${email} — reconnect Gmail if name is wrong`);
    }
  }

  return { email, name };
}

export async function handleCallback(code) {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  pendingTokens = tokens;
  return tokens;
}

export function commitPendingTokens() {
  if (!pendingTokens) return;
  saveTokens(pendingTokens);
  pendingTokens = null;
}

export async function discardPendingTokens() {
  const tokens = pendingTokens;
  pendingTokens = null;
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
  if (!pendingTokens && !existsSync(activeTokenPath())) return false;
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
  if (!pendingTokens && !existsSync(tokenPath)) return;

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
  pendingTokens = null;
  try { unlinkSync(tokenPath); } catch {}
}
