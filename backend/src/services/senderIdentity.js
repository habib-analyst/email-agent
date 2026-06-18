import db, { getActiveWorkspace } from '../db/index.js';
import { basename, extname, resolve } from 'path';
import { existsSync, statSync } from 'fs';
import { config } from '../config/index.js';
import { userApiKeysForClient } from './userApiKeys.js';

function attachmentMetadata(path) {
  if (!path || !existsSync(path)) return null;
  const stat = statSync(path);
  return {
    type: extname(path).toLowerCase() === '.pdf' ? 'PDF' : 'Image',
    size: stat.size,
    source: path.startsWith(resolve(getActiveWorkspace().path, '..', 'uploads')) ? 'user_upload' : 'admin_default',
  };
}

export function deriveNameFromEmail(email) {
  if (!email) return '';
  const local = String(email).split('@')[0] || '';
  return local
    .replace(/[._-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ') || local;
}

/** True when name was auto-guessed from email local-part (e.g. habib.gcuf.edu → Habib Gcuf Edu). */
export function looksLikeDerivedName(name, email) {
  if (!name || !email) return false;
  return name.trim().toLowerCase() === deriveNameFromEmail(email).trim().toLowerCase();
}

export function pickSenderDisplayName(apiName, email, existingName) {
  const fromApi = (apiName || '').trim();
  if (fromApi) return fromApi;
  const existing = (existingName || '').trim();
  if (existing && !looksLikeDerivedName(existing, email)) return existing;
  return deriveNameFromEmail(email);
}

export function getSenderIdentity() {
  const row = db.prepare('SELECT sender_email, sender_name FROM settings WHERE id=1').get();
  return {
    email: row?.sender_email || null,
    name: row?.sender_name || null,
  };
}

export function setConnectedSender(email, name) {
  if (!email) return getSenderIdentity();
  const displayName = (name || '').trim() || deriveNameFromEmail(email);
  db.prepare('UPDATE settings SET sender_email=?, sender_name=? WHERE id=1').run(email, displayName);
  return { email, name: displayName };
}

export function clearConnectedSender() {
  db.prepare('UPDATE settings SET sender_email=NULL, sender_name=NULL WHERE id=1').run();
}

export function settingsForClient(settingsRow) {
  const sender = getSenderIdentity();
  const base = settingsRow || {};
  const { user_api_keys: storedKeys, resume_path: privateAttachmentPath, ...rest } = base;
  return {
    ...rest,
    sender_email: sender.email,
    sender_name: sender.name,
    resume_name: base.resume_path ? basename(base.resume_path) : null,
    attachment: attachmentMetadata(base.resume_path),
    dry_run_send: config.dryRunSend ? 1 : 0,
    user_api_keys: userApiKeysForClient(storedKeys),
  };
}

export function requireSenderIdentity() {
  const sender = getSenderIdentity();
  if (!sender.email) {
    throw new Error('Gmail sender not set — connect Gmail so the app uses your account');
  }
  return sender;
}
