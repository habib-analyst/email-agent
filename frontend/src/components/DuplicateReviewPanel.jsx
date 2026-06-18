import React, { useEffect, useState } from 'react';
import { AlertTriangle, Send, X, Archive, Loader2, Trash2, Zap } from 'lucide-react';
import { get } from '../api.js';

function parseDuplicateError(error) {
  if (!error?.startsWith('duplicate_sent:')) return { sentAt: '', subject: '' };
  const parts = error.split(':');
  return { sentAt: parts[1] || '', subject: parts.slice(2).join(':') || '' };
}

/** Inline duplicate review — process, send again, skip, or delete. */
export default function DuplicateReviewPanel({
  items = [],
  duplicatePolicy,
  onProcess,
  onProcessAll,
  onSendAgain,
  onReject,
  onRejectAll,
  onDelete,
  className = '',
}) {
  const [archiveHints, setArchiveHints] = useState({});
  const [processAllConfirm, setProcessAllConfirm] = useState(false);
  const [rejectAllConfirm, setRejectAllConfirm] = useState(false);
  const [bulkWorking, setBulkWorking] = useState(null);

  useEffect(() => {
    if (!items.length) return;
    items.forEach(item => {
      const email = item.professor_email;
      if (!email || archiveHints[email]) return;
      get(`/archive/contacts/${encodeURIComponent(email)}`)
        .then(data => {
          const last = data.outreach?.[0];
          if (last) {
            setArchiveHints(prev => ({
              ...prev,
              [email]: { status: last.status, at: last.created_at, subject: last.subject, mode: last.mode },
            }));
          }
        })
        .catch(() => {});
    });
  }, [items, archiveHints]);

  if (!items.length) return null;

  const policyLabel = {
    review_always: 'Review duplicates',
    skip_always: 'Skip all duplicates',
    skip_within_days: 'Skip if sent recently',
    allow_after_days: 'Allow after cooldown',
  }[duplicatePolicy || 'review_always'] || 'Review duplicates';

  const runBulk = async (kind, handler) => {
    if (!handler) return;
    if (kind === 'process' && !processAllConfirm) {
      setProcessAllConfirm(true);
      setRejectAllConfirm(false);
      return;
    }
    if (kind === 'reject' && !rejectAllConfirm) {
      setRejectAllConfirm(true);
      setProcessAllConfirm(false);
      return;
    }
    setBulkWorking(kind);
    try {
      await handler(items.map(i => i.id));
      setProcessAllConfirm(false);
      setRejectAllConfirm(false);
    } finally {
      setBulkWorking(null);
    }
  };

  return (
    <div className={`card p-4 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 space-y-3 ${className}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">
            Duplicate emails need review — {items.length} professor{items.length !== 1 ? 's' : ''} need your decision
          </p>
          <p className="text-[10px] text-amber-700/90 dark:text-amber-300/90 mt-0.5">
            Policy: <strong>{policyLabel}</strong> · checked against permanent sent email history
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {onRejectAll && (
            <button type="button" onClick={() => runBulk('reject', onRejectAll)} disabled={!!bulkWorking} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-neutral-600 text-muted text-[10px] font-semibold hover:bg-white dark:hover:bg-neutral-800 disabled:opacity-60">
              {bulkWorking === 'reject' ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
              {rejectAllConfirm ? 'Confirm Reject All' : 'Reject All'}
            </button>
          )}
          {onProcessAll && (
            <button type="button" onClick={() => runBulk('process', onProcessAll)} disabled={!!bulkWorking} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-[10px] font-semibold disabled:opacity-60">
              {bulkWorking === 'process' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
              {processAllConfirm ? 'Confirm Process All' : 'Process All'}
            </button>
          )}
        </div>
      </div>
      {(processAllConfirm || rejectAllConfirm) && (
        <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-white dark:bg-neutral-900 border border-amber-100 dark:border-amber-900/30">
          <p className="text-[10px] text-amber-800 dark:text-amber-200">
            {processAllConfirm
              ? `Confirm to process all ${items.length} duplicate email${items.length === 1 ? '' : 's'} through the normal draft flow.`
              : `Confirm to reject all ${items.length} duplicate email${items.length === 1 ? '' : 's'} without sending.`}
          </p>
          <button type="button" onClick={() => { setProcessAllConfirm(false); setRejectAllConfirm(false); }} disabled={!!bulkWorking} className="text-[10px] text-muted px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-neutral-800">
            Cancel
          </button>
        </div>
      )}
      <div className="space-y-2 max-h-[280px] overflow-auto">
        {items.map(item => {
          const { sentAt, subject } = parseDuplicateError(item.error);
          const hint = archiveHints[item.professor_email];
          const isDuplicate = !!(hint || sentAt || item.error?.startsWith('duplicate_sent:'));
          return (
            <div key={item.id} className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg bg-white dark:bg-neutral-900 border border-amber-100 dark:border-amber-900/30">
              <div className="flex-1 min-w-[180px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[11px] font-mono font-medium text-gray-800 dark:text-gray-200 truncate">{item.professor_email}</p>
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${isDuplicate ? 'bg-amber-200/80 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
                    {isDuplicate ? 'Duplicate' : 'New'}
                  </span>
                </div>
                <p className="text-[10px] text-gray-500 truncate mt-0.5">
                  {hint ? (
                    <>Previously sent: {hint.at ? new Date(hint.at).toLocaleString() : '—'} · {hint.mode}</>
                  ) : sentAt ? (
                    <>Previously sent: {new Date(sentAt).toLocaleString()}</>
                  ) : (
                    'Matched in contact history'
                  )}
                </p>
                {(subject || hint?.subject) && (
                  <p className="text-[10px] text-muted truncate mt-0.5" title={subject || hint?.subject}>
                    Subject: {subject || hint?.subject}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                {onProcess && (
                  <button type="button" onClick={() => onProcess(item.id)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-[10px] font-semibold" title="Queue for normal processing">
                    <Zap className="w-3 h-3" /> Process
                  </button>
                )}
                {onSendAgain && (
                  <button type="button" onClick={() => onSendAgain(item.id)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-semibold" title="Send again immediately">
                    <Send className="w-3 h-3" /> Send
                  </button>
                )}
                {onReject && (
                  <button type="button" onClick={() => onReject(item.id)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-neutral-600 text-muted text-[10px] font-medium hover:bg-gray-50 dark:hover:bg-neutral-800">
                    <X className="w-3 h-3" /> Skip
                  </button>
                )}
                {onDelete && (
                  <button type="button" onClick={() => onDelete(item.id)} className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-red-200 dark:border-red-900/40 text-red-600 text-[10px] font-medium hover:bg-red-50 dark:hover:bg-red-900/20">
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted flex items-center gap-1">
        <Archive className="w-3 h-3 shrink-0" />
        Process = research &amp; draft like a new professor · Send = resend now · Skip = leave out · Delete = remove from queue
      </p>
    </div>
  );
}
