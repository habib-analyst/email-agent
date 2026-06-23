import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, Loader2, RefreshCw, MailOpen, MousePointerClick, Reply } from 'lucide-react';
import { get } from '../api.js';
import { useToast } from './Toast.jsx';
import { useEventStream } from '../core/EventStreamProvider.jsx';

function Stat({ icon: Icon, label, value, sub }) {
  return (
    <div className="flex-1 min-w-[140px] rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-slate-500 text-xs font-medium uppercase tracking-wide">
        <Icon className="w-4 h-4" /> {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-800">{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-400">{sub}</div> : null}
    </div>
  );
}

export default function EngagementPanel() {
  const toast = useToast();
  const { subscribe } = useEventStream();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await get('/tracking/summary'));
    } catch (error) {
      toast.error(error.message || 'Could not load engagement stats');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribe(event => {
    if (event.type === 'sent_history_updated' || event.type === 'reply_updated') load();
  }), [subscribe, load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Open & click rates from tracked outreach, plus reply rate. Tracking is privacy-light (1×1 pixel + link redirect) and can be disabled via <code>EMAIL_TRACKING_ENABLED=false</code>.
        </p>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
        </button>
      </div>

      {!summary ? (
        <div className="text-sm text-slate-400">{loading ? 'Loading…' : 'No data yet.'}</div>
      ) : (
        <>
          {!summary.enabled && (
            <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
              Tracking is currently disabled — new sends will not be measured.
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <Stat icon={MailOpen} label="Open rate" value={`${summary.open_rate}%`} sub={`${summary.opened}/${summary.tracked} tracked opened`} />
            <Stat icon={MousePointerClick} label="Click rate" value={`${summary.click_rate}%`} sub={`${summary.clicked}/${summary.tracked} clicked a link`} />
            <Stat icon={Reply} label="Reply rate" value={`${summary.reply_rate}%`} sub={`${summary.replied}/${summary.sent} recipients replied`} />
          </div>

          {summary.by_mode?.length > 0 && (
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Mode</th>
                    <th className="px-3 py-2 font-medium">Tracked</th>
                    <th className="px-3 py-2 font-medium">Open rate</th>
                    <th className="px-3 py-2 font-medium">Click rate</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.by_mode.map(row => (
                    <tr key={row.mode} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{row.mode}</td>
                      <td className="px-3 py-2 text-slate-600">{row.tracked}</td>
                      <td className="px-3 py-2 text-slate-600">{row.open_rate}%</td>
                      <td className="px-3 py-2 text-slate-600">{row.click_rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
