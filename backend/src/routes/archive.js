import { Router } from 'express';
import { ArchiveService } from '../services/ArchiveService.js';
import { findPriorOutreach } from '../db/duplicateCheck.js';
import { getSentEmailSnapshot } from '../gmail/index.js';

const router = Router();

router.get('/stats', (_req, res) => {
  res.json(ArchiveService.stats());
});

router.get('/contacts', (req, res) => {
  const { q, status, limit, offset } = req.query;
  res.json(ArchiveService.searchContacts({
    q: q || '',
    status: status || null,
    limit: Math.min(parseInt(limit, 10) || 100, 5000),
    offset: parseInt(offset, 10) || 0,
  }));
});

router.get('/contacts/:email', (req, res) => {
  const email = decodeURIComponent(req.params.email);
  const prior = findPriorOutreach(email);
  const history = ArchiveService.getEmailHistory(email);
  res.json({ email, priorOutreach: prior, ...history });
});

router.get('/sent', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  res.json(ArchiveService.sentEmails({ q: req.query.q || '', limit, offset }));
});

router.get('/sent/:id', async (req, res) => {
  const detail = ArchiveService.sentEmailDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: 'Sent email not found' });
  let html = detail.sent.stored_html || null;
  let bodySource = html ? 'stored_draft' : null;
  let gmailSnapshot = null;
  if (detail.sent.message_id) {
    try {
      gmailSnapshot = await getSentEmailSnapshot(detail.sent.message_id);
      html = gmailSnapshot.html || html;
      if (html) bodySource = 'gmail';
    } catch (error) {
      if (!html) bodySource = 'unavailable';
    }
  }
  res.json({
    ...detail,
    replies: gmailSnapshot?.threadId
      ? detail.replies.filter(reply => !reply.thread_id || reply.thread_id === gmailSnapshot.threadId)
      : detail.replies,
    gmailSnapshot,
    html,
    bodySource: bodySource || 'unavailable',
  });
});

router.post('/check-duplicates', (req, res) => {
  const emails = req.body.emails || [];
  const results = emails.map((email) => ({
    email,
    prior: findPriorOutreach(email),
  }));
  res.json({
    duplicates: results.filter(r => r.prior),
    clean: results.filter(r => !r.prior).map(r => r.email),
  });
});

router.get('/agent-log', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  res.json(ArchiveService.recentAgentLog(limit));
});

export default router;
