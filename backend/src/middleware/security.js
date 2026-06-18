const SENSITIVE_KEYS = new Set([
  'resume_path',
  'workspace_key',
  'api_key',
  'access_token',
  'refresh_token',
  'client_secret',
  'password',
]);

const WINDOWS_PATH = /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g;
const UNIX_PRIVATE_PATH = /\/(?:home|Users|var|tmp)\/[^\s"'<>]+/g;

function redactString(value) {
  return value
    .replace(WINDOWS_PATH, '[private path]')
    .replace(UNIX_PRIVATE_PATH, '[private path]');
}

export function sanitizeForClient(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactString(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => sanitizeForClient(item, seen));

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
    output[key] = sanitizeForClient(item, seen);
  }
  return output;
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.setHeader('Cache-Control', 'no-store');

  const sendJson = res.json.bind(res);
  res.json = payload => sendJson(sanitizeForClient(payload));
  next();
}

