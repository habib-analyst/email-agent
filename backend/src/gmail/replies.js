import { google } from 'googleapis';
import { getAuthedClient } from '../auth/index.js';
import { classifyReply } from '../ai/index.js';
import db from '../db/index.js';
import { withRetry } from '../pipeline/utils.js';
import { recordDeliveryFailure } from '../db/deliveryFailures.js';
import { eventBus } from '../core/EventBus.js';
import { recordSendIncident } from './sendControl.js';
import { rescheduleBatchesAfterGmailReset } from '../services/scheduledGmailRecovery.js';

const SCAN_WINDOW_HOURS = 72;
const SYSTEM_SENDERS = ['mailer-daemon', 'mail delivery subsystem', 'postmaster'];

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

async function listMessages(gmail, query, maxResults) {
  const messages = [];
  let pageToken;
  let pageCount = 0;
  const seenPageTokens = new Set();
  do {
    const response = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults: Math.min(500, Math.max(1, Number(maxResults) || 500)),
      pageToken,
      q: query,
    });
    messages.push(...(response.data.messages || []));
    pageToken = response.data.nextPageToken || null;
    pageCount += 1;
    if (pageToken && seenPageTokens.has(pageToken)) break;
    if (pageToken) seenPageTokens.add(pageToken);
  } while (pageToken && pageCount < 20);
  return messages;
}

function header(payload, name) {
  return payload?.headers?.find(item => item.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

function extractEmailAddress(value) {
  const match = String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : '';
}

function deterministicScenario(body, scenarios) {
  const text = String(body || '').toLowerCase();
  const find = name => scenarios.find(item => item.name === name);
  const rules = [
    [/retir(?:e|ed|ing|ement)|leaving academia|left academia/, 'Retiring / Leaving Academia'],
    [/self[- ]fund|own funding|fund yourself|personal funding/, 'Self-Funding Required'],
    [/no (?:funding|funds)|funding (?:is )?(?:not|un)available|lack of funding|grant.*(?:not|un)available/, 'No Funding'],
    [/no (?:lab )?space|lab is full|space in (?:my|the) lab/, 'No Lab Space'],
    [/apply (?:directly )?(?:to|through) (?:the )?university|university application|formal application|graduate admissions/, 'Direct to University Application (No Lab Position)'],
    [/not (?:hiring|recruiting|searching)|no (?:opening|openings|position|positions)|not taking (?:new )?students|no intake/, 'No Searches / No Hiring This Year'],
  ];
  for (const [pattern, name] of rules) {
    if (pattern.test(text)) {
      const scenario = find(name);
      if (scenario) return { scenarioId: scenario.id, confidence: 0.95 };
    }
  }
  return { scenarioId: null, confidence: 0 };
}

function deterministicClassification({ from, subject, body }) {
  const text = `${from}\n${subject}\n${body}`.toLowerCase();
  if (
    /automatic reply|auto(?:matic)?[- ]reply|out of (?:the )?office|away from (?:my )?email|vacation responder|on leave/.test(text)
  ) return 'auto_reply';
  if (
    /glad to|happy to|interested in|let(?:'s| us) (?:meet|talk)|schedule (?:a )?(?:call|meeting)|encourage you to apply|potential opportunity/.test(text)
  ) return 'positive';
  if (
    /not hiring|not recruiting|no funding|no position|no opening|unable to|cannot offer|retir(?:e|ed|ing)|self[- ]fund|lab is full|no lab space/.test(text)
  ) return 'negative';
  return null;
}

export function detectDeliveryFailure({ from, subject, body }) {
  const text = `${from}\n${subject}\n${body}`.toLowerCase();
  const isSystem = SYSTEM_SENDERS.some(sender => text.includes(sender));
  if (!isSystem && !text.includes('delivery has failed') && !text.includes('message was not delivered')) return null;
  if (
    text.includes('you have reached a limit for sending mail')
    || (text.includes('mail sending') && text.includes('rate limit'))
    || text.includes('user-rate limit exceeded')
  ) {
    return { type: 'send_limit', reason: 'Gmail send limit reached; message was not sent' };
  }
  if (
    text.includes("couldn't be found")
    || text.includes('could not be found')
    || text.includes('address not found')
    || text.includes('recipient address rejected')
    || text.includes('does not exist')
  ) {
    return { type: 'not_found', reason: 'Recipient email address not found' };
  }
  return { type: 'delivery_failed', reason: 'Delivery failed' };
}

function extractFailureRecipients(body, sentEmails) {
  const emails = [...new Set(String(body || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])]
    .map(email => email.toLowerCase());
  const sentByEmail = new Map(sentEmails.map(row => [String(row.professor_email || '').toLowerCase(), row]));
  return emails.map(email => sentByEmail.get(email)).filter(Boolean);
}

async function extractFailureRecipientsFromThread(gmail, threadId, sentEmails) {
  if (!threadId) return [];
  const thread = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'metadata',
    metadataHeaders: ['To'],
  });
  const sentByEmail = new Map(sentEmails.map(row => [String(row.professor_email || '').toLowerCase(), row]));
  const targets = [];
  for (const message of thread.data.messages || []) {
    if (!message.labelIds?.includes('SENT')) continue;
    const to = header(message.payload, 'To');
    for (const email of String(to).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []) {
      const target = sentByEmail.get(email.toLowerCase());
      if (target && !targets.some(item => item.professor_email === target.professor_email)) targets.push(target);
    }
  }
  return targets;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"');
}

export function extractBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const plain = extractBody(part);
      if (plain) return plain;
    }
  }
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return stripHtml(Buffer.from(payload.body.data, 'base64url').toString('utf8'));
  }
  return '';
}

