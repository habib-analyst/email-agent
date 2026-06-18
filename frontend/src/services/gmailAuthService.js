import { get, post } from '../api.js';

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
    return post('/auth/disconnect');
  },

  /** Parse OAuth redirect query params after Google callback */
  parseOAuthReturn(search) {
    const params = new URLSearchParams(search);
    const gmail = params.get('gmail');
    if (!gmail) return null;
    return {
      success: gmail === 'connected',
      error: gmail === 'error' ? params.get('msg') || 'Connection failed' : null,
    };
  },

  clearOAuthParams() {
    const url = new URL(window.location.href);
    url.searchParams.delete('gmail');
    url.searchParams.delete('msg');
    window.history.replaceState({}, '', url.pathname + url.search);
  },
};

export default gmailAuthService;
