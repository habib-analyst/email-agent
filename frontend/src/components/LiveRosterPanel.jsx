import React, { useMemo } from 'react';
import { FileSpreadsheet, Download, Trash2, Maximize2, Minimize2, Pencil, Save, Radio, CheckCircle2, Loader2, Plus } from 'lucide-react';
import { post, put } from '../api.js';

const STATE_COLORS = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  researching: 'bg-blue-100 text-blue-700 dark:bg-neutral-800 dark:text-blue-400',
  drafted: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  verified: 'bg-indigo-100 text-indigo-700 dark:bg-neutral-800 dark:text-indigo-400',
  awaiting_proceed: 'bg-violet-100 text-violet-700 dark:bg-neutral-800 dark:text-violet-400',
  sent: 'bg-emerald-100 text-emerald-700 dark:bg-neutral-800 dark:text-emerald-400',
  needs_web_research: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  skipped: 'bg-gray-200 text-gray-700 dark:bg-neutral-800 dark:text-gray-400',
  duplicate_review: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  needs_review: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
};

function StateBadge({ state }) {
  const cls = STATE_COLORS[state] || 'bg-gray-200 text-gray-700';
  const live = ['researching', 'drafted', 'verified', 'sending'].includes(state);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold ${cls}`}>
      {live && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
      {state || '-'}
    </span>
  );
}

export default function LiveRosterPanel({
  rows,
  activeEmail,
  onClear,
  onSave,
  mode = 'instant',
  live = true,
}) {
  const exportSuffix = mode !== 'instant' ? `?mode=${mode}` : '';
  const exportHref = mode === 'scheduled' || mode === 'basic_scheduled' ? '/api/scheduled/roster.xlsx' : `/api/roster.xlsx${exportSuffix}`;
  const [fullscreen, setFullscreen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [editData, setEditData] = React.useState(null);
  const [saving, setSaving] = React.useState(false);

  const summary = useMemo(() => {
    const counts = {};
    for (const r of rows || []) {
      const s = r.queue_state || 'pending';
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  }, [rows]);

  const startEdit = () => {
    setEditData((rows || []).map(r => ({
      id: r.id,
      full_name: r.full_name || '',
      last_name: r.last_name || '',
      email: r.email || '',
      subject_keyword: r.subject_keyword || '',
      interest_line: r.interest_line || r.research_interest || '',
    })));
    setEditing(true);
  };

  const handleSave = async () => {
    if (!editData) return;
    setSaving(true);
    try {
      for (const row of editData) {
        if (!row.id) continue;
        await put(`/professor/${row.id}?mode=${encodeURIComponent(mode)}`, {
          full_name: row.full_name,
          last_name: row.last_name,
          interest_line: row.interest_line,
          subject_keyword: row.subject_keyword,
        });
      }
      onSave?.();
      setEditing(false);
      setEditData(null);
    } finally {
      setSaving(false);
    }
  };

  const handleAddRow = async () => {
    const email = window.prompt('Email address for the new professor');
    if (!email) return;
    const full_name = window.prompt('Full name', '') || '';
    const last_name = window.prompt('Last name', '') || '';
    const subject_keyword = window.prompt('Subject keyword', '') || '';
    const interest_line = window.prompt('Interest line', '') || '';
    await post('/roster/add', { email, full_name, last_name, subject_keyword, interest_line, mode });
    onSave?.();
  };

  const updateEditRow = (id, field, value) => {
    setEditData(data => data.map(row => row.id === id ? { ...row, [field]: value } : row));
  };

  const displayRows = editing ? editData : rows;

  const content = (
    <div className={`rounded-2xl border border-emerald-200/60 dark:border-emerald-900/40 bg-white dark:bg-neutral-900 overflow-hidden shadow-lg ${fullscreen ? 'rounded-none border-none shadow-none' : ''}`}>
      <div className="px-4 py-3 border-b border-emerald-100 dark:border-emerald-900/30 bg-gradient-to-r from-emerald-50/80 to-teal-50/50 dark:from-neutral-900 dark:to-neutral-900">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-sm flex items-center gap-2 text-gray-900 dark:text-gray-100">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              Live Excel Roster
              {live && rows?.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                  <Radio className="w-3 h-3 animate-pulse" /> LIVE
                </span>
              )}
            </h3>
            <p className="text-[10px] text-gray-500 mt-0.5">{rows?.length || 0} rows - auto-filled from uploads</p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {Object.entries(summary).slice(0, 4).map(([k, v]) => (
              <span key={k} className="text-[9px] px-2 py-0.5 rounded-lg bg-white/80 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 font-medium tabular-nums">
                {v} {k}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {editing ? (
            <>
              <button onClick={handleSave} disabled={saving} className="text-[10px] px-3 py-1.5 flex items-center gap-1 rounded-lg bg-emerald-500 text-white font-medium">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
              </button>
              <button onClick={() => { setEditing(false); setEditData(null); }} className="text-[10px] px-3 py-1.5 rounded-lg border font-medium">Cancel</button>
            </>
          ) : (
            <>
              <button onClick={startEdit} className="text-[10px] px-3 py-1.5 flex items-center gap-1 rounded-lg border border-blue-200 text-blue-600 font-medium"><Pencil className="w-3 h-3" /> Edit</button>
              <button onClick={handleAddRow} className="text-[10px] px-3 py-1.5 flex items-center gap-1 rounded-lg border border-emerald-200 text-emerald-600 font-medium"><Plus className="w-3 h-3" /> Add row</button>
              {onClear && <button onClick={onClear} className="text-[10px] px-3 py-1.5 flex items-center gap-1 rounded-lg border border-red-200 text-red-600 font-medium"><Trash2 className="w-3 h-3" /> Clear</button>}
            </>
          )}
          <a href={exportHref} className="text-[10px] px-3 py-1.5 flex items-center gap-1 rounded-lg bg-emerald-600 text-white font-medium ml-auto"><Download className="w-3 h-3" /> Excel</a>
          <button onClick={() => setFullscreen(!fullscreen)} className="p-1.5 rounded-lg hover:bg-white/60">{fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}</button>
        </div>
      </div>

      <div className={`overflow-auto ${fullscreen ? 'max-h-[calc(100vh-140px)]' : 'max-h-[380px]'}`}>
        {!rows?.length ? (
          <div className="p-8 text-center text-gray-400 text-sm">Upload Excel, Word, or text - roster fills automatically</div>
        ) : (
          <table className="w-full text-[11px] border-collapse min-w-[760px]">
            <thead className="bg-emerald-50/90 dark:bg-emerald-950/50 sticky top-0 z-10 backdrop-blur-sm">
              <tr className="text-left text-muted">
                <th className="px-2 py-2.5 font-semibold">#</th>
                <th className="px-2 py-2.5 font-semibold">Full Name</th>
                <th className="px-2 py-2.5 font-semibold">Last Name</th>
                <th className="px-2 py-2.5 font-semibold">Email</th>
                <th className="px-2 py-2.5 font-semibold">Subject Keyword</th>
                <th className="px-2 py-2.5 font-semibold">Interest Line</th>
                <th className="px-2 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {(displayRows || []).slice(0, 300).map((r, i) => {
                const isActive = !editing && activeEmail && r.email === activeEmail;
                const isSent = r.queue_state === 'sent';
                const interestLine = r.interest_line || r.research_interest || '';
                return (
                  <tr
                    key={r.id || `${r.email}-${i}`}
                    className={`border-b border-gray-100 dark:border-neutral-800 transition-colors duration-300
                      ${isActive ? 'bg-blue-50 dark:bg-neutral-800 ring-2 ring-inset ring-blue-400/40' : ''}
                      ${isSent ? 'bg-emerald-50/30 dark:bg-neutral-800' : i % 2 ? 'bg-gray-50/40 dark:bg-neutral-800/20' : ''}
                    `}
                  >
                    <td className="px-2 py-2 text-gray-400 tabular-nums">{i + 1}</td>
                    <td className="px-2 py-2 font-medium truncate max-w-[150px]">
                      {editing ? <input className="input text-[11px] py-1 w-full" value={r.full_name} onChange={e => updateEditRow(r.id, 'full_name', e.target.value)} /> : (r.full_name || '-')}
                    </td>
                    <td className="px-2 py-2 truncate max-w-[120px]">
                      {editing ? <input className="input text-[11px] py-1 w-full" value={r.last_name} onChange={e => updateEditRow(r.id, 'last_name', e.target.value)} /> : (r.last_name || '-')}
                    </td>
                    <td className="px-2 py-2 text-gray-600 truncate max-w-[190px]">{r.email}</td>
                    <td className="px-2 py-2 truncate max-w-[140px] text-gray-600">
                      {editing ? <input className="input text-[11px] py-1 w-full" value={r.subject_keyword} onChange={e => updateEditRow(r.id, 'subject_keyword', e.target.value)} /> : (r.subject_keyword || '-')}
                    </td>
                    <td className="px-2 py-2 truncate max-w-[220px] text-gray-500">
                      {editing ? <input className="input text-[11px] py-1 w-full" value={r.interest_line} onChange={e => updateEditRow(r.id, 'interest_line', e.target.value)} /> : (interestLine || '-')}
                    </td>
                    <td className="px-2 py-2">{!editing ? <StateBadge state={r.queue_state} /> : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {summary.sent > 0 && (
        <div className="px-4 py-2 border-t border-emerald-100 dark:border-emerald-900/30 flex items-center gap-2 text-[10px] text-emerald-700 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20">
          <CheckCircle2 className="w-3.5 h-3.5" /> {summary.sent} sent - sheet synced to exports/professor-roster.xlsx
        </div>
      )}
    </div>
  );

  if (fullscreen) {
    return <div className="fixed inset-0 z-50 bg-white dark:bg-black p-4 overflow-auto">{content}</div>;
  }
  return content;
}
