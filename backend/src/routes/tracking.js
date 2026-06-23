import { Router } from 'express';
import { recordOpen, recordClick, TRANSPARENT_GIF } from '../tracking/index.js';

const router = Router();

function sendPixel(res) {
  res.set('Content-Type', 'image/gif');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.status(200).end(TRANSPARENT_GIF);
}

// Open-tracking pixel. Token may carry a ".gif" suffix from the <img src>.
router.get('/o/:token', (req, res) => {
  const token = String(req.params.token || '').replace(/\.(gif|png)$/i, '');
  recordOpen(token);
  sendPixel(res);
});

// Click-tracking redirect. Records the click then 302s to the original URL.
router.get('/c/:token', (req, res) => {
  const token = String(req.params.token || '');
  const target = String(req.query.u || '');
  if (!/^https?:\/\//i.test(target)) {
    return res.status(400).send('Invalid link');
  }
  recordClick(token, target);
  res.redirect(302, target);
});

export default router;
