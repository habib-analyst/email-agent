import { google } from 'googleapis';
import { getAuthedClient, fetchGmailProfile } from '../auth/index.js';
import { readFileSync } from 'fs';
import { basename, extname } from 'path';
import db, { currentTenantKey } from '../db/index.js';
import { recordSentEmail } from '../db/sentEmailHistory.js';
import { formatGreetingLastName } from '../utils/professor.js';
import { normalizeInterestLineKeywords } from '../utils/interestLine.js';
import { getSenderIdentity, requireSenderIdentity } from '../services/senderIdentity.js';
import { config } from '../config/index.js';
import { eventBus } from '../core/EventBus.js';
import {
  completeOutboundSend,
  DuplicateSendError,
  recordSendIncident,
  releaseOutboundSend,
  reserveOutboundSend,
} from './sendControl.js';

let _authRetries = 0;
const MAX_AUTH_RETRIES = 1;

function publishSentHistoryUpdated({ email, mode, messageId }) {
  eventBus.publish({
    type: 'sent_history_updated',
    professor: email,
    mode,
    messageId: messageId || null,
    at: new Date().toISOString(),
  });
}

function getGmail(forceRefresh = false) {
  const auth = getAuthedClient();
  if (!auth) throw new Error('Not authenticated');
  if (forceRefresh) {
    // Force token refresh by refreshing the access token
    auth.refreshAccessToken().catch(e => console.error('[Gmail] Token refresh failed:', e.message));
  }
  return google.gmail({ version: 'v1', auth });
}

function isAuthError(e) {
  const msg = e.message || '';
  return msg.includes('invalid_grant') || msg.includes('token expired') || msg.includes('401') || msg.includes('unauthorized');
}

export function isSendLimitError(e) {
  const msg = String(e?.message || '').toLowerCase();
  return msg.includes('limit for sending mail')
    || msg.includes('sending limit')
    || msg.includes('quota')
    || msg.includes('too many requests')
    || msg.includes('rate limit')
    || msg.includes('daily limit');
}

export function getSendLimitRetryAt(error) {
  const message = String(error?.message || '');
  const timestampMatch = message.match(/retry after\s+(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)/i);
  if (timestampMatch) {
    const parsed = new Date(timestampMatch[1]);
    if (Number.isFinite(parsed.getTime()) && parsed.getTime() > Date.now()) return parsed.toISOString();
  }

  const retryAfter = error?.response?.headers?.['retry-after'];
  if (retryAfter != null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return new Date(Date.now() + seconds * 1000).toISOString();
    }
    const parsed = new Date(retryAfter);
    if (Number.isFinite(parsed.getTime()) && parsed.getTime() > Date.now()) return parsed.toISOString();
  }
  return null;
}

function formatFrom(email, displayName) {
  const addr = (email || '').trim();
  const name = (displayName || '').trim();
  if (!name) return addr;
  const safe = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${safe}" <${addr}>`;
}

function attachmentContentType(path) {
  const extension = extname(path).toLowerCase();
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function buildMime(fromEmail, fromName, to, subject, html, attachmentPath) {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2, 10)}_${process.pid}`;
  const attachmentName = basename(attachmentPath);
  const attachmentData = readFileSync(attachmentPath).toString('base64');
  // Wrap base64 at 76 chars per RFC 2045
  const wrappedAttachment = attachmentData.match(/.{1,76}/g)?.join('\r\n') || attachmentData;
  const from = formatFrom(fromEmail, fromName);

  const parts = [
    `MIME-Version: 1.0`,
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    html,
    `--${boundary}`,
    `Content-Type: ${attachmentContentType(attachmentPath)}; name="${attachmentName}"`,
    `Content-Disposition: attachment; filename="${attachmentName}"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    wrappedAttachment,
    `--${boundary}--`,
  ];

  return Buffer.from(parts.join('\r\n')).toString('base64url');
}

function buildReplyMime(fromEmail, fromName, to, subject, html, attachmentPath, replyHeaders = {}) {
  const from = formatFrom(fromEmail, fromName);
  const threadHeaders = [
    replyHeaders.inReplyTo ? `In-Reply-To: ${replyHeaders.inReplyTo}` : null,
    replyHeaders.references ? `References: ${replyHeaders.references}` : null,
  ].filter(Boolean);
  if (!attachmentPath) {
    // Simple HTML-only email
    const parts = [
      `MIME-Version: 1.0`,
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      ...threadHeaders,
      `Content-Type: text/html; charset="UTF-8"`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      html,
    ];
    return Buffer.from(parts.join('\r\n')).toString('base64url');
  }
  // HTML + optional attachment
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2, 10)}_${process.pid}`;
  const attName = basename(attachmentPath);
  const attData = readFileSync(attachmentPath).toString('base64');
  const wrappedAtt = attData.match(/.{1,76}/g)?.join('\r\n') || attData;
  const parts = [
    `MIME-Version: 1.0`,
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    ...threadHeaders,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    html,
    `--${boundary}`,
    `Content-Type: application/octet-stream; name="${attName}"`,
    `Content-Disposition: attachment; filename="${attName}"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    wrappedAtt,
    `--${boundary}--`,
  ];
  return Buffer.from(parts.join('\r\n')).toString('base64url');
}

