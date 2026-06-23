/**
 * Central event bus — all real-time UI updates flow through here.
 * Services (pipeline, scrape, auth, reset) publish; SSE clients subscribe.
 */

import { currentTenantKey } from '../db/index.js';

const sseClients = new Map();
const listeners = new Set();
let heartbeatInterval = null;

export const eventBus = {
  /** Internal listeners (archive, analytics) — not forwarded to SSE clients. */
  on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  addClient(res) {
    sseClients.set(res, currentTenantKey() || 'anonymous');
    // Start heartbeat when first client connects
    if (sseClients.size === 1 && !heartbeatInterval) {
      heartbeatInterval = setInterval(() => {
        const msg = `: heartbeat ${Date.now()}\n\n`;
        for (const [r] of sseClients) {
          try { r.write(msg); } catch { sseClients.delete(r); }
        }
      }, 15000);  // 15s keepalive — must be under any proxy timeout
      console.log('[EventBus] Heartbeat started (15s)');
    }
  },

  removeClient(res) {
    sseClients.delete(res);
    // Stop heartbeat when no clients connected
    if (sseClients.size === 0 && heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
      console.log('[EventBus] Heartbeat stopped (no clients)');
    }
  },

  publish(event) {
    const tenant = currentTenantKey() || 'anonymous';
    for (const fn of listeners) {
      try { fn(event); } catch (e) { console.error('[EventBus] Listener error:', e.message); }
    }
    const msg = `data: ${JSON.stringify(event)}\n\n`;
    for (const [res, clientTenant] of sseClients) {
      if (clientTenant !== tenant) continue;
      try { res.write(msg); } catch { sseClients.delete(res); }
    }
  },

  clientCount() {
    return sseClients.size;
  },
};
