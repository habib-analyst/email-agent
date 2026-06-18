import { google } from 'googleapis';
import { getAuthedClient, fetchGmailProfile } from '../auth/index.js';
import { readFileSync } from 'fs';
import { basename, extname } from 'path';
import db from '../db/index.js';
import { recordSentEmail } from '../db/sentEmailHistory.js';
import { formatGreetingLastName } from '../utils/professor.js';
import { normalizeInterestLineKeywords } from '../utils/interestLine.js';
import { getSenderIdentity } from '../services/senderIdentity.js';
import { config } from '../config/index.js';

let _authRetries = 0;
const MAX_AUTH_RETRIES = 1;

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

function buildReplyMime(fromEmail, fromName, to, subject, html, attachmentPath) {
  const from = formatFrom(fromEmail, fromName);
  if (!attachmentPath) {
    // Simple HTML-only email
    const parts = [
      `MIME-Version: 1.0`,
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
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

export async function sendReplyEmail({ to, subject, html, attachmentPath }) {
  const sender = config.dryRunSend
    ? getSenderIdentity()
    : requireSenderIdentity();
  const email = sender.email || config.senderEmail || 'dry-run@example.local';
  const name = sender.name || config.senderName || 'Dry Run Sender';
  const raw = buildReplyMime(email, name, to, subject, html, attachmentPath);
  if (config.dryRunSend) {
    console.log(`[Gmail:DryRun] Would send reply to ${to}: ${subject}`);
    return { id: `dry-run-reply-${Date.now()}`, dryRun: true, rawSize: raw.length };
  }
  for (let authAttempt = 0; authAttempt <= MAX_AUTH_RETRIES; authAttempt++) {
    try {
      const gmail = getGmail(authAttempt > 0);
      const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      _authRetries = 0;
      return res.data;
    } catch (e) {
      if (isAuthError(e) && authAttempt < MAX_AUTH_RETRIES) {
        console.log('[Gmail:Reply] Auth error, refreshing token and retrying...');
        clearGmailCache();
        continue;
      }
      throw e;
    }
  }
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
    return result;
  }

  // Try sending with auth refresh on auth errors
  for (let authAttempt = 0; authAttempt <= MAX_AUTH_RETRIES; authAttempt++) {
    try {
      const gmail = getGmail(authAttempt > 0);
      const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      _authRetries = 0;
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
      return res.data;
    } catch (e) {
      if (isAuthError(e) && authAttempt < MAX_AUTH_RETRIES) {
        console.log('[Gmail] Auth error, refreshing token and retrying...');
        clearGmailCache();
        continue;
      }
      throw e;
    }
  }
}

let sentListCache = { data: null, ts: 0 };
let latestHtmlCache = { html: null, ts: 0 };

export async function listSentEmails(maxResults = 15) {
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
  sentListCache = { data: result, ts: Date.now() };
  return result;
}

export function clearGmailCache() {
  latestHtmlCache = { html: null, ts: 0 };
  sentListCache = { data: null, ts: 0 };
}

export async function searchSentByRecipient(recipient) {
  const gmail = getGmail();
  const list = await gmail.users.messages.list({ userId: 'me', q: `to:${recipient} in:sent`, maxResults: 1 });
  if (!list.data.messages?.length) return null;
  return getEmailHtml(list.data.messages[0].id);
}

export async function getLatestSentHtml(force = false) {
  if (!force && latestHtmlCache.html && Date.now() - latestHtmlCache.ts < 30000) return latestHtmlCache.html;

  const gmail = getGmail();
  const list = await gmail.users.messages.list({ userId: 'me', labelIds: ['SENT'], maxResults: 1 });
  if (!list.data.messages?.length) return null;
  const html = await getEmailHtml(list.data.messages[0].id);
  latestHtmlCache = { html, ts: Date.now() };
  return html;
}

export async function getEmailHtml(messageId) {
  const gmail = getGmail();
  const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const part = findHtmlPart(msg.data.payload);
  if (!part) return null;
  return Buffer.from(part.body.data, 'base64url').toString('utf8');
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
