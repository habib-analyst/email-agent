import { AuthService } from '../services/AuthService.js';
import { getTenant, getTenantEntitlements } from '../services/tenantRegistry.js';

export function requireActiveTenant(req, res, next) {
  const status = AuthService.getStatus();
  if (!status.authenticated || status.isAdmin) return next();
  const tenant = getTenant(status.senderEmail);
  if (!tenant) return res.status(403).json({ error: 'User workspace is not registered' });
  if (tenant.status === 'blocked') {
    return res.status(403).json({
      error: 'This account is blocked',
      reason: tenant.blocked_reason || 'Contact the administrator',
      code: 'TENANT_BLOCKED',
    });
  }
  req.tenant = tenant;
  req.entitlements = getTenantEntitlements(status.senderEmail);
  next();
}

export function requireFeature(feature) {
  return (req, res, next) => {
    const status = AuthService.getStatus();
    if (status.isAdmin) return next();
    const entitlements = req.entitlements || getTenantEntitlements(status.senderEmail);
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

