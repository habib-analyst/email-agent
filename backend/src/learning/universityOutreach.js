import db, { currentTenantKey } from '../db/index.js';
import { universityFromEmail } from '../utils/professor.js';
import { buildSuggestions } from './targetUniversities.js';
import { loadUserMajorsFromFile } from './userMajorsFile.js';
import { getUsaTargetUniversities } from './usaCatalog.js';
import {
  resolveUsaUniversityDetailsFromEmail,
  resolveUsaUniversityFromEmail,
} from './usaUniversityResolver.js';
import { getCachedUniversityLocation, resolveKnownUniversityLocation } from './universityLocationResolver.js';
import { getChinaProvince } from './chinaTargetUniversities.js';
import {
  getGlobalUniversityCatalog,
  getRankedUniversities,
  matchRankedUniversity,
  normalizeUniversityName,
} from './globalUniversityCatalog.js';

const DEFAULT_MAJORS = [
  'AI/ML',
  'medical imaging',
  'multimodal learning',
  'deepfake detection',
  'photovoltaic forecasting',
  'predictive analytics',
];

const ACTIVE_QUEUE = new Set(['researching', 'drafted', 'verified', 'sending']);
const PENDING_QUEUE = new Set(['pending', 'awaiting_proceed', 'failed']);
const TERMINAL_QUEUE = new Set(['skipped', 'duplicate_review', 'replied', 'sent']);
const COUNTRY_IDS = [
  'usa', 'canada', 'uk', 'germany', 'france', 'netherlands', 'switzerland',
  'sweden', 'italy', 'spain', 'austria', 'ireland', 'finland', 'china',
  'japan', 'south-korea', 'singapore', 'malaysia', 'hong-kong', 'taiwan',
  'australia', 'new-zealand',
];

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
  const rules = [
    ['canada', /\.ca$/], ['uk', /\.ac\.uk$/], ['germany', /\.de$/],
    ['france', /\.fr$/], ['netherlands', /\.nl$/], ['switzerland', /\.ch$/],
    ['sweden', /\.se$/], ['italy', /\.it$/], ['spain', /\.es$/],
    ['austria', /\.at$/], ['ireland', /\.ie$/], ['finland', /\.fi$/],
    ['japan', /\.ac\.jp$/], ['south-korea', /\.ac\.kr$/], ['singapore', /\.sg$/],
    ['malaysia', /\.edu\.my$/], ['hong-kong', /\.edu\.hk$/], ['taiwan', /\.edu\.tw$/],
    ['australia', /\.edu\.au$/], ['new-zealand', /\.ac\.nz$/],
  ];
  const domainCountry = rules.find(([, pattern]) => pattern.test(domain))?.[0];
  if (domainCountry) return domainCountry;
  const ranked = matchRankedUniversity(university);
  if (ranked) return ranked.countryId;
  if (/\.(mit|stanford|berkeley|ucla|cornell|columbia|gatech|umich|harvard|yale|princeton)\./i.test(domain)) return 'usa';
  if (u.includes('university') || u.includes('institute of technology') || u.includes('college')) {
    if (!u.includes('china') && !u.includes('chinese')) return 'usa';
  }
  return 'other';
}

function normalizeUniversity(name, email) {
  const domainMatch = resolveUsaUniversityFromEmail(email);
  if (domainMatch) return domainMatch;
  const raw = (name || '').trim() || universityFromEmail(email);
  const normalized = raw.toLowerCase();
  const catalogMatches = getUsaTargetUniversities().filter(entry =>
    entry.name.toLowerCase() === normalized
    || entry.hints?.some(hint => hint.toLowerCase() === normalized)
  );
  if (catalogMatches.length === 1) return catalogMatches[0].name;
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
  if (inSentLog) return 'sent';
  if (TERMINAL_QUEUE.has(queueState)) return 'ignored';
  if (queueState === 'sending' || draftStatus === 'sending') return 'sending';
  if (ACTIVE_QUEUE.has(queueState) || draftStatus === 'draft') return 'drafting';
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
    totals: {
      professorsSent: 0, contactsSent: 0, professorsPending: 0, professorsActive: 0,
      professorsScheduled: 0, professorsRescheduled: 0, professorsSending: 0,
      professorsFailed: 0, universitiesCompleted: 0, universitiesPending: 0,
    },
  };
}

function usaCatalogByName() {
  return new Map(getUsaTargetUniversities().map(u => [u.name.toLowerCase(), u]));
}

