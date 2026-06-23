import { Router } from 'express';
import { AuthService } from '../services/AuthService.js';
import { revokeTenantSession } from '../services/tenantRegistry.js';
import { SESSION_COOKIE } from '../middleware/tenantSession.js';

const router = Router();

router.get('/url', (req, res) => {
  res.json({ url: AuthService.getAuthUrl() });
});

router.get('/callback', async (req, res) => {
  try {
    const result = await AuthService.connectWithCode(req.query.code, req.query.state);
    res.cookie(SESSION_COOKIE, result.sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    res.redirect(AuthService.getFrontendRedirect(true, { session: result.sessionToken }));
  } catch (e) {
    res.redirect(AuthService.getFrontendRedirect(false, { msg: e.message }));
  }
});

router.get('/status', (req, res) => {
  res.json(AuthService.getStatus());
});

// Deep auth validation — tests if refresh token actually works
router.get('/validate', async (req, res) => {
  try {
    const result = await AuthService.validateConnection();
    res.json(result);
  } catch (e) {
    res.json({ authenticated: false, senderEmail: null, canSend: false, canLoadTemplate: false, error: e.message });
  }
});

router.post('/refresh-sender', async (req, res) => {
  try {
    if (!AuthService.isConnected()) {
      return res.status(401).json({ error: 'Gmail not connected' });
    }
    const result = await AuthService.validateConnection({ force: true });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/disconnect', async (req, res) => {
  await AuthService.disconnect();
  revokeTenantSession(req.sessionToken);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ success: true, ...AuthService.getStatus() });
});

export default router;
