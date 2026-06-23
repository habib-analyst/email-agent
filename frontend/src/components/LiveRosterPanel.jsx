import React from 'react';
import { FileSpreadsheet, Download, Trash2, Maximize2, Minimize2, Pencil, Save, Loader2, Plus } from 'lucide-react';
import { del, post, put } from '../api.js';

export default function LiveRosterPanel({
  rows,
  onClear,
  onSave,
  mode = 'instant',
}) {
  const exportSuffix = mode !== 'instant' ? `?mode=${mode}` : '';
  const exportHref = mode === 'scheduled' || mode === 'basic_scheduled' ? '/api/scheduled/roster.xlsx' : `/api/roster.xlsx${exportSuffix}`;
  const [fullscreen, setFullscreen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [editData, setEditData] = React.useState(null);
  const [saving, setSaving] = React.useState(false);

  const startEdit = () => {
    setEditData((rows || []).map(r => ({
      id: r.id,
      full_name: r.full_name || '',
      last_name: r.last_name || '',
      email: r.email || '',
      university: r.university || '',
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
          university: row.university,
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
    const university = window.prompt('University', '') || '';
    const subject_keyword = window.prompt('Subject keyword', '') || '';
    const interest_line = window.prompt('Interest line', '') || '';
    await post('/roster/add', { email, full_name, last_name, university, subject_keyword, interest_line, mode });
    onSave?.();
  };

  const handleDeleteRow = async row => {
    if (!row?.id) return;
    if (!window.confirm(`Delete ${row.email} from this roster and its unsent processing item?`)) return;
    await del(`/roster/${row.id}?mode=${encodeURIComponent(mode)}`);
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
              Imported Excel Roster
            </h3>
            <p className="text-[10px] text-gray-500 mt-0.5">{rows?.length || 0} user-owned rows · changed only by import, add, edit, or delete</p>
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
                <th className="px-2 py-2.5 font-semibold">University</th>
                <th className="px-2 py-2.5 font-semibold">Subject Keyword</th>
                <th className="px-2 py-2.5 font-semibold">Interest Line</th>
                <th className="px-2 py-2.5 text-center font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {(displayRows || []).slice(0, 300).map((r, i) => {
                const interestLine = r.interest_line || r.research_interest || '';
                return (
                  <tr
                    key={r.id || `${r.email}-${i}`}
                    className={`border-b border-gray-100 dark:border-neutral-800 ${i % 2 ? 'bg-gray-50/40 dark:bg-neutral-800/20' : ''}`}
                  >
                    <td className="px-2 py-2 text-gray-400 tabular-nums">{i + 1}</td>
                    <td className="px-2 py-2 font-medium truncate max-w-[150px]">
                      {editing ? <input className="input text-[11px] py-1 w-full" value={r.full_name} onChange={e => updateEditRow(r.id, 'full_name', e.target.value)} /> : (r.full_name || '-')}
                    </td>
                    <td className="px-2 py-2 truncate max-w-[120px]">
                      {editing ? <input className="input text-[11px] py-1 w-full" value={r.last_name} onChange={e => updateEditRow(r.id, 'last_name', e.target.value)} /> : (r.last_name || '-')}
                    </td>
                    <td className="px-2 py-2 text-gray-600 truncate max-w-[190px]">{r.email}</td>
                    <td className="px-2 py-2 truncate max-w-[180px] text-gray-600">
                      {editing ? <input className="input text-[11px] py-1 w-full" value={r.university || ''} onChange={e => updateEditRow(r.id, 'university', e.target.value)} /> : (r.university || '-')}
                    </td>
                    <td className="px-2 py-2 truncate max-w-[140px] text-gray-600">
                      {editing ? <input className="input text-[11px] py-1 w-full" value={r.subject_keyword} onChange={e => updateEditRow(r.id, 'subject_keyword', e.target.value)} /> : (r.subject_keyword || '-')}
                    </td>
                    <td className="px-2 py-2 truncate max-w-[220px] text-gray-500">
                      {editing ? <input className="input text-[11px] py-1 w-full" value={r.interest_line} onChange={e => updateEditRow(r.id, 'interest_line', e.target.value)} /> : (interestLine || '-')}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {!editing && (
                        <button type="button" onClick={() => handleDeleteRow(r)} className="rounded-lg p-1.5 text-red-500 transition hover:bg-red-500/10" title="Delete roster row">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  if (fullscreen) {
    return <div className="fixed inset-0 z-50 bg-white dark:bg-black p-4 overflow-auto">{content}</div>;
  }
  return content;
}
