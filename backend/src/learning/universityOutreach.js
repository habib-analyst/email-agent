import db from '../db/index.js';
import { universityFromEmail } from '../utils/professor.js';
import { buildSuggestions } from './targetUniversities.js';
import { loadUserMajorsFromFile } from './userMajorsFile.js';
import { getUsaTargetUniversities } from './usaCatalog.js';

const DEFAULT_MAJORS = [
  'AI/ML',
  'medical imaging',
  'multimodal learning',
  'deepfake detection',
  'photovoltaic forecasting',
  'predictive analytics',
];

const SENT_QUEUE = new Set(['sent']);
const ACTIVE_QUEUE = new Set(['researching', 'drafted', 'verified', 'sending']);
const PENDING_QUEUE = new Set(['pending', 'awaiting_proceed', 'duplicate_review', 'failed', 'skipped']);

const CHINA_DOMAIN = /\.(edu|ac)\.cn$/i;
const CHINA_NAME_HINTS = [
  'tsinghua', 'peking', 'fudan', 'zhejiang', 'nju', 'ustc', 'shanghai', 'beihang',
  'harbin', 'wuhan', 'xjtu', 'sichuan', 'nankai', 'tongji', 'hunan', 'nanjing',
  'beijing', 'chinese academy', 'cuhk', 'hkust', 'hku',
];

export function inferOutreachRegion(email, university) {
  const domain = (email || '').split('@')[1]?.toLowerCase() || '';
  const u = (university || '').toLowerCase();

  if (domain.endsWith('.cn') || CHINA_DOMAIN.test(domain)) return 'china';
  if (CHINA_NAME_HINTS.some(h => u.includes(h) || domain.includes(h.replace(/\s/g, '')))) return 'china';

  if (domain.endsWith('.edu')) return 'usa';
  if (/\.(mit|stanford|berkeley|ucla|cornell|columbia|gatech|umich|harvard|yale|princeton)\./i.test(domain)) return 'usa';
  if (u.includes('university') || u.includes('institute of technology') || u.includes('college')) {
    if (!u.includes('china') && !u.includes('chinese')) return 'usa';
  }
  return 'other';
}

function normalizeUniversity(name, email) {
  const raw = (name || '').trim() || universityFromEmail(email);
  return raw || 'Unknown';
}

export function extractUserMajorsFromTemplate() {
  const tpl = db.prepare("SELECT raw_html FROM template WHERE mode='instant'").get();
  const html = tpl?.raw_html || '';
  if (!html) return [];
  const m = html.match(/research background is in ([^.<\n]+)/i);
  if (m) {
    const parts = m[1].split(/,| and /i).map(s => s.trim()).filter(Boolean);
    if (parts.length) return parts;
  }
  const fromFile = loadUserMajorsFromFile();
  if (fromFile.length) return fromFile;
  return [...DEFAULT_MAJORS];
}

function majorKeywords(majors) {
  const kw = new Set();
  for (const m of majors) {
    kw.add(m.toLowerCase());
    for (const p of m.split(/[/\s]+/)) {
      if (p.length > 2) kw.add(p.toLowerCase());
    }
  }
  return kw;
}

function relevanceScore(researchAreas, keywords) {
  const text = (researchAreas || '').toLowerCase();
  let score = 0;
  for (const k of keywords) {
    if (text.includes(k)) score++;
  }
  return score;
}

function classifyState(queueState, draftStatus, inSentLog) {
  if (inSentLog || SENT_QUEUE.has(queueState) || draftStatus === 'sent') return 'sent';
  if (ACTIVE_QUEUE.has(queueState)) return 'active';
  if (PENDING_QUEUE.has(queueState) || draftStatus === 'draft' || draftStatus === 'approved') return 'pending';
  if (draftStatus === 'failed') return 'pending';
  return 'pending';
}

function emptyRegion() {
  return {
    universities: [],
    completed: [],
    pending: [],
    inProgress: [],
    suggested: [],
    states: [],
    totals: { professorsSent: 0, professorsPending: 0, professorsActive: 0, professorsFailed: 0, universitiesCompleted: 0, universitiesPending: 0 },
  };
}

function usaCatalogByName() {
  return new Map(getUsaTargetUniversities().map(u => [u.name.toLowerCase(), u]));
}

