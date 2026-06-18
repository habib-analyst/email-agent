import {
  listSentEmails,
  getEmailHtml,
  getLatestSentHtml,
  clearGmailCache,
  sendEmail,
} from '../gmail/index.js';
import { loadLatestSentAsTemplate } from '../gmail/templateLoader.js';
import { loadTemplateFromFile, seedBasicInstantTemplate } from '../gmail/templateSeeder.js';
import db from '../db/index.js';
import { classifyReplies } from '../gmail/replies.js';
import { AuthService, GmailNotConnectedError } from './AuthService.js';
import { eventBus } from '../core/EventBus.js';

export const GmailService = {
  requireAuth() {
    if (!AuthService.isConnected()) throw new GmailNotConnectedError();
  },

  async listSent(limit = 20) {
    this.requireAuth();
    return listSentEmails(limit);
  },

  async getSentHtml(messageId) {
    this.requireAuth();
    return getEmailHtml(messageId);
  },

  async getLatestHtml(force = true) {
    this.requireAuth();
    return getLatestSentHtml(force);
  },

  clearCache() {
    clearGmailCache();
  },

  async loadLatestAsTemplate(mode = 'instant') {
    const result = await loadLatestSentAsTemplate(mode);
    if (result.success) {
      eventBus.publish({ type: 'template_loaded', source: 'file', mode });
    }
    return result;
  },

  async send(payload) {
    this.requireAuth();
    return sendEmail(payload);
  },

  async classifyInboxReplies(options = {}) {
    if (!AuthService.isConnected()) return { skipped: true, reason: 'not_connected' };
    const result = await classifyReplies(options);
    return { skipped: false, ...result };
  },

  /** Auto-load template from Email_Template.txt — seeds both modes if empty */
  async tryAutoLoadTemplate(source, mode = 'instant') {
    // Seed both modes if their template is empty
    const results = [];
    for (const m of ['instant', 'basic_instant', 'scheduled']) {
      const table = m === 'scheduled' ? 'scheduled_template' : 'template';
      const existing = m === 'scheduled'
        ? db.prepare(`SELECT raw_html FROM ${table} LIMIT 1`).get()
        : db.prepare(`SELECT raw_html FROM ${table} WHERE mode=?`).get(m);
      if (existing?.raw_html) {
        results.push({ mode: m, success: false, reason: 'template_already_set' });
        continue;
      }
      try {
        const result = await Promise.race([
          m === 'basic_instant'
            ? Promise.resolve(seedBasicInstantTemplate()).then(() => ({ success: true }))
            : loadTemplateFromFile(m),
          new Promise(resolve => setTimeout(() => resolve({ success: false, reason: 'timeout' }), 20000)),
        ]);
        if (result.success) {
          eventBus.publish({ type: 'template_loaded', source, mode: m });
        }
        results.push({ mode: m, ...result });
      } catch (e) {
        results.push({ mode: m, success: false, reason: e.message });
      }
    }
    // Return result for the requested mode
    return results.find(r => r.mode === mode) || results[0];
  },
};

export default GmailService;
