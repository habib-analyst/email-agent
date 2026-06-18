import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const MAJORS_FILE = resolve(__dir, '../../../User_Majors_for_Email_Subject.txt');

let cached = null;

/** Load majors / research areas from User_Majors_for_Email_Subject.txt (one per line). */
export function loadUserMajorsFromFile() {
  if (cached) return cached;
  if (!existsSync(MAJORS_FILE)) {
    cached = [];
    return cached;
  }
  const raw = readFileSync(MAJORS_FILE, 'utf8');
  cached = raw
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
  return cached;
}

export function getUserMajorsFilePath() {
  return MAJORS_FILE;
}
