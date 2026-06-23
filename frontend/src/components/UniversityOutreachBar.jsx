import React, { useEffect, useMemo, useState } from 'react';
import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Filter, GraduationCap, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { get } from '../api.js';
import { useSession } from '../context/SessionContext.jsx';
import { getHourInZone, getStateTimezone, getTimeInZone, TIMEZONE_COUNTRIES } from '../data/timezones.js';
import { formatDateTime12, formatTime12 } from '../utils/dateTime.js';
import { useEventStream } from '../core/EventStreamProvider.jsx';

function statusLabel(entry) {
  const status = entry.status || entry.variant;
  if (status === 'complete' || status === 'sent') return 'Done';
  if (status === 'sending') return 'Sending';
  if (status === 'rescheduled') return 'Rescheduled';
  if (status === 'scheduled') return 'Scheduled';
  if (status === 'drafting' || status === 'active') return 'Drafting';
  if (status === 'partial') return 'Partial';
  if (status === 'pending') return 'Pending';
  return 'Suggested';
}

function statusClasses(entry) {
  const status = entry.status || entry.variant;
  if (status === 'complete' || status === 'sent') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
  if (status === 'sending') return 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30';
  if (status === 'rescheduled') return 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30';
  if (status === 'scheduled') return 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30';
  if (status === 'drafting' || status === 'active') return 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30';
  if (status === 'partial') return 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30';
  if (status === 'pending') return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30';
  return 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/25';
}

