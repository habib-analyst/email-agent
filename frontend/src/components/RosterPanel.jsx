import React, { useState, useCallback } from 'react';
import { FileSpreadsheet, Download, Trash2, Clock, Maximize2, Minimize2, Pencil, Save, X } from 'lucide-react';
import { post, put } from '../api.js';

const STATE_COLORS = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  researching: 'bg-blue-100 text-blue-700 dark:bg-neutral-800 dark:text-blue-400',
  drafted: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  verified: 'bg-indigo-100 text-indigo-700 dark:bg-neutral-800 dark:text-indigo-400',
  awaiting_proceed: 'bg-violet-100 text-violet-700 dark:bg-neutral-800 dark:text-violet-400',
  sent: 'bg-emerald-100 text-emerald-700 dark:bg-neutral-800 dark:text-emerald-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  skipped: 'bg-gray-200 text-gray-700 dark:bg-neutral-800 dark:text-gray-400',
  replied: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  duplicate_review: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  needs_review: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
};

function StateBadge({ state }) {
  const cls = STATE_COLORS[state] || 'bg-gray-200 text-gray-700 dark:bg-neutral-800 dark:text-gray-400';
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold ${cls}`}>{state || '—'}</span>;
}

function formatDuration(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

const EDITABLE_COLS = ['full_name', 'email', 'interest_line'];

export default function RosterPanel({ rows, activeEmail, onClear, onSave, mode = 'instant' }) {
  const exportSuffix = mode !== 'instant' ? `?mode=${mode}` : '';
  const [fullscreen, setFullscreen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState(null);
  const [saving, setSaving] = useState(false);

  const startEdit = useCallback(() => {
    const data = rows.map(r => ({
      id: r.id,
      full_name: r.full_name || '',
      email: r.email || '',
      interest_line: r.research_interest || r.interest_line || '',
    }));
    setEditData(data);
    setEditing(true);
  }, [rows]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditData(null);
  }, []);

  const updateField = useCallback((id, field, value) => {
    setEditData(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }, []);

  const handleSave = useCallback(async () => {
    if (!editData) return;
    setSaving(true);
    try {
      for (const row of editData) {
        await put(`/professor/${row.id}`, { full_name: row.full_name, interest_line: row.interest_line });
      }
      onSave?.();
      setEditing(false);
      setEditData(null);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  }, [editData, onSave]);

  if (!rows?.length && !onClear) return null;

  const displayRows = editing ? editData : rows;

  const content = (
    <div className={`card !p-0 overflow-hidden ${fullscreen ? 'rounded-none border-none shadow-none' : ''}`}>
      <div className="px-4 py-3 border-b border-gray-200 dark:border-neutral-700 flex items-center justify-between gap-3 bg-white dark:bg-neutral-900">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2 text-gray-900 dark:text-gray-100">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Professor Excel Roster
          </h3>
          <p className="text-[10px] text-muted mt-0.5">
            {rows.length} rows · agent processes one-by-one from this sheet
          </p>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button onClick={handleSave} disabled={saving}
                className="text-[10px] px-3 py-1.5 flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-medium disabled:opacity-50 transition-colors">
                {saving ? <Clock className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
              </button>
              <button onClick={cancelEdit}
                className="text-[10px] px-3 py-1.5 flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-neutral-600 text-muted hover:bg-gray-100 dark:hover:bg-neutral-800 font-medium transition-colors">
                <X className="w-3 h-3" /> Cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={startEdit}
                className="text-[10px] px-3 py-1.5 flex items-center gap-1.5 rounded-lg border border-blue-200 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 font-medium transition-colors">
                <Pencil className="w-3 h-3" /> Edit
              </button>
              {onClear && (
                <button onClick={onClear}
                  className="text-[10px] px-3 py-1.5 flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium transition-colors">
                  <Trash2 className="w-3 h-3" /> Clear
                </button>
              )}
            </>
          )}
          <a href={`/api/roster.csv${exportSuffix}`} className="btn-secondary text-[10px] px-3 py-1.5 flex items-center gap-1.5">
            <Download className="w-3 h-3" /> CSV
          </a>
          <a href={`/api/roster.xlsx${exportSuffix}`} className="btn-primary text-[10px] px-3 py-1.5 flex items-center gap-1.5">
            <Download className="w-3 h-3" /> Excel
          </a>
          <button onClick={() => setFullscreen(!fullscreen)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
            title={fullscreen ? 'Minimize' : 'Maximize'}>
            {fullscreen ? <Minimize2 className="w-4 h-4 text-muted" /> : <Maximize2 className="w-4 h-4 text-muted" />}
          </button>
        </div>
      </div>
      <div className={`overflow-auto ${fullscreen ? 'max-h-[calc(100vh-120px)]' : 'max-h-[320px]'}`}>
        <table className="w-full text-[11px] border-collapse">
          <thead className="bg-emerald-50 dark:bg-emerald-950/40 sticky top-0 border-b border-gray-200 dark:border-neutral-700">
            <tr className="text-left text-muted">
              <th className="px-3 py-2 font-semibold whitespace-nowrap">Name</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap">Email</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap max-w-[160px]">Interest</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap">State</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap">
                <Clock className="w-3 h-3 inline" /> Time
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-neutral-900">
            {displayRows.slice(0, 300).map((r, i) => {
              const isActive = !editing && activeEmail && r.email === activeEmail;
              const durationMs = !editing ? (r.total_duration_ms || r.research_duration_ms) : null;
              return (
                <tr
                  key={r.id || `${r.email}-${i}`}
                  className={`border-b border-gray-100 dark:border-neutral-800 ${isActive ? 'bg-blue-50 dark:bg-neutral-800 ring-1 ring-inset ring-blue-400/30' : i % 2 ? 'bg-gray-50/50 dark:bg-neutral-800/30' : 'bg-white dark:bg-neutral-900'}`}
                >
                  <td className="px-3 py-2 font-medium max-w-[140px] truncate text-gray-900 dark:text-gray-100">
                    {editing ? (
                      <input type="text" value={r.full_name} onChange={e => updateField(r.id, 'full_name', e.target.value)}
                        className="w-full bg-gray-50 dark:bg-neutral-800 border border-gray-300 dark:border-neutral-600 rounded px-2 py-1 text-[11px] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    ) : (r.full_name || '—')}
                  </td>
                  <td className="px-3 py-2 text-muted max-w-[180px] truncate">
                    {r.email || '—'}
                  </td>
                  <td className="px-3 py-2 max-w-[160px] truncate text-muted">
                    {editing ? (
                      <input type="text" value={r.interest_line} onChange={e => updateField(r.id, 'interest_line', e.target.value)}
                        className="w-full bg-gray-50 dark:bg-neutral-800 border border-gray-300 dark:border-neutral-600 rounded px-2 py-1 text-[11px] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    ) : (r.research_interest || r.interest_line || '—')}
                  </td>
                  <td className="px-3 py-2">
                    {!editing ? <StateBadge state={r.queue_state} /> : <span className="text-[10px] text-muted">—</span>}
                  </td>
                  <td className="px-3 py-2 text-muted tabular-nums">
                    {!editing ? formatDuration(durationMs) : '—'}
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
