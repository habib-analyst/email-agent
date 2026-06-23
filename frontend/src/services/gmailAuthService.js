import { get, post, setSessionToken } from '../api.js';

/** Central Gmail auth API — single source for connect/disconnect/status */
export const gmailAuthService = {
  async getStatus() {
    return get('/auth/status');
  },

  async getConnectUrl() {
    const { url } = await get('/auth/url');
    return url;
  },

  async connect() {
    const url = await this.getConnectUrl();
    window.location.href = url;
  },

  async disconnect() {
    const result = await post('/auth/disconnect');
    setSessionToken('');
    return result;
  },

  /** Parse OAuth redirect query params after Google callback */
  parseOAuthReturn(search) {
    const params = new URLSearchParams(search);
    const gmail = params.get('gmail');
    if (!gmail) return null;
    const session = params.get('session');
    if (gmail === 'connected' && session) setSessionToken(session);
    return {
      success: gmail === 'connected',
      error: gmail === 'error' ? params.get('msg') || 'Connection failed' : null,
    };
  },

  clearOAuthParams() {
    const url = new URL(window.location.href);
    url.searchParams.delete('gmail');
    url.searchParams.delete('msg');
    url.searchParams.delete('session');
    window.history.replaceState({}, '', url.pathname + url.search);
  },
};

export default gmailAuthService;
