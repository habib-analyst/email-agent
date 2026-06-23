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
    const table = mode.includes('scheduled') ? 'scheduled_template' : 'template';
    const existing = db.prepare(`SELECT raw_html FROM ${table} WHERE mode=?`).get(mode);
    if (existing?.raw_html) {
      return { mode, success: false, reason: 'template_already_set' };
    }

    try {
      const result = await Promise.race([
        mode === 'basic_instant'
          ? Promise.resolve(seedBasicInstantTemplate()).then(() => ({ success: true }))
          : loadTemplateFromFile(mode),
        new Promise(resolve => setTimeout(() => resolve({ success: false, reason: 'timeout' }), 20000)),
      ]);
      if (result.success) {
        eventBus.publish({ type: 'template_loaded', source, mode });
      }
      return { mode, ...result };
    } catch (e) {
      return { mode, success: false, reason: e.message };
    }
  },
};

export default GmailService;
