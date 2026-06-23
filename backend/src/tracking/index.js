import { randomBytes } from 'crypto';
import db, { currentTenantKey, runWithTenantKey } from '../db/index.js';
import { config } from '../config/index.js';

const LEGACY_TENANT_TOKEN = '_';
const TOKEN_SEPARATOR = '~';

// 1x1 transparent GIF returned for open-tracking pixel requests.
export const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

function newToken() {
  const tenant = currentTenantKey() || LEGACY_TENANT_TOKEN;
  return `${tenant}${TOKEN_SEPARATOR}${randomBytes(12).toString('hex')}`;
}

export function parseTenantFromToken(token) {
  const tenant = String(token || '').split(TOKEN_SEPARATOR)[0];
  if (!tenant || tenant === LEGACY_TENANT_TOKEN) return null;
  return tenant;
}

export function createTrackingRecord({ professor_email, subject, mode, batch_id } = {}) {
  const token = newToken();
  db.prepare(`
    INSERT INTO email_tracking (token, professor_email, subject, mode, batch_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, professor_email || null, subject || null, mode || null, batch_id || null);
  return token;
}

export function attachMessageId(token, messageId) {
  if (!token || !messageId) return;
  db.prepare('UPDATE email_tracking SET message_id=? WHERE token=?').run(messageId, token);
}

function pixelUrl(token) {
  return `${config.publicBackendUrl}/api/track/o/${token}.gif`;
}

function clickUrl(token, url) {
  return `${config.publicBackendUrl}/api/track/c/${token}?u=${encodeURIComponent(url)}`;
}

// Append an open-tracking pixel and rewrite outbound links to go through the click tracker.
export function injectTracking(html, token) {
  if (!html || !token) return html;
  let out = String(html).replace(/(<a\b[^>]*\bhref=)(["'])(https?:\/\/[^"']+)\2/gi,
    (match, prefix, quote, url) => {
      if (url.includes('/api/track/')) return match;
      return `${prefix}${quote}${clickUrl(token, url)}${quote}`;
    });
  const pixel = `<img src="${pixelUrl(token)}" width="1" height="1" alt="" style="display:none" />`;
  if (/<\/body>/i.test(out)) {
    out = out.replace(/<\/body>/i, `${pixel}</body>`);
  } else {
    out += pixel;
  }
  return out;
}

function recordInTenant(token, fn) {
  const tenant = parseTenantFromToken(token);
  // Legacy/no-tenant tokens operate on the active database directly.
  return tenant ? runWithTenantKey(tenant, fn) : fn();
}

export function recordOpen(token) {
  if (!token) return;
  try {
    recordInTenant(token, () => {
      db.prepare(`
        UPDATE email_tracking
        SET open_count = open_count + 1,
            first_open_at = COALESCE(first_open_at, CURRENT_TIMESTAMP),
            last_open_at = CURRENT_TIMESTAMP
        WHERE token = ?
      `).run(token);
    });
  } catch (e) {
    console.error('[Tracking] recordOpen failed:', e.message);
  }
}

export function recordClick(token, url) {
  if (!token) return;
  try {
    recordInTenant(token, () => {
      db.prepare(`
        UPDATE email_tracking
        SET click_count = click_count + 1,
            first_click_at = COALESCE(first_click_at, CURRENT_TIMESTAMP),
            last_click_at = CURRENT_TIMESTAMP,
            last_click_url = ?
        WHERE token = ?
      `).run(url || null, token);
    });
  } catch (e) {
    console.error('[Tracking] recordClick failed:', e.message);
  }
}

// Aggregate engagement: open/click rates from tracked sends, reply rate from history.
export function getTrackingSummary() {
  const tracked = db.prepare(`
    SELECT
      COUNT(*) AS tracked,
      SUM(CASE WHEN open_count > 0 THEN 1 ELSE 0 END) AS opened,
      SUM(CASE WHEN click_count > 0 THEN 1 ELSE 0 END) AS clicked
    FROM email_tracking
  `).get() || {};
  const byMode = db.prepare(`
    SELECT
      COALESCE(mode, 'unknown') AS mode,
      COUNT(*) AS tracked,
      SUM(CASE WHEN open_count > 0 THEN 1 ELSE 0 END) AS opened,
      SUM(CASE WHEN click_count > 0 THEN 1 ELSE 0 END) AS clicked
    FROM email_tracking
    GROUP BY COALESCE(mode, 'unknown')
    ORDER BY tracked DESC
  `).all();
  const sentRow = db.prepare(`
    SELECT COUNT(DISTINCT lower(professor_email)) AS sent
    FROM sent_email_history
    WHERE source = 'gmail_send' AND professor_email IS NOT NULL
  `).get() || {};
  const repliedRow = db.prepare(`
    SELECT COUNT(DISTINCT lower(professor_email)) AS replied
    FROM replies
    WHERE professor_email IS NOT NULL
  `).get() || {};
  const trackedCount = Number(tracked.tracked || 0);
  const sentCount = Number(sentRow.sent || 0);
  const rate = (num, denom) => (denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0);
  return {
    enabled: config.trackingEnabled,
    tracked: trackedCount,
    opened: Number(tracked.opened || 0),
    clicked: Number(tracked.clicked || 0),
    sent: sentCount,
    replied: Number(repliedRow.replied || 0),
    open_rate: rate(Number(tracked.opened || 0), trackedCount),
    click_rate: rate(Number(tracked.clicked || 0), trackedCount),
    reply_rate: rate(Number(repliedRow.replied || 0), sentCount),
    by_mode: byMode.map(row => ({
      mode: row.mode,
      tracked: Number(row.tracked || 0),
      opened: Number(row.opened || 0),
      clicked: Number(row.clicked || 0),
      open_rate: rate(Number(row.opened || 0), Number(row.tracked || 0)),
      click_rate: rate(Number(row.clicked || 0), Number(row.tracked || 0)),
    })),
  };
}
