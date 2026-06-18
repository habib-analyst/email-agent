import { Router } from 'express';
import { AuthService } from '../services/AuthService.js';

const router = Router();

router.get('/url', (req, res) => {
  res.json({ url: AuthService.getAuthUrl() });
});

router.get('/callback', async (req, res) => {
  try {
    await AuthService.connectWithCode(req.query.code);
    res.redirect(AuthService.getFrontendRedirect(true));
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
  res.json({ success: true, ...AuthService.getStatus() });
});

export default router;
