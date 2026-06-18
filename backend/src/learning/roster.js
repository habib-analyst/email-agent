import db from '../db/index.js';

function parseDossier(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function escapeCsv(v) {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildRosterRows(mode = 'instant') {
  const rows = db.prepare(`
    SELECT p.id, p.email, p.last_name, p.university, p.research_areas, p.source_url, p.dossier, p.mode,
      q.id as queue_id, q.subject, q.interest_line, q.state,
      sl.research_duration_ms, sl.draft_duration_ms, sl.total_duration_ms
    FROM professors p
    LEFT JOIN queue q ON q.professor_id = p.id AND q.mode = p.mode
    LEFT JOIN sent_log sl ON sl.professor_email = p.email AND sl.mode = p.mode
    WHERE p.mode = ?
    ORDER BY p.id
  `).all(mode);

  return rows.map(r => {
    const d = parseDossier(r.dossier);
    const roster = d.roster || {};
    const fullName = roster.full_name || d.name || '';
    const lastName = roster.last_name || r.last_name || (fullName ? fullName.split(/\s+/).pop() : '');
    const profileStatus = d.profile_research_status || '';
    return {
      id: r.id,
      queue_id: r.queue_id || null,
      full_name: fullName || lastName,
      last_name: lastName,
      email: r.email,
      university: r.university || d.university || '',
      department: roster.department || d.department || '',
      designation: roster.designation || d.title || '',
      faculty_rank: roster.faculty_rank || d.faculty_rank || '',
      is_professor_rank: roster.is_professor_rank != null
        ? (roster.is_professor_rank ? 'yes' : 'no')
        : (d.is_professor_rank ? 'yes' : 'no'),
      research_interest: roster.research_interest || r.research_areas || (d.research_areas || []).join(', '),
      subject_keyword: d.subject_keyword || (mode === 'basic_instant' ? '' : ((r.subject?.match(/^\[([^\]]+)\]/) || [])[1] || '')),
      designation_line: mode === 'basic_instant' ? '' : (r.interest_line || d.interest_line || ''),
      interest_line: mode === 'basic_instant' ? '' : (d.interest_line || r.interest_line || ''),
      profile_url: roster.profile_url || d.profile_url || r.source_url || '',
      email_verified: d.email_verified ? 'yes' : 'no',
      profile_research_status: profileStatus,
      research_info: d.research_info || (profileStatus === 'none_on_page' ? 'No info on page' : profileStatus === 'profile_found' ? 'From page' : profileStatus === 'web_complete' ? 'From web' : ''),
      queue_state: r.state || '',
      research_duration_ms: r.research_duration_ms || null,
      draft_duration_ms: r.draft_duration_ms || null,
      total_duration_ms: r.total_duration_ms || null,
    };
  });
}

export function rosterToCsv(rows) {
  const headers = ['full_name', 'last_name', 'email', 'university', 'department', 'designation', 'research_interest', 'subject_keyword', 'interest_line', 'profile_url', 'email_verified', 'queue_state', 'research_duration_ms', 'draft_duration_ms', 'total_duration_ms'];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escapeCsv(row[h])).join(','));
  }
  return lines.join('\n');
}