export function cleanReplyBody(body) {
  return String(body || '')
    .split(/\nOn .+wrote:\s*$/im)[0]
    .split(/\nFrom:\s.+\nSent:\s/im)[0]
    .split(/\n-{2,}\s*Original Message\s*-{2,}/i)[0]
    .replace(/\n>.*$/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function repliedAfterIncoming(gmail, threadId, incomingAt) {
  if (!threadId || !incomingAt) return false;
  const thread = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'metadata' });
  return (thread.data.messages || []).some(message =>
    message.labelIds?.includes('SENT') && Number(message.internalDate || 0) > incomingAt
  );
}

async function ensureLabel(gmail, name) {
  const labels = await gmail.users.labels.list({ userId: 'me' });
  const existing = labels.data.labels?.find(label => label.name === name);
  if (existing) return existing.id;
  const created = await gmail.users.labels.create({
    userId: 'me',
    requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
  });
  return created.data.id;
}

async function labelDeliveryFailureMessages(gmail, messagesByType) {
  if (!messagesByType?.size) return;
  const base = await ensureLabel(gmail, 'Email Agent/Delivery Failure');
  for (const [failureType, messageIds] of messagesByType) {
    const ids = [...messageIds];
    if (!ids.length) continue;
    const typed = await ensureLabel(
      gmail,
      `Email Agent/${failureType === 'send_limit' ? 'Send Limit' : failureType === 'not_found' ? 'Address Not Found' : 'Delivery Failed'}`
    );
    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: { ids, addLabelIds: [base, typed] },
    });
  }
}

