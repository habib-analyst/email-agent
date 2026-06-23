import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive, Search, Loader2, Mail, Eye, X, MessageSquare,
  Paperclip, RefreshCw, ChevronLeft, ChevronRight, Maximize2, Minimize2,
} from 'lucide-react';
import { get } from '../api.js';
import { formatDateTime12 } from '../utils/dateTime.js';
import { useEventStream } from '../core/EventStreamProvider.jsx';

function SentBodyFrame({ html }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const body = html || '<p style="color:#6b7280">The original email body is not available in Gmail or the saved draft.</p>';
    ref.current.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
      body{margin:0;padding:24px;font:14px/1.65 Arial,sans-serif;color:#202124;background:#fff}
      p{margin:0 0 14px} img{max-width:100%} a{color:#0b57d0}
    </style></head><body>${body}</body></html>`;
  }, [html]);
  return <iframe ref={ref} title="Original sent email" sandbox="allow-same-origin" className="h-full min-h-[360px] w-full bg-white" />;
}

function SentEmailView({ id, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    get(`/archive/sent/${id}`, { timeout: 30000 })
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [id]);

  return createPortal(
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-6">
      <button type="button" className="absolute inset-0" aria-label="Close sent email" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900">
        <div className="flex items-center justify-between bg-[#40464f] px-5 py-3 text-white">
          <div className="flex min-w-0 items-center gap-2">
            <Mail className="h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Original sent email</p>
              <p className="truncate text-[10px] text-gray-300">Actual Gmail composition and connected replies</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1.5 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
        {loading ? (
          <div className="flex min-h-[480px] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div>
        ) : !detail ? (
          <div className="p-8 text-center text-sm text-muted">Sent email could not be loaded.</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto bg-gray-100 p-3 dark:bg-neutral-950 sm:p-5">
            <div className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
              <div className="border-b border-gray-200 px-5 py-4 dark:border-neutral-700">
                <p className="text-base font-semibold text-gray-900 dark:text-white">{detail.sent.subject || '(No subject)'}</p>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div><span className="text-muted">From: </span><span className="font-medium">{detail.sender.name ? `${detail.sender.name} <${detail.sender.email}>` : detail.sender.email || 'Connected Gmail'}</span></div>
                  <div><span className="text-muted">To: </span><span className="font-medium">{detail.sent.professor_email}</span></div>
                  <div><span className="text-muted">Sent: </span><span className="font-medium">{formatDateTime12(detail.gmailSnapshot?.internalDate || detail.sent.sent_at)}</span></div>
                  <div><span className="text-muted">Message ID: </span><span className="font-mono text-[10px]">{detail.sent.message_id || '—'}</span></div>
                </div>
              </div>
              <div className="h-[440px]"><SentBodyFrame html={detail.html} /></div>
              <div className="flex items-center gap-2 border-t border-gray-200 px-5 py-3 text-xs text-muted dark:border-neutral-700">
                <Paperclip className="h-3.5 w-3.5" />
                {detail.resumeName} · body source: {detail.bodySource === 'gmail' ? 'actual Gmail message' : detail.bodySource === 'stored_draft' ? 'saved draft' : 'unavailable'}
              </div>
            </div>

            <div className="mx-auto mt-4 max-w-4xl space-y-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-violet-600" />
                <h4 className="text-sm font-semibold">Replies ({detail.replies.length})</h4>
              </div>
              {detail.replies.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white p-5 text-center text-xs text-muted dark:border-neutral-700 dark:bg-neutral-900">No reply is connected to this professor yet.</div>
              ) : detail.replies.map(reply => (
                <div key={reply.id} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`badge text-[9px] ${reply.classification === 'positive' ? 'bg-emerald-100 text-emerald-700' : reply.classification === 'negative' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{reply.classification || 'unclassified'}</span>
                      <span className="text-[10px] text-muted">{formatDateTime12(reply.received_at)}</span>
                    </div>
                    <span className="text-[10px] text-muted">{reply.replied_by_user ? 'Replied by user: Yes' : 'Replied by user: No'}</span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-gray-700 dark:text-gray-200">{reply.reply_body || reply.summary || 'Reply body unavailable'}</p>
                  {reply.reply_sent_at && <p className="mt-2 text-[10px] font-medium text-emerald-600">Your reply sent {formatDateTime12(reply.reply_sent_at)}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function SentArchiveModal({ onClose, refreshSignal = 0 }) {
  const [q, setQ] = useState('');
  const [result, setResult] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [viewId, setViewId] = useState(null);
  const [error, setError] = useState('');
  const [maximized, setMaximized] = useState(false);
  const limit = 200;

  const load = (nextOffset = offset, query = q) => {
    setLoading(true);
    setError('');
    get(`/archive/sent?q=${encodeURIComponent(query)}&limit=${limit}&offset=${nextOffset}`)
      .then(data => setResult({
        rows: Array.isArray(data?.rows) ? data.rows : [],
        total: Number(data?.total) || 0,
      }))
      .catch(loadError => {
        setResult({ rows: [], total: 0 });
        setError(loadError.message || 'Could not load sent email archive');
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(0, ''); }, []);
  useEffect(() => {
    if (!refreshSignal) return;
    load(offset, q);
  }, [refreshSignal]);

  return createPortal(
    <>
      <div className={`fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 backdrop-blur-sm ${maximized ? 'p-0' : 'p-3 sm:p-6'}`}>
        <button type="button" className="absolute inset-0" aria-label="Close sent archive" onClick={onClose} />
        <div className={`relative flex w-full flex-col overflow-hidden border border-gray-200 bg-white shadow-2xl transition-all dark:border-neutral-700 dark:bg-neutral-900 ${
          maximized
            ? 'h-screen max-h-screen max-w-none rounded-none'
            : 'max-h-[92vh] max-w-7xl rounded-2xl'
        }`}>
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-neutral-700">
            <div>
              <h3 className="text-base font-semibold">Sent email archive</h3>
              <p className="text-[11px] text-muted">{result.total} actual sent messages · newest first</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMaximized(value => !value)}
                className="rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-neutral-800"
                title={maximized ? 'Restore window' : 'Maximize'}
                aria-label={maximized ? 'Restore sent archive window' : 'Maximize sent archive'}
              >
                {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-neutral-800"><X className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 border-b border-gray-100 p-4 dark:border-neutral-800">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input value={q} onChange={event => setQ(event.target.value)} onKeyDown={event => {
                if (event.key === 'Enter') { setOffset(0); load(0, q); }
              }} placeholder="Search email, professor, university, subject, or batch…" className="input w-full pl-9 text-xs" />
            </div>
            <button type="button" onClick={() => { setOffset(0); load(0, q); }} className="btn-primary px-4 text-xs">Search</button>
            <button type="button" onClick={() => load()} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800" title="Refresh"><RefreshCw className="h-4 w-4" /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[1200px] text-[11px]">
              <thead className="sticky top-0 z-10 bg-gray-50 text-left text-gray-500 dark:bg-neutral-800">
                <tr>
                  <th className="px-3 py-2.5">Sent time</th><th className="px-3 py-2.5">Professor email</th>
                  <th className="px-3 py-2.5">Last name</th><th className="px-3 py-2.5">University</th>
                  <th className="px-3 py-2.5">Subject</th><th className="px-3 py-2.5">Mode</th>
                  <th className="px-3 py-2.5">Batch</th><th className="px-3 py-2.5">Replies</th>
                  <th className="px-3 py-2.5">Latest reply</th><th className="px-3 py-2.5">Message ID</th>
                  <th className="px-3 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-neutral-800">
                {loading ? (
                  <tr><td colSpan="11" className="py-16 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-blue-600" /></td></tr>
                ) : error ? (
                  <tr><td colSpan="11" className="py-16 text-center">
                    <p className="text-sm font-medium text-red-600">{error}</p>
                    <button type="button" onClick={() => load()} className="mt-3 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white">Retry</button>
                  </td></tr>
                ) : result.rows.length === 0 ? (
                  <tr><td colSpan="11" className="py-16 text-center text-sm text-muted">No sent emails found.</td></tr>
                ) : result.rows.map(row => (
                  <tr key={row.id} className="hover:bg-blue-50/50 dark:hover:bg-neutral-800/60">
                    <td className="whitespace-nowrap px-3 py-2.5">{formatDateTime12(row.sent_at)}</td>
                    <td className="max-w-[220px] truncate px-3 py-2.5 font-mono" title={row.professor_email}>{row.professor_email}</td>
                    <td className="px-3 py-2.5">{row.last_name || '—'}</td><td className="px-3 py-2.5">{row.university || '—'}</td>
                    <td className="max-w-[300px] truncate px-3 py-2.5 font-medium" title={row.subject}>{row.subject || '—'}</td>
                    <td className="px-3 py-2.5">{row.mode || '—'}</td><td className="px-3 py-2.5">{row.batch_id ? `#${row.batch_id}` : '—'}</td>
                    <td className="px-3 py-2.5">{row.reply_count || 0}</td>
                    <td className="px-3 py-2.5">{row.latest_reply_classification || '—'}{row.latest_reply_at ? ` · ${formatDateTime12(row.latest_reply_at)}` : ''}</td>
                    <td className="max-w-[140px] truncate px-3 py-2.5 font-mono text-[9px]" title={row.message_id}>{row.message_id || '—'}</td>
                    <td className="px-3 py-2.5 text-right"><button type="button" onClick={() => setViewId(row.id)} className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 font-semibold text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300"><Eye className="h-3 w-3" /> View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-neutral-700">
            <span className="text-[10px] text-muted">Showing {result.rows.length ? offset + 1 : 0}–{Math.min(offset + result.rows.length, result.total)} of {result.total}</span>
            <div className="flex gap-2">
              <button type="button" disabled={offset === 0 || loading} onClick={() => { const next = Math.max(0, offset - limit); setOffset(next); load(next); }} className="rounded-lg border p-2 disabled:opacity-40 dark:border-neutral-700"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" disabled={offset + limit >= result.total || loading} onClick={() => { const next = offset + limit; setOffset(next); load(next); }} className="rounded-lg border p-2 disabled:opacity-40 dark:border-neutral-700"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
      </div>
      {viewId && <SentEmailView id={viewId} onClose={() => setViewId(null)} />}
    </>,
    document.body,
  );
}

export default function ArchivePanel({ className = '', openSentArchiveSignal = 0 }) {
  const { subscribe } = useEventStream();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSentArchive, setShowSentArchive] = useState(false);
  const [archiveRefreshSignal, setArchiveRefreshSignal] = useState(0);
  const refreshTimerRef = useRef(null);
  useEffect(() => {
    if (openSentArchiveSignal) setShowSentArchive(true);
  }, [openSentArchiveSignal]);

  const load = async () => {
    setLoading(true);
    try {
      setStats(await get('/archive/stats'));
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => subscribe(event => {
    if (!['sent_history_updated', 'sent', 'scheduled_draft_sent', 'startup_reconciled'].includes(event.type)) return;
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      load();
      setArchiveRefreshSignal(value => value + 1);
    }, 350);
  }), [subscribe]);
  useEffect(() => () => clearTimeout(refreshTimerRef.current), []);

  return (
    <div className={`card space-y-4 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Archive className="h-4 w-4 text-brand-500" />
          <div>
            <h3 className="text-sm font-semibold">Permanent Archive</h3>
            <p className="text-[10px] text-gray-500">Never cleared on reset — used for duplicate detection and history</p>
          </div>
        </div>
        <button type="button" onClick={() => setShowSentArchive(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-blue-700">
          <Mail className="h-3.5 w-3.5" /> View sent emails
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-5 text-xs text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading archive totals…</div>
      ) : stats && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Sent', stats.sent], ['Unique emails', stats.uniqueEmails],
            ['Failed', stats.failed], ['Agent events', stats.agentEvents],
          ].map(([label, val]) => (
            <div key={label} className="rounded-lg border border-gray-100 bg-gray-50 p-2 dark:border-neutral-700 dark:bg-neutral-800/50">
              <p className="text-[10px] text-gray-500">{label}</p>
              <p className="text-sm font-bold tabular-nums">{val}</p>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted">Open the sent email archive to search and inspect complete sent-message history.</p>
      {showSentArchive && <SentArchiveModal onClose={() => setShowSentArchive(false)} refreshSignal={archiveRefreshSignal} />}
    </div>
  );
}
