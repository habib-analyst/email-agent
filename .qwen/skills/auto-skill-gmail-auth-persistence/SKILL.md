---
name: gmail-auth-persistence
description: Prevent Gmail "flash of disconnected" on page refresh and validate OAuth tokens deeply (not just file-existence) — localStorage cache, loading state UI, and async token refresh validation with stale-token cleanup
source: auto-skill
extracted_at: '2026-06-14T22:38:11.839Z'
---

# Gmail Auth Persistence & Deep Validation

When Gmail appears disconnected on every page refresh despite being connected, users reflexively click "Connect Gmail" and go through OAuth again — even though their tokens are valid. This pattern fixes both the frontend flash-of-disconnected and the backend shallow-auth-check problem.

## Problem Chain

1. **Frontend:** `auth` state starts as `null` → `isConnected = null?.authenticated ?? false = false` → Gmail shows disconnected immediately
2. **Backend:** `isAuthenticated()` only checks `existsSync(TOKEN_PATH)` — stale/revoked tokens still return `true`
3. **User clicks Connect before async bootstrap completes** → unnecessary OAuth round-trip
4. **On next refresh, cycle repeats** because nothing was cached

## Fix 1: Frontend — localStorage Auth Cache

### SessionContext.jsx

Initialize `auth` from localStorage cache instead of `null`:

```jsx
const [auth, setAuth] = useState(() => {
  try {
    const cached = localStorage.getItem('email-agent-gmail-auth');
    return cached ? JSON.parse(cached) : null;
  } catch (e) {
    return null;
  }
});

// Persist whenever server updates auth
useEffect(() => {
  if (auth) {
    try { localStorage.setItem('email-agent-gmail-auth', JSON.stringify(auth)); } catch {}
  } else {
    try { localStorage.removeItem('email-agent-gmail-auth'); } catch {}
  }
}, [auth]);
```

**Why:** On refresh, React reads the cache first → shows connected instantly → then the async bootstrap confirms it. If server says disconnected, the cache updates and the UI corrects.

### SessionContext.jsx — Deep validation on bootstrap

In `loadSession()`, after the bootstrap call, also hit `/auth/validate` to get real Gmail status:

```jsx
// After bootstrap data loads
try {
  const realAuth = await get('/auth/validate');  // Deep check — tests refresh token
  setAuth(realAuth);
} catch {
  setAuth(data.auth ?? null);  // Fallback to shallow auth from bootstrap
}
```

## Fix 2: Frontend — Neutral Loading State

### useGmailAuth.js

Export `sessionReady` from the hook:

```jsx
const { auth, settings, loadSession, sessionReady } = useSession();
const isConnected = auth?.authenticated ?? false;
return { ..., sessionReady };
```

### GmailConnectionCard.jsx

Show a neutral spinner state when auth isn't confirmed yet, NOT disconnected:

```jsx
const authKnown = sessionReady || isConnected;

// Compact variant (header)
if (!authKnown) return (
  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border bg-gray-50 border-gray-200 text-gray-400">
    <Loader2 className="w-3 h-3 animate-spin" /> Gmail
  </div>
);

// Banner variant (page)
if (!authKnown) return (
  <div className="flex items-center gap-2 p-3.5 rounded-xl bg-gray-50 border border-gray-200 text-gray-400">
    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
    <span className="text-xs font-medium">Checking Gmail connection…</span>
  </div>
);
```

**Why:** Without this, the banner shows "Gmail not connected" for 100-500ms before the server responds. Users click Connect reflexively.

## Fix 3: Backend — Deep Token Validation

### auth/index.js — `isAuthenticated()` upgrade

```js
export function isAuthenticated() {
  if (!existsSync(TOKEN_PATH)) return false;
  const tokens = loadTokens();
  // Must have refresh_token — access_token can be auto-refreshed
  return !!tokens && !!tokens.refresh_token;
}
```

**Why:** Old version was `return existsSync(TOKEN_PATH)` — if the file existed but tokens were empty or had no refresh_token, it returned `true`. Now it actually loads and inspects the tokens.

### auth/index.js — `validateToken()` function

```js
export async function validateToken() {
  const tokens = loadTokens();
  if (!tokens || !tokens.refresh_token) return false;

  try {
    const client = createOAuth2Client();
    client.setCredentials(tokens);
    await client.refreshAccessToken();
    return true;
  } catch (e) {
    // invalid_grant = revoked/expired refresh token
    if (e.message?.includes('invalid_grant') || e.message?.includes('Token has been revoked') || e.message?.includes('400')) {
      console.error('[Auth] Token validation failed:', e.message);
      // Clean up stale tokens so system knows it's disconnected
      try { unlinkSync(TOKEN_PATH); } catch {}
    }
    return false;
  }
}
```

**Key behavior:** When `refreshAccessToken()` fails with `invalid_grant`, the stale `.tokens.json` file is deleted. This ensures `isAuthenticated()` correctly returns `false` on subsequent checks, and the frontend shows disconnected — prompting the user to actually reconnect (not just see false "connected" status).

### AuthService.js — `validateConnection()` method

```js
async validateConnection() {
  const valid = await validateToken();
  if (!valid) {
    eventBus.publish({ type: 'gmail_disconnected', at: Date.now(), reason: 'token_validation_failed' });
  }
  return {
    authenticated: valid,
    senderEmail: valid ? config.senderEmail : null,
    canSend: valid,
    canLoadTemplate: valid,
  };
}
```

**Why:** The SSE event `gmail_disconnected` is published when validation fails, so all connected frontend clients see the status change immediately — no need to wait for next bootstrap refresh.

### auth.routes.js — `/auth/validate` endpoint

```js
router.get('/validate', async (req, res) => {
  try {
    const result = await AuthService.validateConnection();
    res.json(result);
  } catch (e) {
    res.json({ authenticated: false, senderEmail: null, canSend: false, canLoadTemplate: false, error: e.message });
  }
});
```

**Why:** The frontend needs an endpoint that does deep validation. `/auth/status` is synchronous and shallow (just file existence). `/auth/validate` is async and actually tests the OAuth connection.

## Fix 4: Backend — requireGmailValidated Middleware

For critical operations (sending emails, batch send-now), use deep auth validation instead of shallow checks:

```js
// middleware/requireGmail.js
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
      error: 'Gmail validation failed',
      code: 'GMAIL_NOT_CONNECTED',
      connectUrl: '/api/auth/url',
    });
  }
}
```

Apply to send-related routes:
```js
router.post('/batch/:id/send-now', requireGmailValidated, async (req, res) => { ... });
```

**Why:** The existing `requireGmail` middleware only calls `AuthService.isConnected()` (shallow check). If tokens are stale/revoked but the file exists, it passes — then the actual send fails with `invalid_grant`. `requireGmailValidated` prevents this by testing the token before the operation starts.

## Validation Checklist

- `npm run build` (frontend) — must pass
- `node -e "import('./src/auth/index.js')"` — must load without errors
- `node -e "import('./src/routes/auth.routes.js')"` — must load without errors
- `node -e "import('./src/middleware/requireGmail.js')"` — must load without errors
- After restarting backend, visit frontend → Gmail should show connected from cache instantly, then confirm with `/auth/validate`

## When to Use

Any app where:
- OAuth tokens are persisted to a file on disk
- The app checks auth status synchronously (just file existence)
- Users see "disconnected" flash on page refresh despite being connected
- Tokens can become stale/revoked without the system noticing
- Critical operations (email sending) need guaranteed auth before proceeding
