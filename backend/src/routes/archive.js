import { Router } from 'express';
import { ArchiveService } from '../services/ArchiveService.js';
import { findPriorOutreach } from '../db/duplicateCheck.js';

const router = Router();

router.get('/stats', (_req, res) => {
  res.json(ArchiveService.stats());
});

router.get('/contacts', (req, res) => {
  const { q, status, limit, offset } = req.query;
  res.json(ArchiveService.searchContacts({
    q: q || '',
    status: status || null,
    limit: Math.min(parseInt(limit, 10) || 100, 500),
    offset: parseInt(offset, 10) || 0,
  }));
});

router.get('/contacts/:email', (req, res) => {
  const email = decodeURIComponent(req.params.email);
  const prior = findPriorOutreach(email);
  const history = ArchiveService.getEmailHistory(email);
  res.json({ email, priorOutreach: prior, ...history });
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
