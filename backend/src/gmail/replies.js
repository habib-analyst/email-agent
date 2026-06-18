import { google } from 'googleapis';
import { getAuthedClient } from '../auth/index.js';
import { classifyReply } from '../ai/index.js';
import db from '../db/index.js';
import { withRetry } from '../pipeline/utils.js';
import { recordDeliveryFailure } from '../db/deliveryFailures.js';
import { eventBus } from '../core/EventBus.js';
import { recordSendIncident, toSqliteUtc } from './sendControl.js';

const SELF_EMAILS = new Set(['mailer-daemon@googlemail.com', 'mail delivery subsystem', 'postmaster']);

export function hasProcessedDeliveryFailure(messageId) {
  if (!messageId) return false;
  const deliveryFailure = db.prepare(
    'SELECT 1 FROM delivery_failures WHERE message_id=? LIMIT 1'
  ).get(messageId);
  const sendIncident = db.prepare(
    'SELECT 1 FROM outbound_send_incidents WHERE message_id=? LIMIT 1'
  ).get(messageId);
  return Boolean(deliveryFailure || sendIncident);
}

export async function classifyReplies({ maxResults = 100, windowDays: forcedWindowDays } = {}) {
  const auth = getAuthedClient();
  if (!auth) return { scanned: 0, imported: 0, failures: 0 };
  const gmail = google.gmail({ version: 'v1', auth });
  const result = { scanned: 0, imported: 0, failures: 0 };

  const settings = db.prepare('SELECT followup_days FROM settings WHERE id=1').get();
  const windowDays = forcedWindowDays || settings?.followup_days || 7;

  const sentEmails = db.prepare(`
    SELECT professor_email, message_id, 'instant' as mode, NULL as batch_id, NULL as draft_id, NULL as queue_id FROM sent_log
    UNION ALL
    SELECT professor_email, message_id, mode, batch_id, draft_id, queue_id FROM sent_email_history
  `).all();
  if (!sentEmails.length) return result;

  const res = await gmail.users.messages.list({
    userId: 'me',
    labelIds: ['INBOX'],
    maxResults,
    q: `newer_than:${windowDays}d (from:mailer-daemon OR from:postmaster OR "Delivery has failed" OR "You have reached a limit for sending mail" OR "couldn't be found")`,
  });
  if (!res.data.messages) return result;

  for (const msg of res.data.messages) {
    result.scanned += 1;
    const full = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
    const from = full.data.payload.headers.find(h => h.name === 'From')?.value || '';
    const subject = full.data.payload.headers.find(h => h.name === 'Subject')?.value || '';
    const threadId = full.data.threadId;
    const body = extractBody(full.data.payload);

    const bounce = detectDeliveryFailure({ from, subject, body });
    if (bounce) {
      if (hasProcessedDeliveryFailure(full.data.id)) {
        await labelDeliveryFailureMessage(gmail, full.data.id, bounce.type).catch(() => {});
        continue;
      }

      if (bounce.type === 'send_limit') {
        const incident = recordSendIncident({
          type: 'send_limit',
          reason: bounce.reason,
          source: 'gmail_bounce',
          messageId: full.data.id,
        });
        if (incident.added) {
          result.failures += 1;
          db.prepare(`
            UPDATE scheduled_batches
            SET status=CASE WHEN auto_approve=1 THEN 'scheduled' ELSE 'drafted' END,
                scheduled_at=?,
                ready_notice_sent_at=NULL
            WHERE status IN ('pending','processing','drafted','scheduled','sending')
          `).run(toSqliteUtc(incident.pausedUntil));
          eventBus.publish({
            type: 'scheduled_send_limit_reached',
            mode: 'scheduled',
            error: bounce.reason,
            pausedUntil: incident.pausedUntil,
          });
        }
        await labelDeliveryFailureMessage(gmail, full.data.id, bounce.type).catch(() => {});
        continue;
      }

      const recipients = extractFailureRecipients(body, sentEmails);
      const targets = recipients.length ? recipients : inferLatestSentTargets(sentEmails, bounce.type);
      let addedNewFailure = false;
      for (const target of targets) {
        const email = String(target.professor_email || target.email || '').toLowerCase().trim();
        const existing = email
          ? db.prepare('SELECT 1 FROM delivery_failures WHERE message_id=? AND professor_email=?').get(full.data.id, email)
          : null;
        recordDeliveryFailure({
          professor_email: email,
          failure_type: bounce.type,
          reason: bounce.reason,
          source: 'gmail_bounce',
          mode: target.mode || 'scheduled',
          message_id: full.data.id,
          thread_id: threadId,
          batch_id: target.batch_id,
          draft_id: target.draft_id,
          queue_id: target.queue_id,
          raw_excerpt: body.slice(0, 1000),
        });
        if (email && !existing) addedNewFailure = true;
      }
      if (addedNewFailure) result.failures += 1;
      await labelDeliveryFailureMessage(gmail, full.data.id, bounce.type).catch(() => {});
      continue;
    }

    const matchedProf = sentEmails.find(s => from.toLowerCase().includes(s.professor_email.toLowerCase()));
    if (!matchedProf) continue;

    const existing = db.prepare('SELECT 1 FROM replies WHERE gmail_message_id=?').get(full.data.id);
    if (existing) continue;

    const classification = await withRetry(() => classifyReply(body));

    db.prepare(`
      INSERT INTO replies
        (thread_id, professor_email, classification, summary, received_at, mode, original_subject, reply_body, gmail_message_id, analyzed_at)
      VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, datetime('now'))
    `).run(
      threadId,
      matchedProf.professor_email,
      classification.classification,
      classification.summary,
      matchedProf.mode || 'instant',
      subject,
      body,
      full.data.id,
    );
    result.imported += 1;

    if (classification.classification === 'positive') {
      db.prepare(`UPDATE learning_stats SET replies=replies+1, positive_replies=positive_replies+1
        WHERE topic IN (SELECT topic FROM sent_log WHERE professor_email=? AND topic IS NOT NULL)`).run(matchedProf.professor_email);
    }

    // Mark queue item as replied
    const queueItem = db.prepare("SELECT q.id FROM queue q JOIN professors p ON q.professor_id=p.id WHERE p.email=? AND q.state='sent'").get(matchedProf.professor_email);
    if (queueItem) db.prepare("UPDATE queue SET state='replied' WHERE id=?").run(queueItem.id);
  }
  return result;
}