export async function sendReplyEmail({ to, subject, html, attachmentPath, threadId, replyHeaders }) {
  const sender = config.dryRunSend
    ? getSenderIdentity()
    : requireSenderIdentity();
  const email = sender.email || config.senderEmail || 'dry-run@example.local';
  const name = sender.name || config.senderName || 'Dry Run Sender';
  const raw = buildReplyMime(email, name, to, subject, html, attachmentPath, replyHeaders);
  if (config.dryRunSend) {
    console.log(`[Gmail:DryRun] Would send reply to ${to}: ${subject}`);
    return { id: `dry-run-reply-${Date.now()}`, dryRun: true, rawSize: raw.length };
  }
  const reservation = await reserveOutboundSend({ mode: 'reply' });
  for (let authAttempt = 0; authAttempt <= MAX_AUTH_RETRIES; authAttempt++) {
    try {
      const gmail = getGmail(authAttempt > 0);
      const res = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw, ...(threadId ? { threadId } : {}) },
      });
      _authRetries = 0;
      try {
        recordSentEmail({
          professor_email: to,
          subject,
          message_id: res.data?.id || null,
          mode: 'reply',
          source: 'gmail_reply',
        });
        publishSentHistoryUpdated({ email: to, mode: 'reply', messageId: res.data?.id });
        completeOutboundSend(reservation.id);
      } catch (persistError) {
        console.error('[Gmail:Reply] Sent successfully but local history update failed:', persistError.message);
        try { releaseOutboundSend(reservation.id); } catch {}
      }
      return res.data;
    } catch (e) {
      if (isAuthError(e) && authAttempt < MAX_AUTH_RETRIES) {
        console.log('[Gmail:Reply] Auth error, refreshing token and retrying...');
        clearGmailCache();
        continue;
      }
      releaseOutboundSend(reservation.id);
      if (isSendLimitError(e)) {
        recordSendIncident({
          type: 'send_limit',
          reason: e.message,
          source: 'gmail_api',
          retryAt: getSendLimitRetryAt(e),
        });
      }
      throw e;
    }
  }
}

export async function createReplyDraft({ to, subject, html, attachmentPath, threadId, replyHeaders }) {
  const sender = config.dryRunSend
    ? getSenderIdentity()
    : requireSenderIdentity();
  const email = sender.email || config.senderEmail || 'dry-run@example.local';
  const name = sender.name || config.senderName || 'Dry Run Sender';
  const raw = buildReplyMime(email, name, to, subject, html, attachmentPath, replyHeaders);
  if (config.dryRunSend) {
    return { id: `dry-run-draft-${Date.now()}`, message: { threadId }, dryRun: true };
  }
  const gmail = getGmail();
  const response = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: { raw, ...(threadId ? { threadId } : {}) },
    },
  });
  return response.data;
}

