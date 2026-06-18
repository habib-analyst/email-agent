import { AuthService } from '../services/AuthService.js';

export function requireAdmin(req, res, next) {
  const status = AuthService.getStatus();
  if (!status.authenticated) return res.status(401).json({ error: 'Gmail not connected' });
  if (!status.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
}
