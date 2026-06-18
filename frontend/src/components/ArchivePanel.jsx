import React, { useEffect, useState } from 'react';
import { Archive, Search, Loader2 } from 'lucide-react';
import { get } from '../api.js';

const STATUS_STYLE = {
  sent: 'bg-emerald-100 text-emerald-700 dark:bg-neutral-800 dark:text-emerald-400',
  resent: 'bg-blue-100 text-blue-700 dark:bg-neutral-800 dark:text-blue-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  duplicate_blocked: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  duplicate_review: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
};

export default function ArchivePanel({ className = '' }) {
  const [stats, setStats] = useState(null);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = async (query = q) => {
    setLoading(true);
    try {
      const [s, c] = await Promise.all([
        get('/archive/stats'),
        get(`/archive/contacts?q=${encodeURIComponent(query)}&limit=50`),
      ]);
      setStats(s);
      setRows(c.rows || []);
      setTotal(c.total || 0);
    } catch {
      setRows([]);
    }
    setLoading(false);
  };

  useEffect(() => { load(''); }, []);

  return (
    <div className={`card space-y-4 ${className}`}>
      <div className="flex items-center gap-2">
        <Archive className="w-4 h-4 text-brand-500" />
        <div>
          <h3 className="font-semibold text-sm">Permanent Archive</h3>
          <p className="text-[10px] text-gray-500">Never cleared on reset — used for duplicate detection &amp; history</p>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            ['Sent', stats.sent],
            ['Unique emails', stats.uniqueEmails],
            ['Failed', stats.failed],
            ['Agent events', stats.agentEvents],
          ].map(([label, val]) => (
            <div key={label} className="p-2 rounded-lg bg-gray-50 dark:bg-neutral-800/50 border border-gray-100 dark:border-neutral-700">
              <p className="text-[10px] text-gray-500">{label}</p>
              <p className="text-sm font-bold tabular-nums">{val}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load(q)}
            placeholder="Search email, name, subject…"
            className="input text-xs pl-8 w-full"
          />
        </div>
        <button onClick={() => load(q)} className="btn-primary text-xs px-3 py-2">Search</button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading archive…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted text-center py-6">No archive records yet</p>
      ) : (
        <div className="overflow-auto max-h-[280px] border border-gray-100 dark:border-neutral-800 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-neutral-800 sticky top-0">
              <tr>
                <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-gray-500">Email</th>
                <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-gray-500">Name</th>
                <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-gray-500">Status</th>
                <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-gray-500">Mode</th>
                <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-gray-500">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-neutral-800/40">
                  <td className="px-2 py-2 truncate max-w-[140px] font-mono text-[10px]">{r.professor_email}</td>
                  <td className="px-2 py-2 truncate max-w-[80px]">{r.last_name || '—'}</td>
                  <td className="px-2 py-2">
                    <span className={`badge text-[9px] ${STATUS_STYLE[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
                  </td>
                  <td className="px-2 py-2 text-[10px] text-gray-500">{r.mode || '—'}</td>
                  <td className="px-2 py-2 text-[10px] text-muted whitespace-nowrap">
                    {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-muted">{total} total records in permanent archive</p>
    </div>
  );
}
