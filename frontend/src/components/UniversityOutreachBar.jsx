import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Filter, GraduationCap, Loader2, Search, X } from 'lucide-react';
import { get } from '../api.js';
import { useSession } from '../context/SessionContext.jsx';
import { getHourInZone, getStateTimezone, getTimeInZone } from '../data/timezones.js';

function statusLabel(entry) {
  if (entry.variant === 'sent') return 'Sent';
  if (entry.variant === 'active') return 'In progress';
  if (entry.variant === 'partial') return 'Partial';
  if (entry.variant === 'pending') return 'Pending';
  return 'Suggested';
}

function buildUsaRows(region) {
  const rows = [];
  const seen = new Set();
  const add = (entry, variant) => {
    const key = `${entry.university}|${variant}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      university: entry.university,
      state: entry.state || 'Unknown',
      rank: entry.rank || null,
      relevance: entry.relevance ?? 0,
      popularity: entry.popularity ?? 0,
      sent: entry.sent ?? 0,
      pending: entry.pending ?? 0,
      active: entry.active ?? 0,
      lastSentAt: entry.lastSentAt || null,
      lastPendingAt: entry.lastPendingAt || null,
      lastActiveAt: entry.lastActiveAt || null,
      variant,
    });
  };
  for (const e of region?.universities || []) {
    add(e, e.sent > 0 ? (e.pending || e.active ? 'partial' : 'sent') : e.active ? 'active' : 'pending');
  }
  for (const e of region?.suggested || []) add(e, 'suggested');
  return rows;
}

function compareValue(a, b, key) {
  if (key === 'university' || key === 'status') {
    const av = key === 'status' ? statusLabel(a) : a.university;
    const bv = key === 'status' ? statusLabel(b) : b.university;
    return av.localeCompare(bv);
  }
  const av = a[key] ?? (key === 'rank' ? 999999 : 0);
  const bv = b[key] ?? (key === 'rank' ? 999999 : 0);
  return Number(av) - Number(bv);
}

function groupByState(rows, tableSort) {
  const map = new Map();
  for (const row of rows) {
    const state = row.state || 'Unknown';
    if (!map.has(state)) map.set(state, { items: [], lastAt: null });
    const bucket = map.get(state);
    bucket.items.push(row);
    const latest = [row.lastSentAt, row.lastPendingAt, row.lastActiveAt].filter(Boolean).sort().at(-1) || null;
    if (latest && (!bucket.lastAt || latest > bucket.lastAt)) bucket.lastAt = latest;
  }
  return [...map.entries()]
    .map(([state, bucket]) => ({
      state,
      lastAt: bucket.lastAt,
      items: [...bucket.items].sort((a, b) => {
        const base = compareValue(a, b, tableSort.key);
        return tableSort.dir === 'asc' ? base : -base;
      }),
    }))
    .sort((a, b) => a.state.localeCompare(b.state));
}

export default function UniversityOutreachBar() {
  const { backendReachable, sessionVersion } = useSession();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sortMode, setSortMode] = useState('major');
  const [stateFilter, setStateFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [tableSort, setTableSort] = useState({ key: 'rank', dir: 'asc' });
  const [refreshTick, setRefreshTick] = useState(0);
  const [tick, setTick] = useState(0);

  const loadOutreach = () => {
    if (!backendReachable) return;
    setLoading(true);
    get('/university-outreach', { timeout: 25000 })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadOutreach(); }, [backendReachable, sessionVersion]);

  useEffect(() => {
    if (!open) return undefined;
    const id = setInterval(() => { loadOutreach(); setRefreshTick(t => t + 1); }, 15000);
    return () => clearInterval(id);
  }, [open, backendReachable, sessionVersion]);

  useEffect(() => {
    if (!open) return undefined;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [open]);

  const usa = data?.regions?.usa;
  const usaRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return buildUsaRows(usa)
      .filter(row => stateFilter === 'all' || row.state === stateFilter)
      .filter(row => !q || row.university.toLowerCase().includes(q) || row.state.toLowerCase().includes(q))
      .sort((a, b) => {
        if (sortMode === 'popular') return (a.rank || 999999) - (b.rank || 999999);
        if (sortMode === 'sent') return (b.sent || 0) - (a.sent || 0) || (a.rank || 999999) - (b.rank || 999999);
        return (b.relevance || 0) - (a.relevance || 0) || (a.rank || 999999) - (b.rank || 999999);
      })
      .slice(0, 1000);
  }, [usa, sortMode, stateFilter, query]);

  const states = useMemo(() => ['all', ...(usa?.states || []).map(s => s.state).filter(Boolean)], [usa]);
  const stateGroups = useMemo(() => groupByState(usaRows, tableSort), [usaRows, tableSort]);
  const totals = usa?.totals || {};
  const formatTime = (value) => (value ? new Date(value).toLocaleString() : '—');
  const formatShortTime = (value) => (value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
  const getStateTimeClass = (state) => {
    const hour = getHourInZone(getStateTimezone(state));
    return hour >= 8 && hour < 20
      ? 'text-emerald-600 dark:text-emerald-300'
      : 'text-red-600 dark:text-red-300';
  };

  const setColumnSort = (key) => {
    setTableSort(prev => (prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: ['university', 'rank', 'status'].includes(key) ? 'asc' : 'desc' }));
  };

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); if (!data) loadOutreach(); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold border bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25 hover:bg-violet-500/15 transition-colors whitespace-nowrap">
        <GraduationCap className="w-3.5 h-3.5" /> University outreach {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] text-[rgb(var(--text-primary))]" style={{ backgroundColor: 'rgb(var(--surface-page))' }}>
            <div className="h-screen w-screen flex flex-col" style={{ backgroundColor: 'rgb(var(--surface-page))' }}>
              <div className="shrink-0 border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-card))] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><GraduationCap className="w-5 h-5 text-violet-500" /><h2 className="text-base font-bold">University Outreach</h2></div>
                    <p className="text-[11px] text-muted mt-0.5">USA universities by state · showing up to 1000 · internal 2026 outreach ranking · matched to your majors</p>
                  </div>
                  <button type="button" onClick={() => setOpen(false)} className="icon-btn" aria-label="Close university outreach"><X className="w-5 h-5" /></button>
                </div>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                  <Metric label="USA catalog" value={usa?.catalogTotal || 0} />
                  <Metric label="Shown" value={usaRows.length} />
                  <Metric label="States" value={states.length > 1 ? states.length - 1 : 0} />
                  <Metric label="Sent" value={totals.professorsSent || 0} />
                  <Metric label="Pending" value={totals.professorsPending || 0} />
                  <Metric label="Active" value={totals.professorsActive || 0} />
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted"><span>Last refresh: {refreshTick ? new Date().toLocaleTimeString() : 'live'}</span><span>Sent history: {totals.professorsSent || 0} sent across universities</span></div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[220px] flex-1 max-w-md"><Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search university or state" className="w-full pl-8 pr-3 py-2 rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-page))] text-[rgb(var(--text-primary))] text-xs" /></div>
                  <Filter className="w-3.5 h-3.5 text-muted" />
                  <select value={sortMode} onChange={e => setSortMode(e.target.value)} className="text-xs rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-page))] text-[rgb(var(--text-primary))] px-3 py-2"><option value="major">Best major match</option><option value="popular">Popular / ranked</option><option value="sent">Most sent</option></select>
                  <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} className="text-xs rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-page))] text-[rgb(var(--text-primary))] px-3 py-2">{states.map(s => <option key={s} value={s}>{s === 'all' ? 'All states' : s}</option>)}</select>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4" style={{ backgroundColor: 'rgb(var(--surface-page))' }}>
                {!data && loading ? (
                  <div className="h-full flex items-center justify-center text-sm text-muted"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading university outreach</div>
                ) : (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4" style={{ backgroundColor: 'rgb(var(--surface-page))' }}>
                    {stateGroups.map(group => (
                      <section key={group.state} className="rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-card))] overflow-hidden">
                        <div className="px-3 py-2 border-b border-[rgb(var(--border-subtle))] flex items-center justify-between gap-2 bg-[rgb(var(--surface-muted))]/40">
                          <div className="min-w-0">
                            <h3 className="text-sm font-bold flex items-center gap-2">
                              {group.state}
                              <span className={`text-[11px] font-semibold tabular-nums ${getStateTimeClass(group.state)}`}>
                                {getTimeInZone(getStateTimezone(group.state), 'time')}
                              </span>
                            </h3>
                            <p className="text-[10px] text-muted">Last state update: {formatTime(group.lastAt)}</p>
                          </div>
                          <span className="text-[10px] text-muted">{group.items.length} universities</span>
                        </div>
                        <div className="overflow-auto max-h-[420px] bg-[rgb(var(--surface-card))]"><table className="w-full text-[11px] min-w-[620px] bg-[rgb(var(--surface-card))]"><thead className="sticky top-0 z-10 bg-[rgb(var(--surface-muted))] border-b border-[rgb(var(--border-subtle))]"><tr><Th sortKey="university" activeSort={tableSort} onSort={setColumnSort}>University</Th><Th sortKey="rank" activeSort={tableSort} onSort={setColumnSort} align="right">2026 Rank</Th><Th sortKey="relevance" activeSort={tableSort} onSort={setColumnSort} align="right">Match</Th><Th sortKey="status" activeSort={tableSort} onSort={setColumnSort}>Status</Th><Th sortKey="sent" activeSort={tableSort} onSort={setColumnSort} align="right">Sent</Th><Th sortKey="pending" activeSort={tableSort} onSort={setColumnSort} align="right">Pending</Th></tr></thead><tbody>{group.items.map((row, idx) => (<tr key={`${row.university}-${idx}`} className="border-b border-[rgb(var(--border-subtle))]/60 hover:bg-[rgb(var(--surface-muted))]/60"><td className="px-3 py-2 font-medium"><div className="flex flex-col"><span>{row.university}</span><span className="text-[10px] text-muted">sent {formatShortTime(row.lastSentAt)} · pending {formatShortTime(row.lastPendingAt)} · active {formatShortTime(row.lastActiveAt)}</span></div></td><td className="px-3 py-2 text-right tabular-nums text-muted">{row.rank ? `#${row.rank}` : '-'}</td><td className="px-3 py-2 text-right tabular-nums text-muted">{row.relevance}</td><td className="px-3 py-2 text-muted">{statusLabel(row)}</td><td className="px-3 py-2 text-right tabular-nums text-muted">{row.sent}</td><td className="px-3 py-2 text-right tabular-nums text-muted">{row.pending}</td></tr>))}</tbody></table></div>
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Metric({ label, value }) {
  return <div className="rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-muted))]/60 px-3 py-2"><p className="text-[9px] uppercase tracking-wider font-semibold text-muted">{label}</p><p className="text-lg font-bold tabular-nums">{value}</p></div>;
}

function Th({ children, align = 'left', sortKey, activeSort, onSort }) {
  const active = activeSort?.key === sortKey;
  return <th className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'} font-semibold text-muted whitespace-nowrap`}><button type="button" onClick={() => onSort?.(sortKey)} className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end' : 'justify-start'} w-full hover:text-[rgb(var(--text-primary))] transition-colors`}><span>{children}</span>{active ? (activeSort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : <ChevronDown className="w-3 h-3 opacity-30" />}</button></th>;
}