export async function sendEmail(item) {
  const itemMode = item.mode || 'instant';
  const settings = db.prepare('SELECT resume_path FROM settings WHERE id=1').get();
  if (!settings?.resume_path) throw new Error('No resume path configured');

  // Look up professor from the correct table based on mode
  let prof;
  if (itemMode === 'scheduled') {
    prof = db.prepare('SELECT email, last_name, university FROM scheduled_professors WHERE id=?').get(item.professor_id);
  } else {
    prof = db.prepare('SELECT email, last_name, university FROM professors WHERE id=?').get(item.professor_id);
  }
  if (!prof) throw new Error(`Professor ${item.professor_id} not found in ${itemMode} table`);
  const priorSend = db.prepare(`
    SELECT sent_at, subject, message_id, mode, batch_id
    FROM sent_email_history
    WHERE lower(professor_email)=lower(?)
    ORDER BY sent_at DESC, id DESC
    LIMIT 1
  `).get(prof.email);
  if (priorSend && !item.confirmedFailureResend) throw new DuplicateSendError(prof.email, priorSend);

  // Use custom_html if the user edited the email body, otherwise build from template
  let html;
  if (item.custom_html) {
    html = item.custom_html;
  } else {
    // Load template from the correct table based on mode
    let tpl;
    if (itemMode === 'scheduled') {
      const tmplMode = item.scheduledTemplateMode || 'scheduled';
      tpl = db.prepare('SELECT raw_html FROM scheduled_template WHERE mode=?').get(tmplMode);
    } else {
      tpl = db.prepare('SELECT raw_html FROM template WHERE mode=?').get(itemMode);
    }
    if (!tpl || !tpl.raw_html) throw new Error('No template configured — save a template first');

    if (!prof.last_name || prof.last_name.length < 2) {
      throw new Error(`Cannot send email: Professor ${prof.email} has invalid last_name='${prof.last_name}'`);
    }

    const stripInterest = item.stripInterestLine || itemMode === 'basic_instant' || !item.interest_line?.trim();
    let interestLine = normalizeInterestLineKeywords(item.interest_line || '');

    html = tpl.raw_html
      .replace(/\{\{LAST_NAME\}\}/g, formatGreetingLastName(prof.last_name))
      .replace(/\{\{INTEREST_LINE\}\}/g, stripInterest ? '' : interestLine);

    if (stripInterest) {
      html = html
        .replace(/<p>\s*I am (?:particularly )?interested in your work (?:on|in)\s*[^<]*<\/p>/gi, '')
        .replace(/<p>\s*<\/p>/gi, '')
        .replace(/\n{3,}/g, '\n\n');
    }

    const errors = [];
    if (html.includes('{{LAST_NAME}}')) errors.push('LAST_NAME placeholder not replaced');
    if (!stripInterest && html.includes('{{INTEREST_LINE}}')) errors.push('INTEREST_LINE placeholder not replaced');
    if (!stripInterest && !item.interest_line?.trim()) errors.push('Interest line is empty');
    if (!stripInterest && !/^\[.+\]/.test(item.subject)) errors.push('Subject missing [Topic] prefix');
    if (stripInterest && item.useSubjectKeyword && !/^\[.+\]/.test(item.subject)) errors.push('Subject missing [Topic] prefix');
    if (errors.length) throw new Error(`Pre-send validation failed: ${errors.join('; ')}`);
  }

  let sender = config.dryRunSend
    ? getSenderIdentity()
    : getSenderIdentity();
  if (!sender?.email && !config.dryRunSend) {
    const profile = await fetchGmailProfile({ force: false });
    if (profile?.email) {
      sender = { email: profile.email, name: profile.name || config.senderName || '' };
    }
  }
  const email = sender?.email || config.senderEmail || 'dry-run@example.local';
  const name = sender?.name || config.senderName || 'Dry Run Sender';
  const raw = buildMime(email, name, prof.email, item.subject, html, settings.resume_path);
  if (config.dryRunSend) {
    console.log(`[Gmail:DryRun] Would send ${itemMode} email to ${prof.email}: ${item.subject}`);
    const result = { id: `dry-run-${Date.now()}`, dryRun: true, rawSize: raw.length };
    recordSentEmail({
      professor_email: prof.email,
      last_name: prof.last_name,
      university: prof.university,
      subject: item.subject,
      message_id: result.id,
      mode: itemMode,
      source: 'gmail_dry_run',
      professor_id: item.professor_id,
      queue_id: item.id,
      batch_id: item.batch_id,
      draft_id: item.draft_id,
    });
    publishSentHistoryUpdated({ email: prof.email, mode: itemMode, messageId: result.id });
    return result;
  }

  const reservation = await reserveOutboundSend({
    mode: itemMode,
    recipientEmail: prof.email,
    allowDuplicate: item.confirmedFailureResend === true,
  });
  // Try sending with auth refresh on auth errors
  for (let authAttempt = 0; authAttempt <= MAX_AUTH_RETRIES; authAttempt++) {
    try {
      const gmail = getGmail(authAttempt > 0);
      const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      _authRetries = 0;
      try {
        recordSentEmail({
          professor_email: prof.email,
          last_name: prof.last_name,
          university: prof.university,
          subject: item.subject,
          message_id: res.data?.id || null,
          mode: itemMode,
          source: 'gmail_send',
          professor_id: item.professor_id,
          queue_id: item.id,
          batch_id: item.batch_id,
          draft_id: item.draft_id,
        });
        publishSentHistoryUpdated({ email: prof.email, mode: itemMode, messageId: res.data?.id });
        completeOutboundSend(reservation.id);
      } catch (persistError) {
        console.error('[Gmail] Sent successfully but local history update failed:', persistError.message);
        try { releaseOutboundSend(reservation.id); } catch {}
      }
      return res.data;
    } catch (e) {
      if (isAuthError(e) && authAttempt < MAX_AUTH_RETRIES) {
        console.log('[Gmail] Auth error, refreshing token and retrying...');
        clearGmailCache();
        continue;
      }
      releaseOutboundSend(reservation.id);
      if (isSendLimitError(e)) {
        recordSendIncident({
          type: 'send_limit',
          reason: e.message,
          source: 'gmail_api',
          retryAt: getSendLimitRetryAt(e),
        });
      }
      throw e;
    }
  }
}

