import Database from 'better-sqlite3';
import { resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';

export const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'habib.gcuf.edu@gmail.com').trim().toLowerCase();

const ROOT = resolve(import.meta.dirname, '../../user-data');
const REGISTRY_PATH = resolve(ROOT, 'registry.db');
mkdirSync(ROOT, { recursive: true });

const registry = new Database(REGISTRY_PATH);
registry.pragma('journal_mode = WAL');
registry.pragma('busy_timeout = 5000');
registry.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    email TEXT PRIMARY KEY,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    workspace_key TEXT NOT NULL UNIQUE,
    first_login_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    login_count INTEGER DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    blocked_reason TEXT,
    blocked_at DATETIME,
    plan_code TEXT NOT NULL DEFAULT 'free',
    feature_overrides TEXT
  );
  CREATE TABLE IF NOT EXISTS plans (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    price_minor INTEGER,
    currency TEXT,
    billing_interval TEXT,
    limits_json TEXT,
    features_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS admin_audit_log (
    id INTEGER PRIMARY KEY,
    admin_email TEXT NOT NULL,
    target_email TEXT,
    action TEXT NOT NULL,
    detail_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
for (const sql of [
  "ALTER TABLE tenants ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
  'ALTER TABLE tenants ADD COLUMN blocked_reason TEXT',
  'ALTER TABLE tenants ADD COLUMN blocked_at DATETIME',
  "ALTER TABLE tenants ADD COLUMN plan_code TEXT NOT NULL DEFAULT 'free'",
  'ALTER TABLE tenants ADD COLUMN feature_overrides TEXT',
]) {
  try { registry.exec(sql); } catch {}
}
registry.prepare(`
  INSERT OR IGNORE INTO plans
    (code, name, enabled, price_minor, currency, billing_interval, limits_json, features_json)
  VALUES
    ('free', 'Free', 1, NULL, NULL, NULL, ?, ?),
    ('pro', 'Pro', 0, NULL, NULL, NULL, ?, ?)
`).run(
  JSON.stringify({ dailyEmails: 25, activeBatches: 2, queueWorkers: 1 }),
  JSON.stringify({ instant: true, basicInstant: true, scheduled: true, webResearch: false, customApiKeys: true }),
  JSON.stringify({ dailyEmails: 500, activeBatches: 25, queueWorkers: 4 }),
  JSON.stringify({ instant: true, basicInstant: true, scheduled: true, webResearch: true, customApiKeys: true }),
);

export function roleForEmail(email) {
  return String(email || '').trim().toLowerCase() === ADMIN_EMAIL ? 'admin' : 'user';
}

export function registerTenant({ email, displayName, workspaceKey, login = false }) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !workspaceKey) return null;
  const role = roleForEmail(normalized);
  const existing = registry.prepare('SELECT email FROM tenants WHERE email=?').get(normalized);
  if (existing) {
    registry.prepare(`
      UPDATE tenants
      SET display_name=COALESCE(NULLIF(?,''), display_name),
          role=?,
          workspace_key=?,
          last_seen_at=CURRENT_TIMESTAMP,
          last_login_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE last_login_at END,
          login_count=login_count + CASE WHEN ?=1 THEN 1 ELSE 0 END
      WHERE email=?
    `).run(displayName || '', role, workspaceKey, login ? 1 : 0, login ? 1 : 0, normalized);
  } else {
    registry.prepare(`
      INSERT INTO tenants (email, display_name, role, workspace_key)
      VALUES (?, ?, ?, ?)
    `).run(normalized, displayName || null, role, workspaceKey);
  }
  return registry.prepare('SELECT * FROM tenants WHERE email=?').get(normalized);
}

export function touchTenant(email) {
  registry.prepare('UPDATE tenants SET last_seen_at=CURRENT_TIMESTAMP WHERE email=?')
    .run(String(email || '').trim().toLowerCase());
}