function buildSubdivisionSummary(suggested, universities) {
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

const outreachCaches = new Map();
const OUTREACH_CACHE_MS = 5_000;

export function invalidateUniversityOutreachCache() {
  outreachCaches.delete(currentTenantKey() || 'anonymous');
}

export function getUniversityOutreach() {
  const tenant = currentTenantKey() || 'anonymous';
  const cached = outreachCaches.get(tenant);
  if (cached && Date.now() - cached.at < OUTREACH_CACHE_MS) {
    return cached.value;
  }
  const userMajors = extractUserMajorsFromTemplate();
  const keywords = majorKeywords(userMajors);

  const sentEmails = new Set();
  for (const r of db.prepare('SELECT professor_email FROM sent_email_history').all()) {
    if (r.professor_email) sentEmails.add(r.professor_email.toLowerCase());
  }

  const sentHistoryRows = db.prepare(`
    SELECT id, professor_email as email, university, subject, mode, sent_at
    FROM sent_email_history
    WHERE professor_email IS NOT NULL AND TRIM(professor_email) != ''
  `).all();
  const updateSentUniversity = db.prepare('UPDATE sent_email_history SET university=? WHERE id=?');
  const reconcileSentUniversities = db.transaction((rows) => {
    for (const row of rows) {
      const resolved = resolveUsaUniversityFromEmail(row.email);
      if (!resolved || resolved === row.university) continue;
      updateSentUniversity.run(resolved, row.id);
      row.university = resolved;
    }
  });
  reconcileSentUniversities(sentHistoryRows);
  const sentByEmail = new Map();
  for (const row of sentHistoryRows) {
    const emailKey = String(row.email || '').toLowerCase().trim();
    if (!emailKey) continue;
    const existing = sentByEmail.get(emailKey) || {
      email: emailKey,
      university: null,
      count: 0,
      lastSentAt: null,
    };
    existing.count += 1;
    if (row.university) existing.university = row.university;
    if (row.sent_at && (!existing.lastSentAt || row.sent_at > existing.lastSentAt)) {
      existing.lastSentAt = row.sent_at;
    }
    sentByEmail.set(emailKey, existing);
  }

  const failureRows = db.prepare(`
    SELECT df.professor_email as email,
      COALESCE(
        (SELECT sp.university FROM scheduled_professors sp
          WHERE lower(sp.email)=lower(df.professor_email) AND sp.university IS NOT NULL AND sp.university!=''
          ORDER BY sp.id DESC LIMIT 1),
        (SELECT p.university FROM professors p
          WHERE lower(p.email)=lower(df.professor_email) AND p.university IS NOT NULL AND p.university!=''
          ORDER BY p.id DESC LIMIT 1),
        (SELECT seh.university FROM sent_email_history seh
          WHERE lower(seh.professor_email)=lower(df.professor_email) AND seh.university IS NOT NULL AND seh.university!=''
          ORDER BY seh.sent_at DESC, seh.id DESC LIMIT 1)
      ) as university,
      df.failure_type,
      df.received_at
    FROM delivery_failures df
    WHERE df.professor_email IS NOT NULL AND TRIM(df.professor_email) != ''
  `).all();

  const instantRows = db.prepare(`
    SELECT p.email, p.university, p.research_areas, q.state as queue_state
    FROM professors p
    LEFT JOIN queue q ON q.professor_id = p.id AND q.mode = p.mode
    WHERE p.mode IN ('instant', 'basic_instant')
  `).all();

  const scheduledRows = db.prepare(`
    SELECT sp.email, sp.university, sp.research_areas, d.status as draft_status,
      b.status as batch_status, b.scheduled_at, b.gmail_retry_at
    FROM scheduled_professors sp
    LEFT JOIN scheduled_drafts d ON d.professor_id = sp.id AND d.batch_id = sp.batch_id
    LEFT JOIN scheduled_batches b ON b.id=sp.batch_id
  `).all();

  const uniMap = new Map();
  const countedEmails = new Set();

  const ingest = (email, university, researchAreas, queueState, draftStatus, batchStatus, gmailRetryAt) => {
    const emailKey = (email || '').toLowerCase().trim();
    if (emailKey && countedEmails.has(emailKey)) return;
    const location = getCachedUniversityLocation(university) || resolveKnownUniversityLocation(university, email);
    const region = location?.country_id || inferOutreachRegion(email, university);
    if (!COUNTRY_IDS.includes(region)) return;

    const uni = normalizeUniversity(university, email);
    const usaDomainMatch = region === 'usa' ? resolveUsaUniversityDetailsFromEmail(email) : null;
    const key = `${region}|${uni}`;
    if (!uniMap.has(key)) {
      uniMap.set(key, {
        university: uni,
        region,
        state: location?.subdivision || usaDomainMatch?.state || null,
        sent: 0,
        contactsSent: 0,
        pending: 0,
        active: 0,
        scheduled: 0,
        rescheduled: 0,
        sending: 0,
        drafting: 0,
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
    if (!rec.state && (location?.subdivision || usaDomainMatch?.state)) {
      rec.state = location?.subdivision || usaDomainMatch.state;
    }
    rec.total++;
    const inSent = sentEmails.has((email || '').toLowerCase());
    let status = classifyState(queueState, draftStatus, inSent);
    if (!inSent && batchStatus === 'scheduled') status = gmailRetryAt ? 'rescheduled' : 'scheduled';
    else if (!inSent && batchStatus === 'sending') status = 'sending';
    else if (!inSent && batchStatus === 'processing') status = 'drafting';
    if (status === 'sent') rec.sent++;
    else if (status === 'sending') { rec.sending++; rec.active++; }
    else if (status === 'drafting') { rec.drafting++; rec.active++; }
    else if (status === 'scheduled') rec.scheduled++;
    else if (status === 'rescheduled') rec.rescheduled++;
    else if (status === 'pending') rec.pending++;
    if (emailKey) countedEmails.add(emailKey);

    rec.relevance = Math.max(rec.relevance, relevanceScore(researchAreas, keywords));
  };

  for (const r of sentByEmail.values()) {
    ingest(r.email, r.university, '', 'sent', null);
    const key = `${inferOutreachRegion(r.email, r.university)}|${normalizeUniversity(r.university, r.email)}`;
    const rec = uniMap.get(key);
    if (rec) {
      rec.sent += Math.max(0, r.count - 1);
      rec.contactsSent += 1;
      rec.lastSentAt = r.lastSentAt;
    }
  }
  for (const r of instantRows) {
    ingest(r.email, r.university, r.research_areas, r.queue_state, null);
    if (sentEmails.has(String(r.email || '').toLowerCase())) continue;
    const key = `${inferOutreachRegion(r.email, r.university)}|${normalizeUniversity(r.university, r.email)}`;
    const rec = uniMap.get(key);
    if (rec) {
      if (r.queue_state === 'sending' || r.queue_state === 'verified' || r.queue_state === 'drafted' || r.queue_state === 'researching') rec.lastActiveAt = new Date().toISOString();
      else if (r.queue_state === 'pending' || r.queue_state === 'awaiting_proceed' || r.queue_state === 'duplicate_review') rec.lastPendingAt = new Date().toISOString();
    }
  }
  for (const r of scheduledRows) {
    ingest(r.email, r.university, r.research_areas, null, r.draft_status, r.batch_status, r.gmail_retry_at);
    if (sentEmails.has(String(r.email || '').toLowerCase())) continue;
    const key = `${inferOutreachRegion(r.email, r.university)}|${normalizeUniversity(r.university, r.email)}`;
    const rec = uniMap.get(key);
    if (rec) {
      if (r.batch_status === 'sending') rec.lastActiveAt = new Date().toISOString();
      else if (!['completed', 'cancelled'].includes(r.batch_status)) rec.lastPendingAt = r.gmail_retry_at || r.scheduled_at || new Date().toISOString();
    }
  }

  for (const r of failureRows) {
    const location = getCachedUniversityLocation(r.university) || resolveKnownUniversityLocation(r.university, r.email);
    const region = location?.country_id || inferOutreachRegion(r.email, r.university);
    if (!COUNTRY_IDS.includes(region)) continue;
    const uni = normalizeUniversity(r.university, r.email);
    const key = `${region}|${uni}`;
    if (!uniMap.has(key)) {
      uniMap.set(key, {
        university: uni,
        region,
        state: location?.subdivision || resolveUsaUniversityDetailsFromEmail(r.email)?.state || null,
        sent: 0,
        contactsSent: 0,
        pending: 0,
        active: 0,
        scheduled: 0,
        rescheduled: 0,
        sending: 0,
        drafting: 0,
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

  const regions = Object.fromEntries(COUNTRY_IDS.map(id => [id, emptyRegion()]));
  const usaByName = usaCatalogByName();
  const globalCatalog = getGlobalUniversityCatalog();

  for (const rec of uniMap.values()) {
    const bucket = regions[rec.region];
    const rankedEntry = matchRankedUniversity(rec.university, rec.region);
    const usaCatalogEntry = rec.region === 'usa' ? usaByName.get(rec.university.toLowerCase()) : null;
    const chinaProvince = rec.region === 'china'
      ? getChinaProvince(rankedEntry?.name || rec.university)
      : null;
    const outstanding = rec.pending + rec.active + rec.scheduled + rec.rescheduled + rec.sending;
    const isComplete = rec.contactsSent > 0 && outstanding === 0;
    const hasPending = outstanding > 0;
    const status = rec.sending > 0 ? 'sending'
      : rec.rescheduled > 0 ? 'rescheduled'
        : rec.scheduled > 0 ? 'scheduled'
          : rec.drafting > 0 ? 'drafting'
            : rec.pending > 0 ? 'pending'
              : isComplete ? 'complete'
                : rec.sent > 0 ? 'partial'
                  : 'unknown';
    const entry = {
      university: rec.university,
      state: (usaCatalogEntry?.state && usaCatalogEntry.state !== 'Unknown')
        ? usaCatalogEntry.state
        : rec.state || chinaProvince || undefined,
      rank: rec.region === 'usa' ? (usaCatalogEntry?.rank ?? null) : (rankedEntry?.rank ?? null),
      qsRank: rankedEntry?.rank ?? null,
      rankingScore: rankedEntry?.score ?? null,
      popularity: usaCatalogEntry?.popularity ?? null,
      sent: rec.sent,
      contactsSent: rec.contactsSent,
      pending: rec.pending,
      active: rec.active,
      scheduled: rec.scheduled,
      rescheduled: rec.rescheduled,
      sending: rec.sending,
      drafting: rec.drafting,
      failed: rec.failed || 0,
      notFound: rec.notFound || 0,
      total: rec.total,
      relevance: rec.relevance,
      lastSentAt: rec.lastSentAt,
      lastPendingAt: rec.lastPendingAt,
      lastActiveAt: rec.lastActiveAt,
      lastFailedAt: rec.lastFailedAt,
      status,
    };

    bucket.universities.push(entry);
    bucket.totals.professorsSent += rec.sent;
    bucket.totals.contactsSent += rec.contactsSent;
    bucket.totals.professorsPending += rec.pending;
    bucket.totals.professorsActive += rec.active;
    bucket.totals.professorsScheduled += rec.scheduled;
    bucket.totals.professorsRescheduled += rec.rescheduled;
    bucket.totals.professorsSending += rec.sending;
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

  for (const key of COUNTRY_IDS) {
    regions[key].universities = sortUnis(regions[key].universities);
    regions[key].completed = sortUnis(regions[key].completed);
    regions[key].pending = sortUnis(regions[key].pending);
    regions[key].inProgress = sortUnis(regions[key].inProgress);

    const existingNames = regions[key].universities.map(u => u.university);
    if (key === 'usa') {
      const { items, totalMatching } = buildSuggestions('usa', existingNames, userMajors, { limit: 1000 });
      regions[key].suggested = items.map(item => {
        const rankedEntry = matchRankedUniversity(item.university, 'usa');
        return {
          ...item,
          qsRank: rankedEntry?.rank ?? null,
          rankingScore: rankedEntry?.score ?? null,
        };
      });
      regions[key].suggestedTotal = totalMatching;
      regions[key].catalogTotal = getUsaTargetUniversities().length;
    } else if (key === 'china') {
      const existingNameSet = new Set(existingNames.map(normalizeUniversityName));
      regions[key].suggested = getRankedUniversities('china')
        .filter(item => !existingNameSet.has(normalizeUniversityName(item.name)))
        .map(item => ({
          university: item.name,
          region: key,
          state: getChinaProvince(item.name),
          rank: item.rank,
          qsRank: item.rank,
          rankingScore: item.score,
          relevance: relevanceScore('', keywords),
          status: 'suggested',
        }));
      regions[key].suggestedTotal = regions[key].suggested.length;
      regions[key].catalogTotal = getRankedUniversities('china').length;
    } else {
      const existingNameSet = new Set(existingNames.map(normalizeUniversityName));
      regions[key].suggested = getRankedUniversities(key)
        .filter(item => !existingNameSet.has(normalizeUniversityName(item.name)))
        .map(item => ({
          university: item.name,
          region: key,
          rank: item.rank,
          qsRank: item.rank,
          rankingScore: item.score,
          relevance: 0,
          status: 'suggested',
        }));
      regions[key].suggestedTotal = regions[key].suggested.length;
      regions[key].catalogTotal = getRankedUniversities(key).length;
    }
  }

  for (const key of COUNTRY_IDS) {
    if (regions[key].universities.some(item => item.state) || key === 'usa' || key === 'china') {
      regions[key].states = buildSubdivisionSummary(regions[key].suggested, regions[key].universities);
    }
  }

  const result = {
    userMajors,
    regions,
    countryIds: COUNTRY_IDS,
    ranking: {
      name: globalCatalog.ranking,
      year: globalCatalog.year,
      officialUrl: globalCatalog.officialUrl,
    },
    updatedAt: new Date().toISOString(),
  };
  outreachCaches.set(tenant, { value: result, at: Date.now() });
  return result;
}
