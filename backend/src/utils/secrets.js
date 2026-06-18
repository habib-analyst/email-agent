import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const KEY_PATH = resolve(import.meta.dirname, '../../.token-key');
const ALGO = 'aes-256-gcm';

function getKey() {
  const envKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (envKey && envKey.length >= 16) {
    return scryptSync(envKey, 'email-agent-salt', 32);
  }
  if (!existsSync(KEY_PATH)) {
    writeFileSync(KEY_PATH, randomBytes(32).toString('hex'));
  }
  return scryptSync(readFileSync(KEY_PATH, 'utf8'), 'email-agent-salt', 32);
}

export function encryptJson(data) {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptJson(payload) {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}
