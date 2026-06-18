import { Router } from 'express';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { AuthService } from '../services/AuthService.js';
import {
  getAdminDashboard,
  listAdminAudit,
  listPlans,
  setTenantControls,
  setTenantStatus,
  updatePlan,
} from '../services/tenantRegistry.js';

const router = Router();

router.use(requireAdmin);

router.get('/dashboard', (req, res) => {
  try {
    res.json(getAdminDashboard());
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load admin dashboard' });
  }
});

router.put('/users/:email/status', (req, res) => {
  try {
    const result = setTenantStatus({
      adminEmail: AuthService.getStatus().senderEmail,
      targetEmail: decodeURIComponent(req.params.email),
      status: req.body?.status,
      reason: req.body?.reason,
    });
    res.json({ success: true, user: result });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not update user status' });
  }
});

router.put('/users/:email/controls', (req, res) => {
  try {
    const result = setTenantControls({
      adminEmail: AuthService.getStatus().senderEmail,
      targetEmail: decodeURIComponent(req.params.email),
      planCode: req.body?.plan_code,
      features: req.body?.features,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not update user controls' });
  }
});

router.get('/plans', (req, res) => res.json({ plans: listPlans() }));

router.put('/plans/:code', (req, res) => {
  try {
    const plan = updatePlan({
      adminEmail: AuthService.getStatus().senderEmail,
      code: req.params.code,
      patch: req.body || {},
    });
    res.json({ success: true, plan });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not update plan' });
  }
});

router.get('/audit', (req, res) => {
  res.json({ events: listAdminAudit(req.query.limit) });
});

export default router;
