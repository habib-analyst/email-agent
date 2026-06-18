import React from 'react';
import { Zap, Trash2, Send, RotateCcw, Loader2, X, Globe } from 'lucide-react';

const stateStyle = {
  pending: 'bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-gray-300',
  awaiting_proceed: 'bg-violet-100 dark:bg-neutral-800 text-violet-700 dark:text-violet-300',
  duplicate_review: 'bg-amber-100 dark:bg-neutral-800 text-amber-700 dark:text-amber-300',
  researching: 'bg-blue-100 dark:bg-neutral-800 text-blue-700 dark:text-blue-300',
  drafted: 'bg-indigo-100 dark:bg-neutral-800 text-indigo-700 dark:text-indigo-300',
  verified: 'bg-cyan-100 dark:bg-neutral-800 text-cyan-700 dark:text-cyan-400',
  scheduled: 'bg-cyan-100 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-400',
  sent: 'bg-emerald-100 dark:bg-neutral-800 text-emerald-700 dark:text-emerald-400',
  sent_fallback: 'bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400',
  failed: 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400',
  skipped: 'bg-slate-100 dark:bg-neutral-800 text-slate-700 dark:text-slate-400',
  duplicate: 'bg-gray-100 dark:bg-neutral-900/20 text-gray-700 dark:text-gray-400',
  needs_review: 'bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400',
  needs_web_research: 'bg-amber-100 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300',
  replied: 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400',
};

function stateLabel(q) {
  if (q.state === 'awaiting_proceed') return 'Awaiting';
  if (q.state === 'duplicate_review') return 'Already Sent';
  if (q.state === 'needs_web_research') return 'No page info';
  if (q.state === 'skipped' && q.error === 'duplicate_skipped') return 'Duplicate';
  if (q.state === 'sent' && q.error === 'fallback_no_research') return 'Fallback';
  return q.state;
}

function stateKey(q) {
  if (q.state === 'awaiting_proceed') return 'awaiting_proceed';
  if (q.state === 'duplicate_review') return 'duplicate_review';
  if (q.state === 'needs_web_research') return 'needs_web_research';
  if (q.state === 'skipped' && q.error === 'duplicate_skipped') return 'duplicate';
  if (q.state === 'sent' && q.error === 'fallback_no_research') return 'sent_fallback';
  return q.state;
}

function queueErrorText(error) {
  if (!error) return '';
  if (error === 'duplicate_skipped') return 'Skipped because this professor was already contacted.';
  if (error === 'fallback_no_research') return 'Sent with fallback content because research was limited.';
  if (error === 'rejected_by_user') return 'Rejected manually.';
  if (error.startsWith('duplicate_sent:')) return 'Already contacted before. Review before sending again.';
  return error;
}

function researchLabel(q) {
  if (q.state === 'needs_web_research') return 'No info on page';
  try {
    const d = JSON.parse(q.dossier || '{}');
    if (d.profile_research_status === 'profile_found') return 'From page';
    if (d.profile_research_status === 'web_complete') return 'From web';
    if (d.profile_research_status === 'none_on_page') return 'No info on page';
    if (d.subject_keyword && d.interest_line) return 'Keywords ready';
  } catch {}
  return '—';
}

