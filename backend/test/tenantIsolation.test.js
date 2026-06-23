import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import db, { runWithTenantKey, tenantKey } from '../src/db/index.js';
import archiveDb from '../src/db/archive.js';
import {
  ADMIN_EMAIL,
  createTenantSession,
  revokeTenantSession,
} from '../src/services/tenantRegistry.js';
import { tenantSessionContext } from '../src/middleware/tenantSession.js';

const adminKey = tenantKey(ADMIN_EMAIL);
const userKey = 'anonymous';

test('tenant access resolves entitlements from the authenticated session', () => {
  const source = readFileSync(new URL('../src/middleware/tenantAccess.js', import.meta.url), 'utf8');
  assert.match(source, /getTenantEntitlements\(session\.email\)/);
  assert.doesNotMatch(source, /getTenantEntitlements\(status\.senderEmail\)/);
});

test('live analytics data is isolated between tenant contexts', async () => {
  const marker = `tenant-live-${Date.now()}-${Math.random()}@example.test`;
  try {
    await runWithTenantKey(adminKey, async () => {
      db.prepare(`
        INSERT INTO sent_email_history (professor_email, source, mode, sent_at)
        VALUES (?, 'gmail_send', 'instant', datetime('now'))
      `).run(marker);
      await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(
        db.prepare('SELECT COUNT(*) AS count FROM sent_email_history WHERE professor_email=?').get(marker).count,
        1,
      );
    });

    await runWithTenantKey(userKey, async () => {
      assert.equal(
        db.prepare('SELECT COUNT(*) AS count FROM sent_email_history WHERE professor_email=?').get(marker).count,
        0,
      );
    });
  } finally {
    await runWithTenantKey(adminKey, async () => {
      db.prepare('DELETE FROM sent_email_history WHERE professor_email=?').run(marker);
    });
  }
});

test('permanent archive is isolated between tenant contexts', async () => {
  const marker = `tenant-archive-${Date.now()}-${Math.random()}@example.test`;
  try {
    await runWithTenantKey(adminKey, async () => {
      archiveDb.prepare(`
        INSERT INTO archive_outreach (professor_email, status, mode)
        VALUES (?, 'sent', 'instant')
      `).run(marker);
    });

    await runWithTenantKey(userKey, async () => {
      assert.equal(
        archiveDb.prepare('SELECT COUNT(*) AS count FROM archive_outreach WHERE professor_email=?').get(marker).count,
        0,
      );
    });
  } finally {
    await runWithTenantKey(adminKey, async () => {
      archiveDb.prepare('DELETE FROM archive_outreach WHERE professor_email=?').run(marker);
    });
  }
});

test('concurrent async work retains its own tenant database', async () => {
  const [adminEmail, userEmail] = await Promise.all([
    runWithTenantKey(adminKey, async () => {
      await new Promise(resolve => setTimeout(resolve, 15));
      return db.prepare('SELECT sender_email FROM settings WHERE id=1').get()?.sender_email;
    }),
    runWithTenantKey(userKey, async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      return db.prepare('SELECT sender_email FROM settings WHERE id=1').get()?.sender_email;
    }),
  ]);

  assert.equal(adminEmail, ADMIN_EMAIL);
  assert.notEqual(userEmail, ADMIN_EMAIL);
});

test('session middleware selects the authenticated tenant and defaults to anonymous', async () => {
  const token = createTenantSession(ADMIN_EMAIL);
  const runMiddleware = (sessionToken) => new Promise((resolve, reject) => {
    const req = {
      headers: {},
      query: {},
      get(name) {
        return name.toLowerCase() === 'x-session-token' ? sessionToken : null;
      },
    };
    tenantSessionContext(req, {}, () => {
      try {
        resolve({
          session: req.authSession,
          sender: db.prepare('SELECT sender_email FROM settings WHERE id=1').get()?.sender_email,
        });
      } catch (error) {
        reject(error);
      }
    });
  });

  try {
    const authenticated = await runMiddleware(token);
    const anonymous = await runMiddleware(null);
    assert.equal(authenticated.session.email, ADMIN_EMAIL);
    assert.equal(authenticated.sender, ADMIN_EMAIL);
    assert.equal(anonymous.session, null);
    assert.notEqual(anonymous.sender, ADMIN_EMAIL);
  } finally {
    revokeTenantSession(token);
  }
});

test('session middleware prefers the persistent cookie over a stale header token', async () => {
  const token = createTenantSession(ADMIN_EMAIL);
  const req = {
    headers: { cookie: `email_agent_session=${encodeURIComponent(token)}` },
    query: {},
    get(name) {
      return name.toLowerCase() === 'x-session-token' ? 'stale-token' : null;
    },
  };

  try {
    const result = await new Promise((resolve, reject) => {
      tenantSessionContext(req, {}, () => {
        try {
          resolve(req.authSession);
        } catch (error) {
          reject(error);
        }
      });
    });
    assert.equal(result.email, ADMIN_EMAIL);
  } finally {
    revokeTenantSession(token);
  }
});
