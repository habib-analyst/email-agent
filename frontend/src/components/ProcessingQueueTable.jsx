import React from 'react';
import { Globe, Loader2, RotateCcw, Send, Trash2, X, Zap } from 'lucide-react';

const stateStyle = {
  pending: 'bg-gray-100 text-gray-700 dark:bg-neutral-800 dark:text-gray-300',
  awaiting_proceed: 'bg-violet-100 text-violet-700 dark:bg-neutral-800 dark:text-violet-300',
  duplicate_review: 'bg-amber-100 text-amber-700 dark:bg-neutral-800 dark:text-amber-300',
  researching: 'bg-blue-100 text-blue-700 dark:bg-neutral-800 dark:text-blue-300',
  drafted: 'bg-indigo-100 text-indigo-700 dark:bg-neutral-800 dark:text-indigo-300',
  verified: 'bg-cyan-100 text-cyan-700 dark:bg-neutral-800 dark:text-cyan-300',
  sending: 'bg-sky-100 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300',
  sent: 'bg-emerald-100 text-emerald-700 dark:bg-neutral-800 dark:text-emerald-300',
  replied: 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-300',
  skipped: 'bg-slate-100 text-slate-700 dark:bg-neutral-800 dark:text-slate-300',
  needs_review: 'bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300',
  needs_web_research: 'bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300',
  duplicate: 'bg-gray-100 text-gray-700 dark:bg-neutral-900 dark:text-gray-300',
  not_found: 'bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300',
  send_limit: 'bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300',
};

function displayState(row) {
  if (row.failure_type === 'not_found') return { key: 'not_found', label: 'Email not found' };
  if (row.failure_type === 'send_limit' || /rate limit|send limit|user-rate/i.test(row.error || row.failure_reason || '')) {
    return { key: 'send_limit', label: 'Gmail limit' };
  }
  if (row.confirmed_sent_at && row.state !== 'replied') return { key: 'sent', label: 'Sent' };
  if (row.previously_contacted && ['pending', 'duplicate_review', 'skipped'].includes(row.state)) {
    return { key: 'duplicate', label: 'Duplicate' };
  }
  if (row.state === 'awaiting_proceed') return { key: row.state, label: 'Awaiting approval' };
  if (row.state === 'duplicate_review') return { key: row.state, label: 'Already sent' };
  if (row.state === 'needs_web_research') return { key: row.state, label: 'Needs research' };
  if (row.state === 'drafted') return { key: row.state, label: 'Drafting' };
  return { key: row.state, label: row.state || 'pending' };
}

function evidence(row) {
  if (row.failure_reason) return row.failure_reason;
  if (row.confirmed_sent_at) return `Confirmed in sent history · ${new Date(row.confirmed_sent_at).toLocaleString()}`;
  if (row.previously_contacted) return 'Matched against permanent sent history.';
  if (row.error === 'duplicate_skipped') return 'Skipped because this professor was already contacted.';
  if (row.error === 'rejected_by_user') return 'Rejected manually.';
  return row.error || '';
}