export default function ProcessingQueueTable({
  queue,
  onClearCompleted,
  onSend,
  onSendAgain,
  onRejectDuplicate,
  onProcessDuplicate,
  onRetry,
  onProceed,
  onDelete,
  onWebSearch,
  onWebSearchBulk,
  webSearchingId,
  proceedingId,
}) {
  const needsWebCount = queue.filter(q => q.state === 'needs_web_research').length;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[rgb(var(--text-secondary))]">Processing queue</span>
        <span className="text-[10px] text-muted">{queue.length} items</span>
        {needsWebCount > 0 && onWebSearchBulk && (
          <button
            type="button"
            onClick={onWebSearchBulk}
            disabled={webSearchingId === 'bulk'}
            className="text-[10px] font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-500/10 px-2 py-1 rounded-lg flex items-center gap-1"
          >
            {webSearchingId === 'bulk' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Globe className="w-3 h-3" />}
            Web search all ({needsWebCount})
          </button>
        )}
        {queue.some(q => ['sent', 'skipped'].includes(q.state)) && onClearCompleted && (
          <button
            type="button"
            onClick={onClearCompleted}
            className="text-[10px] font-medium text-muted hover:text-brand-600 px-2 py-1 rounded-lg hover:bg-[rgb(var(--surface-muted))] transition-colors flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" /> Clear completed
          </button>
        )}
      </div>
      <div className="rounded-xl border border-[rgb(var(--border-subtle))] overflow-hidden bg-[rgb(var(--surface-card))]">
        <div className="overflow-auto max-h-[360px]">
          {queue.length === 0 && (
            <div className="text-center py-8 px-4">
              <Zap className="w-6 h-6 text-muted/40 mx-auto mb-2" />
              <p className="text-xs text-muted">Import professors to populate the queue</p>
            </div>
          )}
          {queue.length > 0 && (
            <table className="w-full text-xs">
              <thead className="bg-[rgb(var(--surface-muted))] sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-muted text-[10px] uppercase tracking-wider">Name</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted text-[10px] uppercase tracking-wider">Email</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted text-[10px] uppercase tracking-wider">Research</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted text-[10px] uppercase tracking-wider">Status</th>
                  <th className="px-3 py-2 text-center font-semibold text-muted text-[10px] uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgb(var(--border-subtle))]">
                {queue.slice(0, 50).map((q) => {
                  const hasActions = q.state !== 'sent' && q.state !== 'researching';
                  return (
                    <tr key={q.id} className="hover:bg-[rgb(var(--surface-muted))]/50 transition-colors group">
                      <td className="px-3 py-2.5 text-[rgb(var(--text-primary))] truncate max-w-[120px]">
                        {q.professor_email?.split('@')[0] || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-muted truncate max-w-[180px]">{q.professor_email}</td>
                      <td className="px-3 py-2.5 text-[10px] text-muted max-w-[120px]">
                        <span className={researchLabel(q) === 'No info on page' ? 'text-amber-700 dark:text-amber-400 font-medium' : ''}>
                          {researchLabel(q)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="space-y-1">
                          <span className={`badge text-[9px] min-w-[72px] justify-center ${stateStyle[stateKey(q)] || ''}`}>
                            {stateLabel(q)}
                          </span>
                          {queueErrorText(q.error) && (
                            <p className="max-w-[220px] text-[10px] leading-snug text-red-600 dark:text-red-400" title={queueErrorText(q.error)}>
                              {queueErrorText(q.error)}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <div className={`flex items-center justify-center gap-0.5 ${hasActions ? 'opacity-100' : 'opacity-40'} transition-opacity`}>
                          {q.state === 'verified' && onSend && (
                            <button type="button" onClick={() => onSend(q.id)} className="p-1 rounded hover:bg-emerald-500/10" title="Approve">
                              <Send className="w-3 h-3 text-emerald-500" />
                            </button>
                          )}
                          {q.state === 'duplicate_review' && onProcessDuplicate && (
                            <button type="button" onClick={() => onProcessDuplicate(q.id)} className="p-1 rounded hover:bg-violet-500/10" title="Process">
                              <Zap className="w-3 h-3 text-violet-500" />
                            </button>
                          )}
                          {q.state === 'duplicate_review' && onSendAgain && (
                            <button type="button" onClick={() => onSendAgain(q.id)} className="p-1 rounded hover:bg-emerald-500/10" title="Send Again">
                              <Send className="w-3 h-3 text-emerald-500" />
                            </button>
                          )}
                          {q.state === 'duplicate_review' && onRejectDuplicate && (
                            <button type="button" onClick={() => onRejectDuplicate(q.id)} className="p-1 rounded hover:bg-[rgb(var(--surface-muted))]" title="Don't Send">
                              <X className="w-3 h-3 text-muted" />
                            </button>
                          )}
                          {['failed', 'needs_review', 'skipped'].includes(q.state) && onRetry && (
                            <button type="button" onClick={() => onRetry(q.id)} className="p-1 rounded hover:bg-blue-500/10" title="Retry">
                              <RotateCcw className="w-3 h-3 text-blue-500" />
                            </button>
                          )}
                          {['awaiting_proceed', 'pending', 'failed', 'needs_review', 'skipped'].includes(q.state) && onProceed && (
                            <button type="button" onClick={() => onProceed(q.id)} disabled={proceedingId === q.id} className="p-1 rounded hover:bg-violet-500/10" title="Proceed">
                              {proceedingId === q.id ? <Loader2 className="w-3 h-3 text-violet-500 animate-spin" /> : <Zap className="w-3 h-3 text-violet-500" />}
                            </button>
                          )}
                          {q.state === 'needs_web_research' && onWebSearch && (
                            <button type="button" onClick={() => onWebSearch(q.id)} disabled={webSearchingId === q.id} className="px-2 py-1 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-[9px] font-semibold text-sky-700 dark:text-sky-300 flex items-center gap-1" title="Search publications on the internet">
                              {webSearchingId === q.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Globe className="w-3 h-3" />}
                              Web search
                            </button>
                          )}
                          {onDelete && (
                            <button type="button" onClick={() => onDelete(q.id)} className="p-1 rounded hover:bg-red-500/10" title="Delete">
                              <Trash2 className="w-3 h-3 text-red-400" />
                            </button>
                          )}
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
