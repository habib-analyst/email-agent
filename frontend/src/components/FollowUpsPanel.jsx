import React, { useCallback, useEffect, useState } from 'react';
import { Clock, Loader2, RefreshCw, Send, SkipForward, Sparkles } from 'lucide-react';
import { get, post } from '../api.js';
import { useToast } from './Toast.jsx';
import { useEventStream } from '../core/EventStreamProvider.jsx';
import { formatDateTime12 } from '../utils/dateTime.js';

function plainText(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export default function FollowUpsPanel() {
  const toast = useToast();
  const { subscribe } = useEventStream();
  const [candidates, setCandidates] = useState([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get('/follow-ups');
      setCandidates(data.candidates || []);
      if (data.days) setDays(data.days);
    } catch (error) {
      toast.error(error.message || 'Could not load follow-ups');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribe(event => {
    if (event.type === 'follow_up_updated') load();
  }), [subscribe, load]);

  const run = async (key, action, success) => {
    setBusy(key);
    try {
      const result = await action();
      toast.success(result?.message || success);
      await load();
      return result;
    } catch (error) {
      toast.error(error.message || `${success} failed`);
      return null;
    } finally {
      setBusy('');
    }
  };

  const draft = row => run(
    `draft-${row.professor_email}`,
    () => post('/follow-ups/draft', { professor_email: row.professor_email }, { timeout: 120000 }),
    'Follow-up draft generated',
  );
  const send = row => {
    if (!window.confirm(`Send the follow-up to ${row.professor_email}? It will be sent in the original email thread.`)) return;
    run(
      `send-${row.professor_email}`,
      () => post('/follow-ups/send', { professor_email: row.professor_email }, { timeout: 120000 }),
      'Follow-up sent',
    );
  };
  const skip = row => run(
    `skip-${row.professor_email}`,
    () => post('/follow-ups/skip', { professor_email: row.professor_email }),
    'Follow-up skipped',
  );

  return (
    <section className="overflow-hidden rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-card))]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgb(var(--border-subtle))] px-4 py-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-brand-600" />
          <div>
            <h3 className="text-sm font-semibold text-[rgb(var(--text-primary))]">Follow-ups</h3>
            <p className="text-[10px] text-muted">Non-responders {days}+ days after first contact · drafts you review and send manually</p>
          </div>
        </div>
        <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border border-[rgb(var(--border-subtle))] px-3 py-1.5 text-[10px] font-semibold text-[rgb(var(--text-primary))] hover:bg-[rgb(var(--surface-muted))] disabled:opacity-50">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Refresh
        </button>
      </div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="sticky top-0 bg-[rgb(var(--surface-muted))] text-left text-[10px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2">Recipient</th>
              <th className="px-3 py-2">First sent</th>
              <th className="px-3 py-2">Days</th>
              <th className="px-3 py-2">Draft</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--border-subtle))]">
            {!candidates.length && (
              <tr><td colSpan="5" className="px-3 py-8 text-center text-muted">No professors are due for a follow-up right now.</td></tr>
            )}
            {candidates.map(row => {
              const rowBusy = busy.endsWith(row.professor_email);
              const hasDraft = row.workflow_status === 'drafted' && row.suggested_body;
              return (
                <tr key={row.professor_email}>
                  <td className="px-3 py-2 font-mono text-[11px]">{row.professor_email}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{formatDateTime12(row.sent_at, '-')}</td>
                  <td className="px-3 py-2 text-muted">{row.days_since}</td>
                  <td className="max-w-[280px] truncate px-3 py-2 text-muted" title={plainText(row.suggested_body)}>
                    {hasDraft ? plainText(row.suggested_body) : <span className="italic">not generated</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => draft(row)} disabled={rowBusy} className="inline-flex items-center gap-1 rounded border border-brand-200 px-2 py-1 text-[10px] text-brand-700 disabled:opacity-50">
                        {busy === `draft-${row.professor_email}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} {hasDraft ? 'Regenerate' : 'Generate'}
                      </button>
                      <button type="button" onClick={() => send(row)} disabled={rowBusy || !hasDraft} className="inline-flex items-center gap-1 rounded border border-emerald-200 px-2 py-1 text-[10px] text-emerald-700 disabled:opacity-50">
                        {busy === `send-${row.professor_email}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Send
                      </button>
                      <button type="button" onClick={() => skip(row)} disabled={rowBusy} className="inline-flex items-center gap-1 rounded border border-[rgb(var(--border-subtle))] px-2 py-1 text-[10px] text-muted disabled:opacity-50">
                        <SkipForward className="h-3 w-3" /> Skip
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