export function listTenants() {
  return registry.prepare(`
    SELECT email, display_name, role, workspace_key, first_login_at, last_login_at, last_seen_at, login_count,
      status, blocked_reason, blocked_at, plan_code, feature_overrides
    FROM tenants
    ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, last_seen_at DESC
  `).all();
}

export function getTenant(email) {
  return registry.prepare('SELECT * FROM tenants WHERE email=?')
    .get(String(email || '').trim().toLowerCase()) || null;
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

export function getTenantEntitlements(email) {
  const tenant = getTenant(email);
  if (!tenant) return null;
  const plan = registry.prepare('SELECT * FROM plans WHERE code=?').get(tenant.plan_code || 'free')
    || registry.prepare("SELECT * FROM plans WHERE code='free'").get();
  return {
    plan: {
      code: plan?.code || 'free',
      name: plan?.name || 'Free',
      enabled: plan?.enabled !== 0,
    },
    limits: parseJson(plan?.limits_json, {}),
    features: {
      ...parseJson(plan?.features_json, {}),
      ...parseJson(tenant.feature_overrides, {}),
    },
  };
}

export function setTenantStatus({ adminEmail, targetEmail, status, reason }) {
  const normalized = String(targetEmail || '').trim().toLowerCase();
  if (normalized === ADMIN_EMAIL) throw new Error('The primary admin account cannot be blocked');
  if (!['active', 'blocked'].includes(status)) throw new Error('Invalid tenant status');
  const result = registry.prepare(`
    UPDATE tenants
    SET status=?, blocked_reason=?, blocked_at=CASE WHEN ?='blocked' THEN CURRENT_TIMESTAMP ELSE NULL END
    WHERE email=?
  `).run(status, status === 'blocked' ? String(reason || '').trim() || 'Blocked by admin' : null, status, normalized);
  if (!result.changes) throw new Error('User account not found');
  auditAdminAction(adminEmail, normalized, `tenant_${status}`, { reason: reason || null });
  return getTenant(normalized);
}

export function setTenantControls({ adminEmail, targetEmail, planCode, features }) {
  const normalized = String(targetEmail || '').trim().toLowerCase();
  if (planCode && !registry.prepare('SELECT 1 FROM plans WHERE code=?').get(planCode)) {
    throw new Error('Unknown plan code');
  }
  const result = registry.prepare(`
    UPDATE tenants
    SET plan_code=COALESCE(?, plan_code), feature_overrides=COALESCE(?, feature_overrides)
    WHERE email=?
  `).run(
    planCode || null,
    features !== undefined ? JSON.stringify(features || {}) : null,
    normalized,
  );
  if (!result.changes) throw new Error('User account not found');
  auditAdminAction(adminEmail, normalized, 'tenant_controls_updated', { planCode, features });
  return { tenant: getTenant(normalized), entitlements: getTenantEntitlements(normalized) };
}

export function listPlans() {
  return registry.prepare(`
    SELECT code, name, enabled, price_minor, currency, billing_interval, limits_json, features_json, updated_at
    FROM plans ORDER BY code
  `).all().map(plan => ({
    ...plan,
    limits: parseJson(plan.limits_json, {}),
    features: parseJson(plan.features_json, {}),
    limits_json: undefined,
    features_json: undefined,
  }));
}

export function updatePlan({ adminEmail, code, patch }) {
  const existing = registry.prepare('SELECT * FROM plans WHERE code=?').get(code);
  if (!existing) throw new Error('Plan not found');
  registry.prepare(`
    UPDATE plans SET
      name=?, enabled=?, price_minor=?, currency=?, billing_interval=?,
      limits_json=?, features_json=?, updated_at=CURRENT_TIMESTAMP
    WHERE code=?
  `).run(
    patch.name ?? existing.name,
    patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled,
    patch.price_minor !== undefined ? patch.price_minor : existing.price_minor,
    patch.currency !== undefined ? patch.currency : existing.currency,
    patch.billing_interval !== undefined ? patch.billing_interval : existing.billing_interval,
    patch.limits !== undefined ? JSON.stringify(patch.limits || {}) : existing.limits_json,
    patch.features !== undefined ? JSON.stringify(patch.features || {}) : existing.features_json,
    code,
  );
  auditAdminAction(adminEmail, null, 'plan_updated', { code, patch });
  return listPlans().find(plan => plan.code === code);
}

export function auditAdminAction(adminEmail, targetEmail, action, detail = {}) {
  registry.prepare(`
    INSERT INTO admin_audit_log (admin_email, target_email, action, detail_json)
    VALUES (?, ?, ?, ?)
  `).run(adminEmail, targetEmail || null, action, JSON.stringify(detail || {}));
}

export function listAdminAudit(limit = 100) {
  return registry.prepare(`
    SELECT id, admin_email, target_email, action, detail_json, created_at
    FROM admin_audit_log ORDER BY id DESC LIMIT ?
  `).all(Math.min(Math.max(Number(limit) || 100, 1), 500)).map(row => ({
    ...row,
    detail: parseJson(row.detail_json, {}),
    detail_json: undefined,
  }));
}

function publicTenant(tenant) {
  const { workspace_key, ...safe } = tenant;
  return safe;
}

function safeCount(connection, sql) {
  try { return connection.prepare(sql).get()?.c || 0; } catch { return 0; }
}

export function tenantSummary(tenant) {
  const dbPath = resolve(ROOT, tenant.workspace_key, 'data.db');
  if (!existsSync(dbPath)) return { ...publicTenant(tenant), available: false };
  const connection = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const settings = connection.prepare('SELECT resume_path, user_api_keys FROM settings WHERE id=1').get() || {};
    const lastSent = connection.prepare('SELECT sent_at FROM sent_email_history ORDER BY sent_at DESC, id DESC LIMIT 1').get();
    const lastBatch = connection.prepare('SELECT created_at, status FROM scheduled_batches ORDER BY created_at DESC, id DESC LIMIT 1').get();
    return {
      ...publicTenant(tenant),
      available: true,
      total_sent: safeCount(connection, 'SELECT COUNT(*) AS c FROM sent_email_history'),
      today_sent: safeCount(connection, "SELECT COUNT(*) AS c FROM sent_email_history WHERE date(sent_at)=date('now')"),
      unique_contacts: safeCount(connection, 'SELECT COUNT(DISTINCT professor_email) AS c FROM sent_email_history'),
      active_batches: safeCount(connection, "SELECT COUNT(*) AS c FROM scheduled_batches WHERE status IN ('pending','processing','drafted','scheduled','sending')"),
      replies: safeCount(connection, 'SELECT COUNT(*) AS c FROM replies'),
      failures: safeCount(connection, "SELECT COUNT(*) AS c FROM delivery_failures WHERE status='open'"),
      queue_items: safeCount(connection, "SELECT COUNT(*) AS c FROM queue WHERE state NOT IN ('sent','skipped')"),
      has_resume: !!settings.resume_path,
      has_custom_api: !!settings.user_api_keys && settings.user_api_keys !== '{"keys":[]}',
      last_sent_at: lastSent?.sent_at || null,
      last_batch_at: lastBatch?.created_at || null,
      last_batch_status: lastBatch?.status || null,
      entitlements: getTenantEntitlements(tenant.email),
    };
  } finally {
    connection.close();
  }
}

export function getAdminDashboard() {
  const users = listTenants().map(tenantSummary);
  return {
    users,
    totals: {
      accounts: users.length,
      users: users.filter(user => user.role === 'user').length,
      sent: users.reduce((sum, user) => sum + (user.total_sent || 0), 0),
      todaySent: users.reduce((sum, user) => sum + (user.today_sent || 0), 0),
      activeBatches: users.reduce((sum, user) => sum + (user.active_batches || 0), 0),
      failures: users.reduce((sum, user) => sum + (user.failures || 0), 0),
      blocked: users.filter(user => user.status === 'blocked').length,
    },
  };
}