const sentListCaches = new Map();
const latestHtmlCaches = new Map();

export async function listSentEmails(maxResults = 15) {
  const tenant = currentTenantKey() || 'anonymous';
  const sentListCache = sentListCaches.get(tenant) || { data: null, ts: 0 };
  if (sentListCache.data && Date.now() - sentListCache.ts < 15000) return sentListCache.data;

  const gmail = getGmail();
  const list = await gmail.users.messages.list({ userId: 'me', labelIds: ['SENT'], maxResults });
  if (!list.data.messages) return [];

  const emails = await Promise.all(list.data.messages.map(async (m) => {
    try {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['Subject', 'To', 'Date'] });
      const headers = msg.data.payload.headers;
      return {
        id: m.id,
        subject: headers.find(h => h.name === 'Subject')?.value || '(No subject)',
        to: headers.find(h => h.name === 'To')?.value || '',
        date: headers.find(h => h.name === 'Date')?.value || '',
      };
    } catch { return null; }
  }));
  const result = emails.filter(Boolean);
  sentListCaches.set(tenant, { data: result, ts: Date.now() });
  return result;
}

export function clearGmailCache() {
  const tenant = currentTenantKey() || 'anonymous';
  latestHtmlCaches.delete(tenant);
  sentListCaches.delete(tenant);
}

export async function searchSentByRecipient(recipient) {
  const gmail = getGmail();
  const list = await gmail.users.messages.list({ userId: 'me', q: `to:${recipient} in:sent`, maxResults: 1 });
  if (!list.data.messages?.length) return null;
  return getEmailHtml(list.data.messages[0].id);
}

export async function getLatestSentHtml(force = false) {
  const tenant = currentTenantKey() || 'anonymous';
  const latestHtmlCache = latestHtmlCaches.get(tenant) || { html: null, ts: 0 };
  if (!force && latestHtmlCache.html && Date.now() - latestHtmlCache.ts < 30000) return latestHtmlCache.html;

  const gmail = getGmail();
  const list = await gmail.users.messages.list({ userId: 'me', labelIds: ['SENT'], maxResults: 1 });
  if (!list.data.messages?.length) return null;
  const html = await getEmailHtml(list.data.messages[0].id);
  latestHtmlCaches.set(tenant, { html, ts: Date.now() });
  return html;
}

export async function getEmailHtml(messageId) {
  const gmail = getGmail();
  const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const part = findHtmlPart(msg.data.payload);
  if (!part) return null;
  return Buffer.from(part.body.data, 'base64url').toString('utf8');
}

export async function getSentEmailSnapshot(messageId) {
  const gmail = getGmail();
  const response = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const part = findHtmlPart(response.data.payload);
  const headers = response.data.payload?.headers || [];
  const header = name => headers.find(item => item.name?.toLowerCase() === name)?.value || '';
  return {
    html: part?.body?.data ? Buffer.from(part.body.data, 'base64url').toString('utf8') : null,
    threadId: response.data.threadId || null,
    internalDate: response.data.internalDate ? new Date(Number(response.data.internalDate)).toISOString() : null,
    from: header('from'),
    to: header('to'),
    subject: header('subject'),
  };
}

export async function getMessageReplyHeaders(messageId) {
  if (!messageId) return {};
  const gmail = getGmail();
  const response = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'metadata',
    metadataHeaders: ['Message-ID', 'References'],
  });
  const headers = response.data.payload?.headers || [];
  const messageIdHeader = headers.find(item => item.name?.toLowerCase() === 'message-id')?.value || '';
  const references = headers.find(item => item.name?.toLowerCase() === 'references')?.value || '';
  return {
    inReplyTo: messageIdHeader,
    references: [references, messageIdHeader].filter(Boolean).join(' ').trim(),
  };
}

function findHtmlPart(payload) {
  if (payload.mimeType === 'text/html' && payload.body?.data) return payload;
  if (payload.parts) {
    for (const p of payload.parts) {
      const found = findHtmlPart(p);
      if (found) return found;
    }
  }
  return null;
}