async function processFailureMessage(gmail, message, sentEmails, result, failureMessageIds) {
  const full = await gmail.users.messages.get({ userId: 'me', id: message.id, format: 'full' });
  const from = header(full.data.payload, 'From');
  const subject = header(full.data.payload, 'Subject');
  const body = cleanReplyBody(extractBody(full.data.payload));
  const bounce = detectDeliveryFailure({ from, subject, body });
  if (!bounce || hasProcessedDeliveryFailure(full.data.id)) return;

  const receivedAt = full.data.internalDate
    ? new Date(Number(full.data.internalDate)).toISOString()
    : new Date().toISOString();
  if (!failureMessageIds.has(bounce.type)) failureMessageIds.set(bounce.type, new Set());
  failureMessageIds.get(bounce.type).add(full.data.id);

  if (bounce.type === 'send_limit') {
    let targets = extractFailureRecipients(body, sentEmails);
    if (!targets.length) {
      targets = await extractFailureRecipientsFromThread(gmail, full.data.threadId, sentEmails).catch(() => []);
    }
    if (targets.length) {
      for (const target of targets) {
        const id = recordDeliveryFailure({
          ...target,
          failure_type: bounce.type,
          reason: bounce.reason,
          source: 'gmail_bounce',
          message_id: full.data.id,
          thread_id: full.data.threadId,
          raw_excerpt: body.slice(0, 1000),
          received_at: receivedAt,
        });
        if (id) eventBus.publish({ type: 'delivery_failure_updated', id, mode: target.mode || 'scheduled' });
      }
    }
    const incident = recordSendIncident({
      type: 'send_limit',
      reason: bounce.reason,
      source: 'gmail_bounce',
      messageId: full.data.id,
    });
    if (incident.added) {
      result.failures += 1;
      const recovery = incident.pausedUntil
        ? rescheduleBatchesAfterGmailReset(incident.pausedUntil, bounce.reason)
        : null;
      eventBus.publish({
        type: 'scheduled_send_limit_reached',
        mode: 'scheduled',
        error: bounce.reason,
        pausedUntil: incident.pausedUntil,
        retryAt: recovery?.retryAt || null,
      });
    }
    return;
  }

  let targets = extractFailureRecipients(body, sentEmails);
  if (!targets.length) {
    targets = await extractFailureRecipientsFromThread(gmail, full.data.threadId, sentEmails).catch(() => []);
  }
  let added = 0;
  for (const target of targets) {
    const email = String(target.professor_email || '').toLowerCase();
    const existed = db.prepare(
      'SELECT id FROM delivery_failures WHERE message_id=? AND professor_email=?'
    ).get(full.data.id, email);
    const id = recordDeliveryFailure({
      ...target,
      professor_email: email,
      failure_type: bounce.type,
      reason: bounce.reason,
      source: 'gmail_bounce',
      message_id: full.data.id,
      thread_id: full.data.threadId,
      raw_excerpt: body.slice(0, 1000),
      received_at: receivedAt,
    });
    if (!existed && id) {
      added += 1;
      eventBus.publish({ type: 'delivery_failure_updated', id, mode: target.mode || 'scheduled' });
    }
  }
  result.failures += added;
}