function buildUsaStateSummary(suggested, universities) {
  const map = new Map();
  const touch = (state) => {
    const key = state || 'Unknown';
    if (!map.has(key)) {
      map.set(key, { state: key, suggested: 0, sent: 0, pending: 0, active: 0, lastAt: null, top: [] });
    }
    return map.get(key);
  };

  for (const s of suggested || []) {
    const row = touch(s.state);
    row.suggested++;
    if (row.top.length < 5) row.top.push({ university: s.university, rank: s.rank, relevance: s.relevance });
  }
  for (const u of universities || []) {
    const row = touch(u.state);
    row.sent += u.sent || 0;
    row.pending += u.pending || 0;
    row.active += u.active || 0;
    const latest = [u.lastSentAt, u.lastPendingAt, u.lastActiveAt].filter(Boolean).sort().at(-1) || null;
    if (latest && (!row.lastAt || latest > row.lastAt)) row.lastAt = latest;
  }
  return [...map.values()].sort((a, b) => b.sent - a.sent || b.suggested - a.suggested || a.state.localeCompare(b.state));
}

let outreachCache = null;
let outreachCacheAt = 0;
const OUTREACH_CACHE_MS = 5_000;

export function invalidateUniversityOutreachCache() {
  outreachCache = null;
  outreachCacheAt = 0;
}