export default function ProcessingQueueTable({
  queue,
  onSend,
  onRejectDuplicate,
  onRetry,
  onProceed,
  onDelete,
  onWebSearch,
  onWebSearchBulk,
  webSearchingId,
  proceedingId,
  onSendAll,
  sendingAll = false,
  filter = 'all',
  onClearFilter,
}) {
  const [confirmSendAll, setConfirmSendAll] = React.useState(false);
  const matchesFilter = row => {
    if (!filter || filter === 'all') return true;
    if (filter === 'processing') return ['researching', 'drafted', 'verified', 'sending'].includes(row.state);
    if (filter === 'review') return ['awaiting_proceed', 'needs_review', 'verified'].includes(row.state);
    if (filter === 'duplicates') return row.state === 'duplicate_review' || row.error === 'duplicate_skipped' || !!row.previously_contacted;
    if (filter === 'failed') return ['failed', 'needs_review'].includes(row.state) || !!row.failure_type;
    if (filter === 'not_found') return row.failure_type === 'not_found';
    if (filter === 'send_limit') return row.failure_type === 'send_limit' || /rate limit|send limit|user-rate/i.test(row.error || row.failure_reason || '');
    return row.state === filter;
  };

  const rows = queue.filter(matchesFilter);
  const needsWebCount = rows.filter(row => row.state === 'needs_web_research').length;
  const counts = {
    pending: queue.filter(row => ['pending', 'awaiting_proceed'].includes(row.state)).length,
    working: queue.filter(row => ['researching', 'drafted', 'verified', 'sending'].includes(row.state)).length,
    sent: queue.filter(row => row.state === 'sent' || row.confirmed_sent_at).length,
    failed: queue.filter(row => ['failed', 'needs_review'].includes(row.state) || row.failure_type).length,
    duplicates: queue.filter(row => row.state === 'duplicate_review' || row.error === 'duplicate_skipped' || row.previously_contacted).length,
  };
  const safeSendCount = queue.filter(row => (
    ['pending', 'failed', 'sending', 'needs_review'].includes(row.state)
    && row.error !== 'rejected_by_user'
    && !row.confirmed_sent_at
    && !row.previously_contacted
    && !['not_found', 'delivery_failed'].includes(row.failure_type)
  )).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-[rgb(var(--text-secondary))]">Agent processing ledger</p>
          <p className="text-[9px] text-muted">{rows.length} of {queue.length} current-session rows · uploaded sheet values</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {Object.entries(counts).map(([label, value]) => (
            <span key={label} className="rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-muted))] px-2 py-1 text-[8px] font-bold uppercase text-muted">
              {value} {label}
            </span>
          ))}
        </div>
        {filter !== 'all' && (
          <button type="button" onClick={onClearFilter} className="text-[10px] font-semibold text-brand-600 hover:underline">
            {filter.replace(/_/g, ' ')} · Clear filter
          </button>
        )}
        {needsWebCount > 0 && onWebSearchBulk && (
          <button type="button" onClick={onWebSearchBulk} disabled={webSearchingId === 'bulk'} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium text-sky-700 hover:bg-sky-500/10 dark:text-sky-300">
            {webSearchingId === 'bulk' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
            Web search all ({needsWebCount})
          </button>
        )}
        {onSendAll && safeSendCount > 0 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (!confirmSendAll) {
                  setConfirmSendAll(true);
                  return;
                }
                onSendAll().finally(() => setConfirmSendAll(false));
              }}
              disabled={sendingAll}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-bold text-white shadow-sm transition disabled:opacity-60 ${
                confirmSendAll ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {sendingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              {confirmSendAll ? `Confirm ${safeSendCount} emails` : `Send All (${safeSendCount})`}
            </button>
            {confirmSendAll && (
              <button type="button" onClick={() => setConfirmSendAll(false)} className="rounded-lg px-2 py-1.5 text-[10px] font-semibold text-muted hover:bg-[rgb(var(--surface-muted))]">
                Cancel
              </button>
            )}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-card))]">
        <div className="max-h-[430px] overflow-auto">
          {!rows.length ? (
            <div className="px-4 py-10 text-center">
              <Zap className="mx-auto mb-2 h-6 w-6 text-muted/40" />
              <p className="text-xs text-muted">{queue.length ? 'No processing rows match this filter' : 'Import a sheet to create processing rows'}</p>
            </div>
          ) : (
            <table className="w-full min-w-[980px] text-xs">
              <thead className="sticky top-0 z-10 bg-[rgb(var(--surface-muted))]">
                <tr>
                  {['Sr.', 'Last Name', 'Email', 'Subject Keyword', 'Interest Line', 'Status', 'Actions'].map((column, index) => (
                    <th key={column} className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted ${index === 6 ? 'text-center' : 'text-left'}`}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgb(var(--border-subtle))]">
                {rows.map((row, index) => {
                  const status = displayState(row);
                  const detail = evidence(row);
                  const terminal = ['sent', 'replied'].includes(row.state) || !!row.confirmed_sent_at;
                  return (
                    <tr key={row.id} className="group transition-colors hover:bg-[rgb(var(--surface-muted))]/50">
                      <td className="px-3 py-2.5 text-muted tabular-nums">{index + 1}</td>
                      <td className="max-w-[140px] truncate px-3 py-2.5 font-semibold text-[rgb(var(--text-primary))]">{row.uploaded_last_name || row.last_name || '—'}</td>
                      <td className="max-w-[210px] truncate px-3 py-2.5 text-muted">{row.professor_email}</td>
                      <td className="max-w-[170px] truncate px-3 py-2.5 text-[10px] text-muted" title={row.uploaded_subject_keyword || ''}>{row.uploaded_subject_keyword || '—'}</td>
                      <td className="max-w-[280px] truncate px-3 py-2.5 text-[10px] text-muted" title={row.uploaded_interest_line || ''}>{row.uploaded_interest_line || '—'}</td>
                      <td className="px-3 py-2.5">
                        <div className="space-y-1">
                          <span className={`badge min-w-[82px] justify-center text-[9px] ${stateStyle[status.key] || stateStyle.pending}`}>
                            {['researching', 'drafted', 'verified', 'sending'].includes(row.state) && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                            {status.label}
                          </span>
                          {detail && <p className="max-w-[240px] text-[9px] leading-snug text-red-600 dark:text-red-300" title={detail}>{detail}</p>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className={`flex items-center justify-center gap-1 ${terminal ? 'opacity-40' : ''}`}>
                          {row.state === 'verified' && onSend && <button type="button" onClick={() => onSend(row.id)} className="rounded p-1 hover:bg-emerald-500/10" title="Send"><Send className="h-3.5 w-3.5 text-emerald-500" /></button>}
                          {row.state === 'duplicate_review' && onRejectDuplicate && <button type="button" onClick={() => onRejectDuplicate(row.id)} className="rounded p-1 hover:bg-gray-500/10" title="Reject duplicate"><X className="h-3.5 w-3.5 text-muted" /></button>}
                          {['failed', 'needs_review'].includes(row.state) && !row.previously_contacted && onRetry && <button type="button" onClick={() => onRetry(row.id)} className="rounded p-1 hover:bg-blue-500/10" title="Retry"><RotateCcw className="h-3.5 w-3.5 text-blue-500" /></button>}
                          {['awaiting_proceed', 'pending', 'failed', 'needs_review'].includes(row.state) && !row.previously_contacted && onProceed && <button type="button" onClick={() => onProceed(row.id)} disabled={proceedingId === row.id} className="rounded p-1 hover:bg-violet-500/10" title="Proceed">{proceedingId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" /> : <Zap className="h-3.5 w-3.5 text-violet-500" />}</button>}
                          {row.state === 'needs_web_research' && onWebSearch && <button type="button" onClick={() => onWebSearch(row.id)} disabled={webSearchingId === row.id} className="flex items-center gap-1 rounded-lg bg-sky-500/10 px-2 py-1 text-[9px] font-semibold text-sky-700 hover:bg-sky-500/20 dark:text-sky-300">{webSearchingId === row.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />} Search</button>}
                          {!terminal && onDelete && <button type="button" onClick={() => onDelete(row.id)} className="rounded p-1 hover:bg-red-500/10" title="Delete processing row"><Trash2 className="h-3.5 w-3.5 text-red-400" /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