async function processReplyMessage(gmail, message, sentEmails, scenarios, result) {
  const full = await gmail.users.messages.get({ userId: 'me', id: message.id, format: 'full' });
  const existing = db.prepare('SELECT id, received_at, replied_by_user FROM replies WHERE gmail_message_id=?').get(message.id);
  if (existing) {
    if (!existing.replied_by_user) {
      const incomingAt = Number(full.data.internalDate || new Date(existing.received_at).getTime() || Date.now());
      const replied = await repliedAfterIncoming(gmail, full.data.threadId, incomingAt).catch(() => false);
      if (replied) {
        db.prepare('UPDATE replies SET replied_by_user=1 WHERE id=?').run(existing.id);
        eventBus.publish({ type: 'reply_updated', id: existing.id });
      }
    }
    return;
  }
  const fromHeader = header(full.data.payload, 'From');
  const fromEmail = extractEmailAddress(fromHeader);
  if (!fromEmail || SYSTEM_SENDERS.some(sender => fromHeader.toLowerCase().includes(sender))) return;
  const matched = sentEmails.find(row => String(row.professor_email || '').toLowerCase() === fromEmail);
  if (!matched) return;

  const rawBody = extractBody(full.data.payload);
  const body = cleanReplyBody(rawBody);
  if (!body) return;
  const subject = header(full.data.payload, 'Subject');
  const incomingAt = Number(full.data.internalDate || Date.now());
  const receivedAt = new Date(incomingAt).toISOString();
  const deterministic = deterministicScenario(body, scenarios);
  const fixedClassification = deterministicClassification({ from: fromHeader, subject, body });

  let analysis = {};
  try {
    analysis = await withRetry(() => classifyReply(body, scenarios));
  } catch {
    analysis = {};
  }
  const classification = fixedClassification
    || (['positive', 'negative', 'auto_reply', 'other', 'neutral'].includes(analysis.classification)
      ? analysis.classification
      : 'neutral');
  const aiScenarioId = Number(analysis.scenario_id) || null;
  const aiConfidence = Math.max(0, Math.min(1, Number(analysis.scenario_confidence) || 0));
  const validAiScenario = scenarios.some(item => item.id === aiScenarioId) && aiConfidence >= 0.75;
  const scenarioId = deterministic.scenarioId || (validAiScenario ? aiScenarioId : null);
  const scenarioConfidence = deterministic.confidence || (validAiScenario ? aiConfidence : aiConfidence);
  const repliedByUser = await repliedAfterIncoming(gmail, full.data.threadId, incomingAt).catch(() => false);

  const info = db.prepare(`
    INSERT INTO replies
      (thread_id, professor_email, classification, summary, received_at, mode,
       original_subject, reply_body, gmail_message_id, analyzed_at, scenario_id,
       scenario_confidence, workflow_status, replied_by_user)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, 'new', ?)
  `).run(
    full.data.threadId,
    matched.professor_email,
    classification === 'other' ? 'neutral' : classification,
    analysis.summary || body.slice(0, 240),
    receivedAt,
    matched.mode || 'instant',
    subject,
    body,
    full.data.id,
    scenarioId,
    scenarioConfidence,
    repliedByUser ? 1 : 0,
  );
  result.imported += 1;
  eventBus.publish({
    type: 'reply_updated',
    id: Number(info.lastInsertRowid),
    mode: matched.mode || 'instant',
  });

  if (classification === 'positive') {
    db.prepare(`UPDATE learning_stats SET replies=replies+1, positive_replies=positive_replies+1
      WHERE topic IN (SELECT topic FROM sent_log WHERE professor_email=? AND topic IS NOT NULL)`)
      .run(matched.professor_email);
  }
  const queueItem = db.prepare(`
    SELECT q.id FROM queue q JOIN professors p ON q.professor_id=p.id
    WHERE lower(p.email)=lower(?) AND q.state='sent' ORDER BY q.id DESC LIMIT 1
  `).get(matched.professor_email);
  if (queueItem) db.prepare("UPDATE queue SET state='replied' WHERE id=?").run(queueItem.id);
}

export async function classifyReplies({ maxResults = 500 } = {}) {
  const auth = getAuthedClient();
  if (!auth) return { scanned: 0, imported: 0, failures: 0, windowHours: SCAN_WINDOW_HOURS };
  const gmail = google.gmail({ version: 'v1', auth });
  const result = { scanned: 0, imported: 0, failures: 0, windowHours: SCAN_WINDOW_HOURS };
  const after = Math.floor((Date.now() - SCAN_WINDOW_HOURS * 60 * 60 * 1000) / 1000);
  const sentEmails = db.prepare(`
    SELECT professor_email, message_id, 'instant' as mode, NULL as batch_id, NULL as draft_id, NULL as queue_id FROM sent_log
    UNION ALL
    SELECT professor_email, message_id, mode, batch_id, draft_id, queue_id FROM sent_email_history
  `).all();
  if (!sentEmails.length) return result;

  const scenarios = db.prepare(
    'SELECT id, name, description FROM reply_scenarios WHERE active=1 ORDER BY sort_order, id'
  ).all();
  const failureQuery = `after:${after} (from:mailer-daemon OR from:postmaster OR "Delivery has failed" OR "message was not delivered" OR "couldn't be found" OR "sending mail")`;
  const replyQuery = `after:${after} -from:mailer-daemon -from:postmaster`;
  const [failureMessages, replyMessages] = await Promise.all([
    listMessages(gmail, failureQuery, maxResults),
    listMessages(gmail, replyQuery, maxResults),
  ]);
  result.scanned = new Set([...failureMessages, ...replyMessages].map(item => item.id)).size;
  const failureMessageIds = new Map();

  for (const message of failureMessages) {
    // eslint-disable-next-line no-await-in-loop
    await processFailureMessage(gmail, message, sentEmails, result, failureMessageIds);
  }
  for (const message of replyMessages) {
    // eslint-disable-next-line no-await-in-loop
    await processReplyMessage(gmail, message, sentEmails, scenarios, result);
  }
  await labelDeliveryFailureMessages(gmail, failureMessageIds).catch(() => {});
  return result;
}
