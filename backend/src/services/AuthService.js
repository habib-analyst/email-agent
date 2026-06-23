import {
  getAuthUrl as oauthGetAuthUrl,
  handleCallback as oauthHandleCallback,
  fetchGmailProfile,
  getAuthedClient,
  isAuthenticated,
  validateToken,
  commitPendingTokens,
  discardPendingTokens,
  runWithPendingTokens,
  disconnect as oauthDisconnect,
} from '../auth/index.js';
import { eventBus } from '../core/EventBus.js';
import { config } from '../config/index.js';
import {
  getSenderIdentity,
  setConnectedSender,
  clearConnectedSender,
  pickSenderDisplayName,
  looksLikeDerivedName,
} from './senderIdentity.js';
import { clearGmailCache } from '../gmail/index.js';
import { ensureUserWorkspace, getActiveWorkspace, runWithTenantKey } from '../db/index.js';
import { invalidateUniversityOutreachCache } from '../learning/universityOutreach.js';
import { invalidateEpochCache } from '../session/epoch.js';
import { createTenantSession, registerTenant, roleForEmail, touchTenant } from './tenantRegistry.js';

const VALIDATE_CACHE_MS = 5 * 60 * 1000;
const validateCaches = new Map();
const validateInFlight = new Map();

function clearValidateCache() {
  const tenant = getActiveWorkspace().key || 'anonymous';
  validateCaches.delete(tenant);
  validateInFlight.delete(tenant);
}

async function stopRuntimeForWorkspaceChange() {
  const [{ PipelineService }, scheduler] = await Promise.all([
    import('./PipelineService.js'),
    import('../pipeline/scheduler.js'),
  ]);
  scheduler.cancelScheduledWork();
  PipelineService.stop();

  const deadline = Date.now() + 10000;
  while (PipelineService.status().activeWorkers > 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

export class GmailNotConnectedError extends Error {
  constructor(message = 'Gmail not connected') {
    super(message);
    this.code = 'GMAIL_NOT_CONNECTED';
    this.status = 401;
  }
}

async function syncSenderFromGmail({ force = false } = {}) {
  if (!isAuthenticated()) return null;
  const profile = await fetchGmailProfile({ force });
  if (!profile?.email) return null;
  const existing = getSenderIdentity();
  if (existing.email && existing.email.toLowerCase() !== profile.email.toLowerCase()) {
    throw new Error('Connected Gmail does not match this tenant session');
  }
  const name = pickSenderDisplayName(profile.name, profile.email, existing.name);
  const updated = setConnectedSender(profile.email, name);
  registerTenant({
    email: updated.email,
    displayName: updated.name,
    workspaceKey: getActiveWorkspace().key,
  });
  if (profile.name && looksLikeDerivedName(existing.name, profile.email)) {
    console.log(`[Auth] Sender name corrected: "${existing.name}" → "${updated.name}"`);
  }
  return updated;
}

function statusFromSender(connected, sender) {
  const role = connected ? roleForEmail(sender.email) : null;
  return {
    authenticated: connected,
    senderEmail: connected ? sender.email : null,
    senderName: connected ? sender.name : null,
    role,
    isAdmin: role === 'admin',
    canSend: connected && !!sender.email,
    canLoadTemplate: connected && !!sender.email,
  };
}

export const AuthService = {
  isConnected() {
    return isAuthenticated();
  },

  getClient() {
    const client = getAuthedClient();
    if (!client) throw new GmailNotConnectedError();
    return client;
  },

  getStatus() {
    const connected = isAuthenticated();
    const sender = getSenderIdentity();
    return statusFromSender(connected, sender);
  },

  /**
   * Deep auth check — tests refresh token and ensures sender matches connected Gmail.
   * Cached for 5 minutes so polling /bootstrap does not hammer Google APIs.
   */
  async validateConnection({ force = false } = {}) {
    const tenant = getActiveWorkspace().key || 'anonymous';
    const validateCache = validateCaches.get(tenant) || { result: null, at: 0 };
    const now = Date.now();
    if (!force && validateCache.result && now - validateCache.at < VALIDATE_CACHE_MS) {
      return validateCache.result;
    }
    if (validateInFlight.has(tenant)) return validateInFlight.get(tenant);

    const inFlight = (async () => {
      try {
        const hadTokens = isAuthenticated();
        const { valid, reason } = await validateToken();
        if (!valid && reason === 'invalid') {
          clearConnectedSender();
          clearValidateCache();
          eventBus.publish({ type: 'gmail_disconnected', at: Date.now(), reason: 'token_validation_failed' });
          return statusFromSender(false, { email: null, name: null });
        }
        const connected = valid || (hadTokens && reason !== 'invalid');
        if (!connected) {
          return statusFromSender(false, { email: null, name: null });
        }

        let sender = getSenderIdentity();
        if (!sender.email || force) {
          try {
            sender = (await syncSenderFromGmail({ force })) || sender;
          } catch (e) {
            console.warn('[Auth] Could not sync Gmail profile:', e.message);
          }
        }
        const result = statusFromSender(true, sender);
        registerTenant({
          email: sender.email,
          displayName: sender.name,
          workspaceKey: getActiveWorkspace().key,
        });
        touchTenant(sender.email);
        validateCaches.set(tenant, { result, at: Date.now() });
        return result;
      } finally {
        validateInFlight.delete(tenant);
      }
    })();

    validateInFlight.set(tenant, inFlight);
    return inFlight;
  },

  getAuthUrl() {
    return oauthGetAuthUrl();
  },

  async connectWithCode(code, state) {
    let tokens;
    let profile;
    try {
      tokens = await oauthHandleCallback(code, state);
      profile = await runWithPendingTokens(tokens, async () => {
        clearGmailCache();
        clearValidateCache();
        return fetchGmailProfile({ force: true });
      });
      if (!profile?.email) {
        throw new Error('Connected to Gmail but could not read your email address');
      }
    } catch (error) {
      await discardPendingTokens(tokens);
      throw error;
    }

    const workspace = await ensureUserWorkspace(profile.email);
    return runWithTenantKey(workspace.key, async () => {
      commitPendingTokens(tokens);
      const existing = getSenderIdentity();
      const sender = setConnectedSender(
        profile.email,
        pickSenderDisplayName(profile.name, profile.email, existing.name),
      );
      registerTenant({
        email: sender.email,
        displayName: sender.name,
        workspaceKey: workspace.key,
        login: true,
      });
      const sessionToken = createTenantSession(sender.email);
      eventBus.publish({
        type: 'gmail_connected',
        at: Date.now(),
        email: sender.email,
        name: sender.name,
      });
      return { email: sender.email, name: sender.name, sessionToken };
    });
  },

  async disconnect() {
    await stopRuntimeForWorkspaceChange();
    await oauthDisconnect();
    clearConnectedSender();
    clearGmailCache();
    clearValidateCache();
    invalidateUniversityOutreachCache();
    invalidateEpochCache();
    eventBus.publish({ type: 'gmail_disconnected', at: Date.now() });
  },

  getFrontendRedirect(success, params = {}) {
    const base = config.frontendUrl.replace(/\/$/, '');
    if (success) {
      const session = params.session ? `&session=${encodeURIComponent(params.session)}` : '';
      return `${base}/?gmail=connected${session}`;
    }
    const msg = params.msg ? `&msg=${encodeURIComponent(params.msg)}` : '';
    return `${base}/?gmail=error${msg}`;
  },
};

export default AuthService;
