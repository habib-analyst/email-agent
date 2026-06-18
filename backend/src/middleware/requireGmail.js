import { AuthService, GmailNotConnectedError } from '../services/AuthService.js';

export function requireGmail(req, res, next) {
  if (!AuthService.isConnected()) {
    return res.status(401).json({
      error: 'Gmail not connected',
      code: 'GMAIL_NOT_CONNECTED',
      connectUrl: '/api/auth/url',
    });
  }
  next();
}

/**
 * Deep Gmail auth check — validates refresh token actually works.
 * Use for critical operations (sending emails, batch send-now).
 */
export async function requireGmailValidated(req, res, next) {
  try {
    const result = await AuthService.validateConnection();
    if (!result.authenticated) {
      return res.status(401).json({
        error: 'Gmail token invalid or expired — please reconnect',
        code: 'GMAIL_NOT_CONNECTED',
        connectUrl: '/api/auth/url',
      });
    }
    next();
  } catch (e) {
    return res.status(401).json({
      error: 'Gmail validation failed — please reconnect',
      code: 'GMAIL_NOT_CONNECTED',
      connectUrl: '/api/auth/url',
    });
  }
}

export function gmailErrorHandler(err, req, res, next) {
  if (err instanceof GmailNotConnectedError || err.code === 'GMAIL_NOT_CONNECTED') {
    return res.status(401).json({
      error: err.message,
      code: 'GMAIL_NOT_CONNECTED',
      connectUrl: '/api/auth/url',
    });
  }
  next(err);
}