export function getUniversityOutreach() {
  if (outreachCache && Date.now() - outreachCacheAt < OUTREACH_CACHE_MS) {
    return outreachCache;
  }
  const userMajors = extractUserMajorsFromTemplate();
  const keywords = majorKeywords(userMajors);

  const sentEmails = new Set();
  for (const r of db.prepare('SELECT professor_email FROM sent_email_history').all()) {
    if (r.professor_email) sentEmails.add(r.professor_email.toLowerCase());
  }

  const sentHistoryRows = db.prepare(`
    SELECT professor_email as email, university, subject, mode, sent_at
    FROM sent_email_history
    WHERE professor_email IS NOT NULL AND TRIM(professor_email) != ''
  `).all();

  const failureRows = db.prepare(`
    SELECT df.professor_email as email,
      COALESCE(sp.university, p.university, seh.university) as university,
      df.failure_type,
      df.received_at
    FROM delivery_failures df
    LEFT JOIN scheduled_professors sp ON lower(sp.email)=lower(df.professor_email)
    LEFT JOIN professors p ON lower(p.email)=lower(df.professor_email)
    LEFT JOIN sent_email_history seh ON lower(seh.professor_email)=lower(df.professor_email)
    WHERE df.professor_email IS NOT NULL AND TRIM(df.professor_email) != ''
  `).all();

  const instantRows = db.prepare(`
    SELECT p.email, p.university, p.research_areas, q.state as queue_state
    FROM professors p
    LEFT JOIN queue q ON q.professor_id = p.id AND q.mode = p.mode
    WHERE p.mode IN ('instant', 'basic_instant')
  `).all();

  const scheduledRows = db.prepare(`
    SELECT sp.email, sp.university, sp.research_areas, d.status as draft_status
    FROM scheduled_professors sp
    LEFT JOIN scheduled_drafts d ON d.professor_id = sp.id AND d.batch_id = sp.batch_id
  `).all();

  const uniMap = new Map();
  const countedEmails = new Set();

  const ingest = (email, university, researchAreas, queueState, draftStatus) => {
    const emailKey = (email || '').toLowerCase().trim();
    if (emailKey && countedEmails.has(emailKey)) return;
    const region = inferOutreachRegion(email, university);
    if (region !== 'usa' && region !== 'china') return;

    const uni = normalizeUniversity(university, email);
    const key = `${region}|${uni}`;
    if (!uniMap.has(key)) {
      uniMap.set(key, {
        university: uni,
        region,
        sent: 0,
        pending: 0,
        active: 0,
        failed: 0,
        notFound: 0,
        total: 0,
        relevance: 0,
        lastSentAt: null,
        lastPendingAt: null,
        lastActiveAt: null,
        lastFailedAt: null,
      });
    }
    const rec = uniMap.get(key);
    rec.total++;
    const inSent = sentEmails.has((email || '').toLowerCase());
    const status = classifyState(queueState, draftStatus, inSent);
    if (status === 'sent') rec.sent++;
    else if (status === 'active') rec.active++;
    else rec.pending++;
    if (emailKey) countedEmails.add(emailKey);

    rec.relevance = Math.max(rec.relevance, relevanceScore(researchAreas, keywords));
  };

  for (const r of sentHistoryRows) {
    ingest(r.email, r.university, '', 'sent', null);
    const key = `${inferOutreachRegion(r.email, r.university)}|${normalizeUniversity(r.university, r.email)}`;
    const rec = uniMap.get(key);
    if (rec) rec.lastSentAt = rec.lastSentAt && rec.lastSentAt > r.sent_at ? rec.lastSentAt : r.sent_at;
  }
  for (const r of instantRows) {
    ingest(r.email, r.university, r.research_areas, r.queue_state, null);
    const key = `${inferOutreachRegion(r.email, r.university)}|${normalizeUniversity(r.university, r.email)}`;
    const rec = uniMap.get(key);
    if (rec) {
      if (r.queue_state === 'sending' || r.queue_state === 'verified' || r.queue_state === 'drafted' || r.queue_state === 'researching') rec.lastActiveAt = new Date().toISOString();
      else if (r.queue_state === 'pending' || r.queue_state === 'awaiting_proceed' || r.queue_state === 'duplicate_review') rec.lastPendingAt = new Date().toISOString();
    }
  }
  for (const r of scheduledRows) {
    ingest(r.email, r.university, r.research_areas, null, r.draft_status);
    const key = `${inferOutreachRegion(r.email, r.university)}|${normalizeUniversity(r.university, r.email)}`;
    const rec = uniMap.get(key);
    if (rec) {
      if (r.draft_status === 'sent') rec.lastSentAt = new Date().toISOString();
      else rec.lastPendingAt = new Date().toISOString();
    }
  }

  for (const r of failureRows) {
    const region = inferOutreachRegion(r.email, r.university);
    if (region !== 'usa' && region !== 'china') continue;
    const uni = normalizeUniversity(r.university, r.email);
    const key = `${region}|${uni}`;
    if (!uniMap.has(key)) {
      uniMap.set(key, {
        university: uni,
        region,
        sent: 0,
        pending: 0,
        active: 0,
        failed: 0,
        notFound: 0,
        total: 0,
        relevance: 0,
        lastSentAt: null,
        lastPendingAt: null,
        lastActiveAt: null,
        lastFailedAt: null,
      });
    }
    const rec = uniMap.get(key);
    rec.failed++;
    if (r.failure_type === 'not_found') rec.notFound++;
    if (r.received_at && (!rec.lastFailedAt || r.received_at > rec.lastFailedAt)) rec.lastFailedAt = r.received_at;
  }

  const regions = { usa: emptyRegion(), china: emptyRegion() };
  const usaByName = usaCatalogByName();

  for (const rec of uniMap.values()) {
    const bucket = regions[rec.region];
    const catalogEntry = rec.region === 'usa' ? usaByName.get(rec.university.toLowerCase()) : null;
    const isComplete = rec.sent > 0 && rec.pending === 0 && rec.active === 0;
    const hasPending = rec.pending > 0 || rec.active > 0;
    const entry = {
      university: rec.university,
      state: catalogEntry?.state,
      rank: catalogEntry?.rank,
      popularity: catalogEntry?.popularity,
      sent: rec.sent,
      pending: rec.pending,
      active: rec.active,
      failed: rec.failed || 0,
      notFound: rec.notFound || 0,
      total: rec.total,
      relevance: rec.relevance,
      lastSentAt: rec.lastSentAt,
      lastPendingAt: rec.lastPendingAt,
      lastActiveAt: rec.lastActiveAt,
      lastFailedAt: rec.lastFailedAt,
      status: isComplete ? 'complete' : rec.sent > 0 ? 'partial' : hasPending ? 'pending' : 'unknown',
    };

    bucket.universities.push(entry);
    bucket.totals.professorsSent += rec.sent;
    bucket.totals.professorsPending += rec.pending;
    bucket.totals.professorsActive += rec.active;
    bucket.totals.professorsFailed += rec.failed || 0;

    if (isComplete) {
      bucket.completed.push(entry);
      bucket.totals.universitiesCompleted++;
    }
    if (hasPending) {
      bucket.pending.push(entry);
      bucket.totals.universitiesPending++;
    }
    if (rec.active > 0) bucket.inProgress.push(entry);
  }

  const sortUnis = (list) =>
    [...list].sort((a, b) => b.relevance - a.relevance || b.sent - a.sent || a.university.localeCompare(b.university));

  for (const key of ['usa', 'china']) {
    regions[key].universities = sortUnis(regions[key].universities);
    regions[key].completed = sortUnis(regions[key].completed);
    regions[key].pending = sortUnis(regions[key].pending);
    regions[key].inProgress = sortUnis(regions[key].inProgress);

    const rosterNames = regions[key].universities.map(u => u.university);
    const { items, totalMatching } = buildSuggestions(key, rosterNames, userMajors, { limit: key === 'usa' ? 1000 : 60 });
    regions[key].suggested = items;
    regions[key].suggestedTotal = totalMatching;
  }

  regions.usa.catalogTotal = getUsaTargetUniversities().length;
  regions.usa.states = buildUsaStateSummary(regions.usa.suggested, regions.usa.universities);

  const result = { userMajors, regions };
  outreachCache = result;
  outreachCacheAt = Date.now();
  return result;
}
