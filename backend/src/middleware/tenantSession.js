import { runWithTenantKey } from '../db/index.js';
import { getTenantSession } from '../services/tenantRegistry.js';

export const SESSION_COOKIE = 'email_agent_session';

export function readSessionToken(req) {
  const cookies = String(req.headers?.cookie || '').split(';');
  for (const cookie of cookies) {
    const [name, ...parts] = cookie.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(parts.join('='));
  }
  const header = req.get?.('x-session-token');
  if (header) return header;
  if (req.query?.session) return String(req.query.session);
  return null;
}

export function tenantSessionContext(req, res, next) {
  const token = readSessionToken(req);
  const session = getTenantSession(token);
  req.sessionToken = token;
  req.authSession = session;
  return runWithTenantKey(session?.workspace_key || 'anonymous', next);
}
