export function requireAdmin(req, res, next) {
  if (!req.authSession) return res.status(401).json({ error: 'Gmail not connected' });
  if (req.authSession.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}
