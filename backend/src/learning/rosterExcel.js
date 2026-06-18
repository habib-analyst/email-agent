import XLSX from 'xlsx';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { buildRosterRows } from './roster.js';
import { eventBus } from '../core/EventBus.js';
import { getActiveWorkspace } from '../db/index.js';

function rosterPath() {
  return resolve(dirname(getActiveWorkspace().path), 'exports', 'professor-roster.xlsx');
}

const HEADERS = [
  'full_name', 'last_name', 'email', 'university', 'department', 'designation',
  'faculty_rank', 'is_professor_rank',
  'research_interest', 'subject_keyword', 'interest_line', 'profile_url',
  'email_verified', 'queue_state', 'research_status', 'research_attempts',
  'fallback_mode', 'error_reason', 'last_updated',
  'research_duration_ms', 'draft_duration_ms', 'total_duration_ms'
];

const DATA_FIELDS = [
  'full_name', 'last_name', 'university', 'department', 'designation',
  'faculty_rank', 'research_interest', 'subject_keyword', 'interest_line', 'profile_url',
];

export function isSparseRosterRow(row) {
  if (!row?.email) return true;
  return !DATA_FIELDS.some(f => String(row[f] || '').trim());
}

export function hasSubstantiveRosterData(row) {
  return !!row?.email && !isSparseRosterRow(row);
}

function pickFilledFields(incoming, fields = DATA_FIELDS) {
  const out = {};
  for (const f of fields) {
    const v = incoming?.[f];
    if (v != null && String(v).trim() !== '') out[f] = v;
  }
  return out;
}

export function mergeRosterRow(existing, incoming) {
  if (!existing?.email) return { ...incoming, email: incoming.email };
  if (hasSubstantiveRosterData(existing)) {
    const gaps = DATA_FIELDS.filter(f => !String(existing[f] || '').trim());
    return {
      ...existing,
      ...pickFilledFields(incoming, gaps),
      email: existing.email,
      last_updated: incoming.last_updated || existing.last_updated || new Date().toISOString(),
    };
  }
  return {
    ...existing,
    ...pickFilledFields(incoming),
    email: incoming.email || existing.email,
    last_updated: incoming.last_updated || existing.last_updated || new Date().toISOString(),
  };
}

function ensureDir() {
  const exportsDir = dirname(rosterPath());
  if (!existsSync(exportsDir)) mkdirSync(exportsDir, { recursive: true });
}

export function getRosterExcelPath() {
  return rosterPath();
}

export function clearRosterExcel() {
  writeRosterExcel([]);
}

export function writeRosterExcel(rows) {
  ensureDir();
  const data = (rows || []).map(r => {
    const out = {};
    for (const h of HEADERS) out[h] = r[h] ?? '';
    return out;
  });
  const ws = XLSX.utils.json_to_sheet(data, { header: HEADERS });
  ws['!cols'] = HEADERS.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Professors');
  XLSX.writeFile(wb, rosterPath());
  return rosterPath();
}

export function readRosterExcel() {
  const path = rosterPath();
  if (!existsSync(path)) return [];
  try {
    const wb = XLSX.readFile(path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet);
  } catch {
    return [];
  }
}

export function upsertRosterRow(row, { force = false } = {}) {
  if (!row?.email) return readRosterExcel();
  const rows = readRosterExcel();
  const email = row.email.toLowerCase();
  const idx = rows.findIndex(r => (r.email || '').toLowerCase() === email);
  const existing = idx >= 0 ? rows[idx] : null;
  if (!force && existing && hasSubstantiveRosterData(existing) && isSparseRosterRow(row)) {
    return rows;
  }
  const merged = mergeRosterRow(existing || {}, { ...row, email });
  if (idx >= 0) rows[idx] = merged;
  else rows.push(merged);
  writeRosterExcel(rows);
  eventBus.publish({
    type: 'roster_update',
    email: merged.email,
    row: merged,
    queue_state: merged.queue_state,
  });
  return rows;
}

export function syncRosterFromDb(mode = 'instant') {
  const modes = mode === 'all' ? ['instant', 'basic_instant'] : [mode];
  const dbRows = modes.flatMap(m => buildRosterRows(m).map(r => ({
    ...r,
    interest_line: r.designation_line || r.interest_line || '',
    research_status: r.profile_research_status || r.research_status || '',
  })));
  const existing = readRosterExcel();
  const byEmail = new Map(existing.map(r => [(r.email || '').toLowerCase(), r]));
  for (const dbRow of dbRows) {
    const email = (dbRow.email || '').toLowerCase();
    if (!email) continue;
    byEmail.set(email, mergeRosterRow(byEmail.get(email), dbRow));
  }
  const merged = [...byEmail.values()];
  writeRosterExcel(merged);
  return merged;
}

/** Write organized import rows into the live roster Excel before queue processing. */
export function writeRosterExcelFromImport(entries) {
  const rows = (entries || []).map(e => ({
    full_name: e.full_name || '',
    last_name: e.last_name || '',
    email: e.email,
    university: e.university || '',
    department: e.department || '',
    designation: '',
    faculty_rank: '',
    is_professor_rank: '',
    research_interest: e.research_interest || '',
    subject_keyword: e.subject_keyword || '',
    interest_line: e.interest_line || '',
    profile_url: e.profile_url || '',
    email_verified: '',
    queue_state: 'pending',
    research_status: 'imported',
    research_attempts: '',
    fallback_mode: '',
    error_reason: '',
    last_updated: new Date().toISOString(),
    research_duration_ms: '',
    draft_duration_ms: '',
    total_duration_ms: '',
  }));
  writeRosterExcel(rows);
  return rows;
}

export function rosterToXlsxBuffer(rows) {
  const data = (rows || buildRosterRows()).map(r => {
    const out = {};
    for (const h of HEADERS) {
      out[h] = r[h] ?? r[h === 'interest_line' ? 'designation_line' : h] ?? '';
    }
    return out;
  });
  const ws = XLSX.utils.json_to_sheet(data, { header: HEADERS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Professors');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export function readRosterExcelBuffer() {
  const path = rosterPath();
  if (!existsSync(path)) {
    syncRosterFromDb();
  }
  return readFileSync(path);
}
