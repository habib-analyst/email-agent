import { getTenant, getTenantEntitlements } from '../services/tenantRegistry.js';
import { PipelineService } from '../services/PipelineService.js';
import { startScheduler } from '../pipeline/scheduler.js';
import { applyUserApiKeysFromDb } from '../services/userApiKeys.js';
import { currentTenantKey } from '../db/index.js';

const initializedTenants = new Set();

export function requireActiveTenant(req, res, next) {
  if (req.path === '/health') return next();
  const session = req.authSession;
  if (!session) return res.status(401).json({ error: 'Sign in with Gmail', code: 'SESSION_REQUIRED' });
  const tenantKey = currentTenantKey();
  if (!initializedTenants.has(tenantKey)) {
    applyUserApiKeysFromDb();
    initializedTenants.add(tenantKey);
  }
  PipelineService.startCronJobs();
  PipelineService.start();
  startScheduler();
  if (session.role === 'admin') return next();
  const tenant = getTenant(session.email);
  if (!tenant) return res.status(403).json({ error: 'User workspace is not registered' });
  if (tenant.status === 'blocked') {
    return res.status(403).json({
      error: 'This account is blocked',
      reason: tenant.blocked_reason || 'Contact the administrator',
      code: 'TENANT_BLOCKED',
    });
  }
  req.tenant = tenant;
  req.entitlements = getTenantEntitlements(session.email);
  next();
}

export function requireFeature(feature) {
  return (req, res, next) => {
    const session = req.authSession;
    if (session?.role === 'admin') return next();
    const entitlements = req.entitlements || getTenantEntitlements(session?.email);
    if (entitlements?.features?.[feature] === false) {
      return res.status(403).json({
        error: `${feature} is disabled for this account`,
        code: 'FEATURE_DISABLED',
        feature,
      });
    }
    next();
  };
}
