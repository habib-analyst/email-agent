import React, { useState, useMemo } from 'react';
import { FileSpreadsheet, Download, Maximize2, Minimize2, Radio, Loader2, Globe } from 'lucide-react';
import { post } from '../api.js';

const DRAFT_COLORS = {
  draft: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-neutral-800 dark:text-emerald-400',
  sent: 'bg-blue-100 text-blue-700 dark:bg-neutral-800 dark:text-blue-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  cancelled: 'bg-gray-200 text-gray-700 dark:bg-neutral-800 dark:text-gray-400',
  needs_web_research: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
};

function DraftBadge({ status }) {
  const live = status === 'draft' || status === 'approved';
  const cls = DRAFT_COLORS[status] || 'bg-gray-200 text-gray-700 dark:bg-neutral-800 dark:text-gray-400';
  const label = status === 'needs_web_research' ? 'needs web search' : (status || '—');
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold ${cls}`}>
      {live && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
      {label}
    </span>
  );
}

export default function ScheduledRosterPanel({
  rows,
  batches,
  activeEmail,
  live = true,
  onClear,
  onWebSearchDraft,
  onWebSearchBulk,
  webSearchingDraftId,
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [batchFilter, setBatchFilter] = useState('all');

  const filtered = useMemo(() => {
    if (batchFilter === 'all') return rows;
    return rows.filter(r => String(r.batch_id) === String(batchFilter));
  }, [rows, batchFilter]);

  const summary = useMemo(() => {
    const counts = {};
    for (const r of rows || []) {
      const s = r.draft_status || 'draft';
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  }, [rows]);

  const needsWebCount = summary.needs_web_research || 0;
  const processingBatch = batches?.find(b => ['processing', 'sending'].includes(b.status));

  if (!rows?.length) {
    return (
      <div className="rounded-2xl border border-dashed border-emerald-200/60 dark:border-emerald-900/40 bg-emerald-50/30 dark:bg-emerald-950/10 p-8 text-center">
        <FileSpreadsheet className="w-8 h-8 text-emerald-300 dark:text-emerald-700 mx-auto mb-2" />
        <p className="text-xs text-muted">No professors in roster yet — import and schedule a batch above</p>
      </div>
    );
  }

  const content = (
    <div className={`rounded-2xl border border-emerald-200/60 dark:border-emerald-900/40 bg-white dark:bg-neutral-900 overflow-hidden shadow-lg ${fullscreen ? 'rounded-none border-none shadow-none' : ''}`}>
      <div className="px-4 py-3 border-b border-emerald-100 dark:border-emerald-900/40 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-emerald-50/80 to-white dark:from-neutral-900 dark:to-neutral-900">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2 text-gray-900 dark:text-gray-100">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            Live Scheduled Roster
            {live && processingBatch && (
              <span className="inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full bg-red-500 text-white font-bold uppercase tracking-wide animate-pulse">
                <Radio className="w-2.5 h-2.5" /> Live
              </span>
            )}
          </h3>
          <p className="text-[10px] text-muted mt-0.5">
            {rows.length} professors · {batches?.length || 0} batches
            {processingBatch && ` · Batch #${processingBatch.id} ${processingBatch.status}`}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {Object.entries(summary).map(([k, v]) => (
              <span key={k} className="text-[9px] px-2 py-0.5 rounded-full bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 text-muted">
                {k === 'needs_web_research' ? 'needs web' : k}: <strong className="text-gray-900 dark:text-gray-100">{v}</strong>
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {needsWebCount > 0 && onWebSearchBulk && batchFilter !== 'all' && (
            <button
              type="button"
              onClick={() => onWebSearchBulk(batchFilter)}
              disabled={webSearchingDraftId === 'bulk'}
              className="text-[10px] px-3 py-1.5 flex items-center gap-1 rounded-lg bg-sky-500/10 text-sky-700 dark:text-sky-300 font-medium"
            >
              {webSearchingDraftId === 'bulk' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Globe className="w-3 h-3" />}
              Web search batch ({needsWebCount})
            </button>
          )}
          <select value={batchFilter} onChange={e => setBatchFilter(e.target.value)}
            className="text-[10px] px-2 py-1.5 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-brand-400">
            <option value="all">All Batches</option>
            {batches?.map(b => (
              <option key={b.id} value={b.id}>Batch #{b.id} ({b.status})</option>
            ))}
          </select>
          <a href="/api/scheduled/roster.csv" className="btn-secondary text-[10px] px-3 py-1.5 flex items-center gap-1.5">
            <Download className="w-3 h-3" /> CSV
          </a>
          <a href="/api/scheduled/roster.xlsx" className="btn-primary text-[10px] px-3 py-1.5 flex items-center gap-1.5">
            <Download className="w-3 h-3" /> Excel
          </a>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="text-[10px] px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 font-medium"
            >
              Clear roster
            </button>
          )}
          <button onClick={() => setFullscreen(!fullscreen)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
            title={fullscreen ? 'Minimize' : 'Maximize'}>
            {fullscreen ? <Minimize2 className="w-4 h-4 text-muted" /> : <Maximize2 className="w-4 h-4 text-muted" />}
          </button>
        </div>
      </div>
      <div className={`overflow-auto ${fullscreen ? 'max-h-[calc(100vh-120px)]' : 'max-h-[360px]'}`}>
        <table className="w-full text-[11px] border-collapse">
          <thead className="bg-emerald-50 dark:bg-emerald-950/40 sticky top-0 border-b border-gray-200 dark:border-neutral-700 z-10">
            <tr className="text-left text-muted">
              <th className="px-3 py-2 font-semibold whitespace-nowrap">Batch</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap">Name</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap">Email</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap max-w-[120px]">University</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap max-w-[140px]">Research</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap">Status</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap max-w-[140px]">Interest</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-neutral-900">
            {filtered.slice(0, 300).map((r, i) => {
              const isActive = activeEmail && (r.email || '').toLowerCase() === activeEmail.toLowerCase();
              return (
                <tr key={r.id || `${r.email}-${i}`}
                  className={`border-b border-gray-100 dark:border-neutral-800 transition-colors
                    ${isActive ? 'bg-brand-50 dark:bg-neutral-800 ring-1 ring-inset ring-brand-300/50' : i % 2 ? 'bg-gray-50/50 dark:bg-neutral-800/30' : 'bg-white dark:bg-neutral-900'}
                  `}>
                  <td className="px-3 py-2 text-muted">
                    <span className="text-[10px] font-medium">#{r.batch_id}</span>
                  </td>
                  <td className="px-3 py-2 font-medium max-w-[140px] truncate text-gray-900 dark:text-gray-100">
                    {r.last_name || '—'}
                  </td>
                  <td className="px-3 py-2 text-muted max-w-[180px] truncate font-mono text-[10px]">
                    {r.email || '—'}
                  </td>
                  <td className="px-3 py-2 text-muted max-w-[120px] truncate">
                    {r.university || '—'}
                  </td>
                  <td className="px-3 py-2 text-muted max-w-[140px] truncate text-[10px]">
                    {r.draft_status === 'needs_web_research' ? (r.draft_error || r.research_info || 'No info on page') : (r.research_info || r.research_areas || '—')}
                  </td>
                  <td className="px-3 py-2">
                    <DraftBadge status={r.draft_status} />
                  </td>
                  <td className="px-3 py-2 text-muted max-w-[140px] truncate">
                    {r.interest_line || '—'}
                  </td>
                  <td className="px-3 py-2">
                    {r.draft_status === 'needs_web_research' && r.draft_id && onWebSearchDraft && (
                      <button
                        type="button"
                        onClick={() => onWebSearchDraft(r.draft_id)}
                        disabled={webSearchingDraftId === r.draft_id}
                        className="px-2 py-1 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-[9px] font-semibold text-sky-700 dark:text-sky-300 flex items-center gap-1"
                      >
                        {webSearchingDraftId === r.draft_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Globe className="w-3 h-3" />}
                        Web
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-white dark:bg-black p-4 overflow-auto">
        {content}
      </div>
    );
  }

  return content;
}
