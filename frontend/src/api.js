const BASE = '/api';
const GET_TIMEOUT = 8000;
const BOOTSTRAP_TIMEOUT = 8000;
const POST_TIMEOUT = 60000;

export { BOOTSTRAP_TIMEOUT };
const SESSION_KEY = 'email_agent_session';
let sessionVerified = false;

export function getSessionToken() {
  return localStorage.getItem(SESSION_KEY) || '';
}

export function setSessionToken(token) {
  sessionVerified = false;
  if (token) localStorage.setItem(SESSION_KEY, token);
  else localStorage.removeItem(SESSION_KEY);
}

export function markSessionVerified() {
  sessionVerified = true;
}

export function isSessionVerified() {
  return sessionVerified;
}

async function parse(res) {
  const data = await res.json().catch(() => ({ _parseError: true }));
  if (!res.ok) {
    if (res.status === 401 && data.code === 'SESSION_REQUIRED') setSessionToken('');
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  if (data._parseError) throw new Error('Invalid JSON response');
  return data;
}

async function request(path, options = {}) {
  const timeout = options.timeout || (options.method === 'POST' ? POST_TIMEOUT : GET_TIMEOUT);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeout / 1000}s: ${path}`)), timeout);
  try {
    const headers = new Headers(options.headers || {});
    const session = getSessionToken();
    if (session) headers.set('X-Session-Token', session);
    const res = await fetch(BASE + path, {
      ...options,
      headers,
      credentials: 'include',
      signal: controller.signal,
    });
    return parse(res);
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(e.reason || `Request timed out — the backend is processing. Check live activity for progress.`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function get(path, options = {}) {
  return request(path, { cache: 'no-store', ...options });
}

export async function post(path, body, options = {}) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : '{}',
    ...options,
  });
}

export async function put(path, body, options = {}) {
  return request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...options,
  });
}

export async function del(path) {
  return request(path, { method: 'DELETE' });
}

export async function uploadFile(path, file, field = 'file', options = {}) {
  const form = new FormData();
  form.append(field, file);
  return request(path, {
    method: 'POST',
    body: form,
    timeout: 120000,
    ...options,
  });
}