function StatusBadge({ entry }) {
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClasses(entry)}`}>{statusLabel(entry)}</span>;
}

function buildUsaRows(region) {
  const rows = [];
  const seen = new Set();
  const add = (entry, variant) => {
    const key = String(entry.university || '').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      university: entry.university,
      state: entry.state || 'Unknown',
      rank: entry.rank || null,
      qsRank: entry.qsRank || null,
      relevance: entry.relevance ?? 0,
      popularity: entry.popularity ?? 0,
      sent: entry.sent ?? 0,
      contactsSent: entry.contactsSent ?? 0,
      pending: entry.pending ?? 0,
      active: entry.active ?? 0,
      lastSentAt: entry.lastSentAt || null,
      lastPendingAt: entry.lastPendingAt || null,
      lastActiveAt: entry.lastActiveAt || null,
      status: entry.status || variant,
      variant,
    });
  };
  for (const e of region?.universities || []) {
    add(e, e.status || (e.sent > 0 ? 'complete' : 'pending'));
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
  const rankNumber = value => Number.parseInt(String(value || '').replace(/[^0-9].*$/, ''), 10) || 999999;
  const av = key === 'rank' ? rankNumber(a[key]) : (a[key] ?? 0);
  const bv = key === 'rank' ? rankNumber(b[key]) : (b[key] ?? 0);
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
  const { subscribe } = useEventStream();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sortMode, setSortMode] = useState('major');
  const [selectedCountry, setSelectedCountry] = useState('usa');
  const [stateFilter, setStateFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [tableSort, setTableSort] = useState({ key: 'rank', dir: 'asc' });
  const [, setRefreshTick] = useState(0);
  const [tick, setTick] = useState(0);
  const buttonRef = React.useRef(null);
  const popupRef = React.useRef(null);
  const [popupTop, setPopupTop] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    const updateTop = () => {
      const header = buttonRef.current?.closest('header');
      setPopupTop(Math.max(0, Math.round(header?.getBoundingClientRect().bottom || 0)));
    };
    const onPointerDown = event => {
      if (!buttonRef.current?.contains(event.target) && !popupRef.current?.contains(event.target)) {
        event.preventDefault();
        setOpen(false);
      }
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') setOpen(false);
    };
    updateTop();
    window.addEventListener('resize', updateTop);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', updateTop);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const loadOutreach = useCallback(() => {
    if (!backendReachable) return;
    setLoading(true);
    get('/university-outreach', { timeout: 25000 })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [backendReachable]);

  useEffect(() => { loadOutreach(); }, [loadOutreach, sessionVersion]);

  useEffect(() => subscribe(event => {
    if (
      event.type === 'sent_history_updated'
      || event.type === 'delivery_failure_updated'
      || event.type === 'state_change'
      || event.type === 'progress'
      || event.type === 'awaiting_proceed'
      || event.type === 'sending_paused'
      || event.type?.startsWith('scheduled_')
    ) {
      loadOutreach();
      setRefreshTick(value => value + 1);
    }
  }), [subscribe, loadOutreach]);

  useEffect(() => {
    if (!open) return undefined;
    const id = setInterval(() => { loadOutreach(); setRefreshTick(t => t + 1); }, 15000);
    return () => clearInterval(id);
  }, [open, backendReachable, sessionVersion, loadOutreach]);

  useEffect(() => {
    if (!open) return undefined;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    setStateFilter('all');
    setQuery('');
  }, [selectedCountry]);

  const countryMeta = useMemo(() => {
    const map = new Map();
    for (const item of TIMEZONE_COUNTRIES) {
      const id = item.id.startsWith('us-') ? 'usa' : item.id;
      if (!map.has(id)) map.set(id, { ...item, id, label: id === 'usa' ? 'USA' : item.label });
    }
    return map;
  }, []);
  const region = data?.regions?.[selectedCountry];
  const groupedCountry = selectedCountry === 'usa' || selectedCountry === 'china' || (region?.states?.length || 0) > 0;
  const subdivisionLabel = selectedCountry === 'china' ? 'province' : selectedCountry === 'usa' ? 'state' : 'region';
  const usaRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = buildUsaRows(region)
      .filter(row => stateFilter === 'all' || row.state === stateFilter)
      .filter(row => !q || row.university.toLowerCase().includes(q) || row.state.toLowerCase().includes(q));
    const sortRows = rows => rows.sort((a, b) => {
      if (sortMode === 'popular') return compareValue(a, b, 'rank');
      if (sortMode === 'sent') return (b.sent || 0) - (a.sent || 0) || compareValue(a, b, 'rank');
      return (b.relevance || 0) - (a.relevance || 0) || compareValue(a, b, 'rank');
    });
    const tracked = sortRows(filtered.filter(row => row.variant !== 'suggested'));
    const suggestions = sortRows(filtered.filter(row => row.variant === 'suggested'));
    return [...tracked, ...suggestions.slice(0, selectedCountry === 'usa' ? 1000 : suggestions.length)];
  }, [region, sortMode, stateFilter, query, selectedCountry]);

  const states = useMemo(() => ['all', ...(region?.states || []).map(s => s.state).filter(Boolean)], [region]);
  const stateGroups = useMemo(() => {
    if (groupedCountry) return groupByState(usaRows, tableSort);
    return [{
      state: countryMeta.get(selectedCountry)?.label || selectedCountry,
      lastAt: usaRows.map(row => row.lastSentAt || row.lastPendingAt || row.lastActiveAt).filter(Boolean).sort().at(-1) || null,
      items: [...usaRows].sort((a, b) => {
        const base = compareValue(a, b, tableSort.key);
        return tableSort.dir === 'asc' ? base : -base;
      }),
    }];
  }, [usaRows, tableSort, selectedCountry, countryMeta, groupedCountry]);
  const totals = region?.totals || {};
  const formatTime = (value) => formatDateTime12(value);
  const formatShortTime = (value) => formatTime12(value);
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
      <button ref={buttonRef} type="button" onClick={() => { setOpen(value => !value); if (!open) loadOutreach(); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold border bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25 hover:bg-violet-500/15 transition-colors whitespace-nowrap">
        <GraduationCap className="w-3.5 h-3.5" /> University outreach {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {createPortal(<AnimatePresence>
        {open && (
          <motion.div
            ref={popupRef}
            initial={{ opacity: 0, y: -18, scaleY: 0.985 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: -12, scaleY: 0.99 }}
            transition={{ type: 'spring', stiffness: 520, damping: 40, mass: 0.7 }}
            className="fixed inset-x-0 bottom-0 z-[100] text-[rgb(var(--text-primary))]"
            style={{ top: popupTop, backgroundColor: 'rgb(var(--surface-page))', transformOrigin: 'top center' }}
          >
            <div className="flex h-full w-full flex-col overflow-hidden" style={{ backgroundColor: 'rgb(var(--surface-page))' }}>
              <div className="shrink-0 border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-card))] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><GraduationCap className="w-5 h-5 text-violet-500" /><h2 className="text-base font-bold">University Outreach</h2></div>
                    <p className="text-[11px] text-muted mt-0.5">
                      {selectedCountry === 'usa'
                        ? 'USA universities by 51 state groups · up to 1,000 major-matched targets · live database status'
                        : selectedCountry === 'china'
                          ? 'China universities by province and municipality · QS 2026 catalog · live database status'
                        : `Multi-country live outreach · ${data?.ranking?.name || 'verified ranking'} · database-backed status`}
                      {data?.ranking?.officialUrl && <a href={data.ranking.officialUrl} target="_blank" rel="noreferrer" className="ml-1 text-violet-600 dark:text-violet-300 hover:underline">Source</a>}
                    </p>
                  </div>
                  <button type="button" onClick={() => setOpen(false)} className="icon-btn" aria-label="Close university outreach"><X className="w-5 h-5" /></button>
                </div>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-9 gap-2">
                  <Metric label={selectedCountry === 'usa' ? 'USA catalog' : `${countryMeta.get(selectedCountry)?.label || selectedCountry} ranked`} value={region?.catalogTotal || 0} />
                  <Metric label="Shown" value={usaRows.length} />
                  <Metric label={groupedCountry ? `${subdivisionLabel[0].toUpperCase()}${subdivisionLabel.slice(1)} groups` : 'Country'} value={groupedCountry ? Math.max(0, states.length - 1) : 1} />
                  <Metric label="Messages sent" value={totals.professorsSent || 0} />
                  <Metric label="Contacts sent" value={totals.contactsSent || 0} />
                  <Metric label="Universities done" value={totals.universitiesCompleted || 0} />
                  <Metric label="Pending" value={totals.professorsPending || 0} />
                  <Metric label="Scheduled" value={totals.professorsScheduled || 0} />
                  <Metric label="Rescheduled" value={totals.professorsRescheduled || 0} />
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted"><span>Last refresh: {data?.updatedAt ? formatTime12(data.updatedAt) : 'live'}</span><span>Sent history: {totals.professorsSent || 0} messages to {totals.contactsSent || 0} contacts</span></div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select value={selectedCountry} onChange={e => setSelectedCountry(e.target.value)} className="text-xs rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-page))] text-[rgb(var(--text-primary))] px-3 py-2">
                    {(data?.countryIds || []).map(id => <option key={id} value={id}>{countryMeta.get(id)?.label || id}</option>)}
                  </select>
                  <div className="relative min-w-[220px] flex-1 max-w-md"><Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search university or ${subdivisionLabel}`} className="w-full pl-8 pr-3 py-2 rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-page))] text-[rgb(var(--text-primary))] text-xs" /></div>
                  <Filter className="w-3.5 h-3.5 text-muted" />
                  <select value={sortMode} onChange={e => setSortMode(e.target.value)} className="text-xs rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-page))] text-[rgb(var(--text-primary))] px-3 py-2"><option value="major">Best major match</option><option value="popular">Popular / ranked</option><option value="sent">Most sent</option></select>
                  {groupedCountry && <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} className="text-xs rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-page))] text-[rgb(var(--text-primary))] px-3 py-2">{states.map(s => <option key={s} value={s}>{s === 'all' ? `All ${subdivisionLabel}s` : s}</option>)}</select>}
                  <button type="button" onClick={loadOutreach} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-[rgb(var(--border-subtle))] px-3 py-2 text-xs font-semibold hover:bg-[rgb(var(--surface-muted))] disabled:opacity-50">
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh DB
                  </button>
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
                              <span className={`text-[11px] font-semibold tabular-nums ${selectedCountry === 'usa' ? getStateTimeClass(group.state) : 'text-emerald-600 dark:text-emerald-300'}`}>
                                {getTimeInZone(selectedCountry === 'usa' ? getStateTimezone(group.state) : countryMeta.get(selectedCountry)?.tz || 'UTC', 'time')}
                              </span>
                            </h3>
                            <p className="text-[10px] text-muted">Last {subdivisionLabel} update: {formatTime(group.lastAt)}</p>
                          </div>
                          <span className="text-[10px] text-muted">{group.items.length} universities</span>
                        </div>
                        <div className="overflow-auto max-h-[420px] bg-[rgb(var(--surface-card))]">
                          <table className="w-full text-[11px] min-w-[700px] bg-[rgb(var(--surface-card))]">
                            <thead className="sticky top-0 z-10 bg-[rgb(var(--surface-muted))] border-b border-[rgb(var(--border-subtle))]">
                              <tr>
                                <Th sortKey="university" activeSort={tableSort} onSort={setColumnSort}>University</Th>
                                <Th sortKey="rank" activeSort={tableSort} onSort={setColumnSort} align="right">{selectedCountry === 'usa' ? 'Outreach rank' : '2026 Rank'}</Th>
                                <Th sortKey="relevance" activeSort={tableSort} onSort={setColumnSort} align="right">Match</Th>
                                <Th sortKey="status" activeSort={tableSort} onSort={setColumnSort}>Status</Th>
                                <Th sortKey="sent" activeSort={tableSort} onSort={setColumnSort} align="right">Messages</Th>
                                <Th sortKey="contactsSent" activeSort={tableSort} onSort={setColumnSort} align="right">Contacts</Th>
                                <Th sortKey="pending" activeSort={tableSort} onSort={setColumnSort} align="right">Pending</Th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.items.map((row, idx) => (
                                <tr key={`${row.university}-${idx}`} className="border-b border-[rgb(var(--border-subtle))]/60 hover:bg-[rgb(var(--surface-muted))]/60">
                                  <td className="px-3 py-2 font-medium">
                                    <div className="flex flex-col">
                                      <span className="text-[rgb(var(--text-primary))]">{row.university}</span>
                                      <span className="text-[10px] text-muted">sent {formatShortTime(row.lastSentAt)} · pending {formatShortTime(row.lastPendingAt)} · active {formatShortTime(row.lastActiveAt)}</span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-violet-700 dark:text-violet-300">
                                    {row.rank ? `#${row.rank}` : '-'}
                                    {selectedCountry === 'usa' && row.qsRank && <div className="text-[9px] font-medium text-muted">QS #{row.qsRank}</div>}
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-sky-700 dark:text-sky-300">{row.relevance}</td>
                                  <td className="px-3 py-2"><StatusBadge entry={row} /></td>
                                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">{row.sent}</td>
                                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-blue-700 dark:text-blue-300">{row.contactsSent}</td>
                                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-700 dark:text-amber-300">{row.pending}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
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
