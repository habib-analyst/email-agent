import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Clock3, Eye, Loader2, X } from 'lucide-react';
import { get } from '../api.js';

const number = value => Number(value || 0);

function dateTime(value) {
  if (!value) return '—';
  return new Date(value.endsWith?.('Z') ? value : `${value}Z`).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function StatusPill({ status }) {
  const complete = status === 'completed';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
      complete
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
        : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
    }`}>
      {complete ? <CheckCircle2 className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}
      {complete ? 'Completed' : 'Active'}
    </span>
  );
}

export default function InstantQueueHistory({ mode, queues, loading, onRefresh }) {
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  useEffect(() => {
    if (!selected) {
      setDetails(null);
      return;
    }
    setDetailsLoading(true);
    get(`/instant-queues/${selected.id}?mode=${encodeURIComponent(mode)}`)
      .then(setDetails)
      .finally(() => setDetailsLoading(false));
  }, [mode, selected]);

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">Permanent queue history for this Instant mode.</p>
          <button type="button" onClick={onRefresh} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
            Refresh
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200/80 dark:border-white/10">
          <div className="max-h-[430px] overflow-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="sticky top-0 z-10 bg-gray-50/95 text-[10px] uppercase tracking-wide text-gray-500 backdrop-blur dark:bg-neutral-900/95">
                <tr>
                  <th className="px-4 py-3">Queue</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Sent</th>
                  <th className="px-4 py-3">Pending</th>
                  <th className="px-4 py-3">Failed</th>
                  <th className="px-4 py-3">Duplicates</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {loading ? (
                  <tr><td colSpan="9" className="px-4 py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand-500" /></td></tr>
                ) : queues.length === 0 ? (
                  <tr><td colSpan="9" className="px-4 py-10 text-center text-muted">No Instant queues yet.</td></tr>
                ) : queues.map(queue => (
                  <tr key={queue.id} className="transition-colors hover:bg-brand-50/40 dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">Queue #{queue.queue_number}</td>
                    <td className="px-4 py-3 text-muted">{dateTime(queue.created_at)}</td>
                    <td className="px-4 py-3">{number(queue.total)}</td>
                    <td className="px-4 py-3 text-emerald-600">{number(queue.sent) + number(queue.replied)}</td>
                    <td className="px-4 py-3 text-amber-600">{number(queue.pending) + number(queue.processing)}</td>
                    <td className="px-4 py-3 text-red-600">{number(queue.failed)}</td>
                    <td className="px-4 py-3 text-violet-600">{number(queue.duplicates)}</td>
                    <td className="px-4 py-3"><StatusPill status={queue.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => setSelected(queue)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 font-semibold hover:border-brand-300 hover:text-brand-600 dark:border-white/10">
                        <Eye className="h-3.5 w-3.5" /> Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {selected && (
          <motion.div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/15 bg-white shadow-2xl dark:bg-neutral-950" initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: 0.98 }}>
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-white/10">
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-white">Queue #{selected.queue_number} details</h3>
                  <p className="text-xs text-muted">{dateTime(selected.created_at)} · {number(selected.total)} records</p>
                </div>
                <button type="button" onClick={() => setSelected(null)} className="rounded-xl p-2 hover:bg-gray-100 dark:hover:bg-white/10"><X className="h-5 w-5" /></button>
              </div>
              <div className="overflow-auto">
                <table className="w-full min-w-[980px] text-left text-xs">
                  <thead className="sticky top-0 bg-gray-50 dark:bg-neutral-900">
                    <tr>
                      {['Sr.', 'Last Name', 'Email', 'Subject Keyword', 'Interest Line', 'Status', 'Sent at'].map(label => <th key={label} className="px-4 py-3 text-[10px] uppercase tracking-wide text-gray-500">{label}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                    {detailsLoading ? (
                      <tr><td colSpan="7" className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand-500" /></td></tr>
                    ) : (details?.rows || []).map((row, index) => (
                      <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                        <td className="px-4 py-3">{index + 1}</td>
                        <td className="px-4 py-3 font-medium">{row.uploaded_last_name || row.last_name || '—'}</td>
                        <td className="px-4 py-3">{row.professor_email}</td>
                        <td className="px-4 py-3">{row.uploaded_subject_keyword || row.subject || '—'}</td>
                        <td className="max-w-[320px] px-4 py-3">{row.uploaded_interest_line || row.interest_line || '—'}</td>
                        <td className="px-4 py-3 font-semibold capitalize">{String(row.state || '').replaceAll('_', ' ')}</td>
                        <td className="px-4 py-3 text-muted">{dateTime(row.sent_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
