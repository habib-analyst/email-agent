/**
 * Central real-time event stream — connects all UI components to backend EventBus via SSE.
 */
import { getSessionToken } from '../api.js';

class EventStreamService {
  constructor() {
    this.listeners = new Set();
    this.connected = false;
    this.es = null;
    this.reconnectTimer = null;
    this.refCount = 0;
    this.backoff = 3000;
  }

  connect() {
    this.refCount++;
    if (this.es) return;

    this._open();
  }

  _open() {
    const session = getSessionToken();
    this.es = new EventSource(`/api/queue/stream${session ? `?session=${encodeURIComponent(session)}` : ''}`);
    this.es.onopen = () => {
      this.connected = true;
      this.backoff = 3000;
      this._emit({ type: 'stream_connected' });
    };
    this.es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'connected') return;
        this._emit(data);
      } catch {}
    };
    this.es.onerror = () => {
      this.connected = false;
      this._emit({ type: 'stream_disconnected' });
      this.es?.close();
      this.es = null;
      clearTimeout(this.reconnectTimer);
      if (this.refCount > 0) {
        this.reconnectTimer = setTimeout(() => this._open(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 30000);
      }
    };
  }

  disconnect() {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount > 0) return;
    clearTimeout(this.reconnectTimer);
    this.es?.close();
    this.es = null;
    this.connected = false;
    this.backoff = 3000;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(data) {
    for (const fn of this.listeners) {
      try { fn(data); } catch {}
    }
  }

  isConnected() {
    return this.connected;
  }
}

export const eventStream = new EventStreamService();
export default eventStream;
