/** User-selectable designations to skip during faculty import. */
export const SKIP_DESIGNATION_OPTIONS = [
  { id: 'lecturer', label: 'Lecturer', pattern: /\blecturer\b/i },
  { id: 'instructor', label: 'Instructor', pattern: /\binstructor\b/i },
  { id: 'adjunct', label: 'Adjunct', pattern: /\badjunct\b/i },
  { id: 'administration', label: 'Administration', pattern: /\b(administration|administrative|admin\s+staff|department\s+administrator|office\s+manager)\b/i },
  { id: 'coordinator', label: 'Coordinator', pattern: /\bcoordinator\b/i },
  { id: 'advisor', label: 'Advisor', pattern: /\b(advisor|adviser)\b/i },
  { id: 'staff', label: 'Staff (non-faculty)', pattern: /\b(staff|clerical|secretary|receptionist)\b/i },
  { id: 'emeritus', label: 'Emeritus / Emerita', pattern: /\b(emeritus|emerita)\b/i },
  { id: 'visiting', label: 'Visiting (non-permanent)', pattern: /\bvisiting\b/i },
];

export function shouldSkipByDesignation(titleOrDesignation, skipIds = []) {
  if (!skipIds?.length) return false;
  const text = String(titleOrDesignation || '').trim();
  if (!text) return false;
  for (const id of skipIds) {
    const opt = SKIP_DESIGNATION_OPTIONS.find(o => o.id === id);
    if (opt?.pattern.test(text)) return true;
  }
  return false;
}

export function filterProfessorsByDesignation(professors, skipIds = []) {
  if (!skipIds?.length) return { kept: professors, skipped: [] };
  const kept = [];
  const skipped = [];
  for (const p of professors) {
    const designation = `${p.title || ''} ${p.designation || ''}`.trim();
    if (shouldSkipByDesignation(designation, skipIds)) {
      skipped.push({ ...p, skip_reason: designation || 'designation_filter' });
    } else {
      kept.push(p);
    }
  }
  return { kept, skipped };
}
