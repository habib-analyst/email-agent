const GMAIL_AUTH_KEY = 'email-agent-gmail-auth';
const BACKEND_OK_KEY = 'email-agent-backend-ok';
const BACKEND_OK_TTL_MS = 24 * 60 * 60 * 1000;

export function loadCachedAuth() {
  try {
    const raw = localStorage.getItem(GMAIL_AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCachedAuth(auth) {
  if (!auth) {
    try { localStorage.removeItem(GMAIL_AUTH_KEY); } catch { /* ignore */ }
    return;
  }
  try { localStorage.setItem(GMAIL_AUTH_KEY, JSON.stringify(auth)); } catch { /* ignore */ }
}

export function markBackendOk() {
  try {
    localStorage.setItem(BACKEND_OK_KEY, JSON.stringify({ ok: true, at: Date.now() }));
  } catch { /* ignore */ }
}

export function wasBackendRecentlyOk() {
  try {
    const raw = localStorage.getItem(BACKEND_OK_KEY);
    if (!raw) return false;
    const { ok, at } = JSON.parse(raw);
    return !!ok && Date.now() - at < BACKEND_OK_TTL_MS;
  } catch {
    return false;
  }
}

export function clearBackendOk() {
  try { localStorage.removeItem(BACKEND_OK_KEY); } catch { /* ignore */ }
}

/** Prefer server auth when settled; never override explicit disconnect. */
export function mergeAuthState(cached, serverAuth, { allowCache = true } = {}) {
  if (serverAuth?.authenticated) {
    return {
      ...(allowCache ? cached : null),
      ...serverAuth,
      senderEmail: serverAuth.senderEmail || cached?.senderEmail,
      senderName: serverAuth.senderName || cached?.senderName,
    };
  }
  if (serverAuth && serverAuth.authenticated === false) return serverAuth;
  if (allowCache && cached?.authenticated) return { ...serverAuth, ...cached, authenticated: true };
  return serverAuth ?? cached ?? null;
}
