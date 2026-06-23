import React, { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Send, X } from 'lucide-react';
import { post } from '../api.js';
import { useToast } from './Toast.jsx';
import { formatDateTime12 } from '../utils/dateTime.js';

export default function DeliveryFailuresPanel({
  failures = [],
  onRefresh,
  filter = 'all',
  onClearFilter,
  mode = 'instant',
}) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const rows = useMemo(() => failures.filter(row => {
    if (!filter || filter === 'all' || filter === 'failed') return true;
    return row.failure_type === filter;
  }), [failures, filter]);

  const run = async (key, action, success) => {
    setBusy(key);
    try {
      const result = await action();
      toast.success(result?.message || success);
      await onRefresh?.();
    } catch (error) {
      toast.error(error.message || `${success} failed`);
    } finally {
      setBusy('');
    }
  };

  const scan = () => run('scan', () => post('/delivery-failures/scan', {}, { timeout: 180000 }), 'Gmail scan complete');
  const resend = row => {
    if (!window.confirm(`Resend the saved outreach to ${row.professor_email}? This failure can be resent only once.`)) return;
    run(`send-${row.id}`, () => post(`/delivery-failures/${row.id}/send`, { confirm: true }, { timeout: 120000 }), 'Email resent');
  };
  const reject = row => run(`reject-${row.id}`, () => post(`/delivery-failures/${row.id}/reject`, {}, { timeout: 30000 }), 'Failure rejected');

  return (
    <section className="overflow-hidden rounded-xl border border-red-200 bg-red-50/70 dark:border-red-900/40 dark:bg-red-950/10">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-red-200 px-4 py-3 dark:border-red-900/40">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <div>
            <h3 className="text-sm font-semibold text-red-800 dark:text-red-300">Delivery failures</h3>
            <p className="text-[10px] text-red-700/80 dark:text-red-300/80">{mode} Gmail bounces and send limits</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {filter !== 'all' && <button type="button" onClick={onClearFilter} className="text-[10px] font-semibold text-red-700 hover:underline">Clear {filter.replace(/_/g, ' ')}</button>}
          <button type="button" onClick={scan} disabled={busy === 'scan'} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[10px] font-semibold text-red-700 disabled:opacity-50 dark:bg-neutral-900">
            {busy === 'scan' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Scan Gmail
          </button>
        </div>
      </div>
      <div className="max-h-[340px] overflow-auto bg-[rgb(var(--surface-card))]">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="sticky top-0 bg-[rgb(var(--surface-muted))] text-left text-[10px] uppercase tracking-wider text-muted">
            <tr><th className="px-3 py-2">Email</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2">Received</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--border-subtle))]">
            {!rows.length && <tr><td colSpan="6" className="px-3 py-8 text-center text-muted">No delivery failures match this view.</td></tr>}
            {rows.map(row => (
              <tr key={row.id}>
                <td className="px-3 py-2 font-mono text-[11px]">{row.professor_email}</td>
                <td className="px-3 py-2">{row.failure_type?.replace(/_/g, ' ')}</td>
                <td className="max-w-[280px] truncate px-3 py-2 text-muted" title={row.reason}>{row.reason || '-'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-muted">{formatDateTime12(row.received_at, '-')}</td>
                <td className="px-3 py-2">{row.status || 'pending'}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    {row.status === 'pending' && <button type="button" onClick={() => resend(row)} disabled={!!busy} className="inline-flex items-center gap-1 rounded border border-emerald-200 px-2 py-1 text-[10px] text-emerald-700 disabled:opacity-50"><Send className="h-3 w-3" /> Resend</button>}
                    {row.status === 'pending' && <button type="button" onClick={() => reject(row)} disabled={!!busy} className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-[10px] text-red-600 disabled:opacity-50"><X className="h-3 w-3" /> Reject</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