async function ensureLabel(gmail, name) {
  const labels = await gmail.users.labels.list({ userId: 'me' });
  const existing = labels.data.labels?.find(l => l.name === name);
  if (existing) return existing.id;
  const created = await gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    },
  });
  return created.data.id;
}

async function labelDeliveryFailureMessage(gmail, messageId, failureType) {
  if (!messageId) return;
  const base = await ensureLabel(gmail, 'Email Agent/Delivery Failure');
  const typed = await ensureLabel(gmail, `Email Agent/${failureType === 'send_limit' ? 'Send Limit' : failureType === 'not_found' ? 'Address Not Found' : 'Delivery Failed'}`);
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { addLabelIds: [base, typed] },
  });
}

function detectDeliveryFailure({ from, subject, body }) {
  const text = `${from}\n${subject}\n${body}`.toLowerCase();
  const isDaemon = SELF_EMAILS.has(from.toLowerCase().trim())
    || text.includes('mailer-daemon')
    || text.includes('mail delivery subsystem')
    || text.includes('postmaster@');
  if (!isDaemon && !text.includes('delivery has failed')) return null;
  if (text.includes('you have reached a limit for sending mail') || text.includes('mail sending') && text.includes('rate limit')) {
    return { type: 'send_limit', reason: 'Gmail send limit reached; message was not sent' };
  }
  if (text.includes("couldn't be found") || text.includes('could not be found') || text.includes('address not found') || text.includes('recipient address rejected')) {
    return { type: 'not_found', reason: 'Recipient email address not found' };
  }
  if (text.includes('delivery has failed') || text.includes('message was not delivered')) {
    return { type: 'delivery_failed', reason: 'Delivery failed' };
  }
  return null;
}

function extractFailureRecipients(body, sentEmails) {
  const emails = [...new Set(String(body || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])]
    .map(e => e.toLowerCase())
    .filter(e => !e.includes('googlemail.com') && !e.includes('gmail.com') && !e.startsWith('mailer-daemon') && !e.startsWith('postmaster'));
  const sentByEmail = new Map(sentEmails.map(s => [String(s.professor_email || '').toLowerCase(), s]));
  return emails.map(email => sentByEmail.get(email) || { email, mode: 'scheduled' });
}

function inferLatestSentTargets() {
  return [];
}

function extractBody(payload) {
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  }
  if (payload.parts) {
    for (const p of payload.parts) {
      const found = extractBody(p);
      if (found) return found;
    }
  }
  return '';
}
