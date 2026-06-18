import React, { useEffect, useState } from 'react';
import { Save, CheckCircle2, Sliders, FileText, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { put } from '../api.js';
import { useSession } from '../context/SessionContext.jsx';
import GmailConnectionCard from '../components/GmailConnectionCard.jsx';
import PageLayout from '../components/layout/PageLayout.jsx';

export default function Settings() {
  const { settings: s, loadSession, resetSession, resetting } = useSession();
  const [local, setLocal] = useState(null);
  const [saved, setSaved] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [backupPath, setBackupPath] = useState('');

  useEffect(() => { if (s) setLocal(s); }, [s]);

  const save = async () => {
    await put('/settings', local);
    await loadSession();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const resetAllData = async () => {
    const result = await resetSession();
    setResetConfirm(false);
    if (result.success) {
      setBackupPath(result.backupPath || '');
      await loadSession({ force: true });
    }
  };

  if (!local) {
    return (
      <PageLayout title="Settings" subtitle="Loading preferences…">
        <div className="text-muted text-sm">Loading…</div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Settings"
      subtitle="Gmail connection, sending limits, resume attachment, and session reset."
    >
      <GmailConnectionCard variant="card" />

      <div className="panel">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-brand-500" />
            <span className="text-sm font-bold text-[rgb(var(--text-primary))]">Sending configuration</span>
          </div>
        </div>
        <div className="p-6 space-y-5">
          {[
            ['daily_cap', 'Daily cap', 'number'],
            ['min_delay_min', 'Min delay (min)', 'number'],
            ['max_delay_min', 'Max delay (min)', 'number'],
          ].map(([key, label, type]) => (
            <div key={key} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
              <label className="text-sm font-medium text-[rgb(var(--text-secondary))]">{label}</label>
              <input
                type={type}
                value={local[key]}
                onChange={e => setLocal({ ...local, [key]: type === 'number' ? +e.target.value : e.target.value })}
                className="input sm:col-span-2"
              />
            </div>
          ))}
          <label className="flex items-center gap-3 cursor-pointer" onClick={() => {
            const nextAuto = local.auto_send ? 0 : 1;
            setLocal({ ...local, auto_send: nextAuto, approval_mode: nextAuto ? 'auto' : 'manual' });
          }}>
            <div className={`w-10 h-6 rounded-full flex items-center px-0.5 transition-colors ${local.auto_send && local.approval_mode === 'auto' ? 'bg-brand-600' : 'bg-gray-300 dark:bg-neutral-600'}`}>
              <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${local.auto_send && local.approval_mode === 'auto' ? 'translate-x-4' : ''}`} />
            </div>
            <span className="text-sm text-[rgb(var(--text-secondary))]">Auto-send after generation</span>
          </label>
          <p className="text-xs text-muted">Default safety mode is manual review before send.</p>
          <div className="flex items-center gap-3 pt-3 border-t border-[rgb(var(--border-subtle))]">
            <button type="button" onClick={save} className="btn-primary text-sm">
              <Save className="w-4 h-4" /> Save
            </button>
            {saved && (
              <span className="text-xs text-emerald-500 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Saved
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-brand-500" />
            <span className="text-sm font-bold text-[rgb(var(--text-primary))]">Resume attachment</span>
          </div>
        </div>
        <div className="p-6">
          <p className="text-xs text-muted">Fixed file attached to every email (never renamed):</p>
          <p className="text-sm font-medium text-[rgb(var(--text-primary))] mt-2 break-all">
            {local.resume_name || 'No PDF in Resume/ folder'}
          </p>
        </div>
      </div>

      <div className="panel border-red-500/20">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-red-500" />
            <span className="text-sm font-bold text-red-600 dark:text-red-400">Reset all data</span>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-xs text-muted">
            Clear professors, queue, template, sent history, and replies — ready for a new batch.
          </p>
          {backupPath && (
            <div className="text-xs p-3 rounded-xl bg-emerald-50 dark:bg-neutral-800 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 break-all">
              Backup saved: {backupPath}
            </div>
          )}
          {!resetConfirm ? (
            <button
              type="button"
              onClick={() => setResetConfirm(true)}
              className="text-sm font-medium text-red-600 dark:text-red-400 px-4 py-2 rounded-xl border border-red-500/30 hover:bg-red-500/10 transition-colors"
            >
              Reset everything
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/25">
              <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
              <span className="text-sm text-red-700 dark:text-red-300 flex-1">This cannot be undone.</span>
              <button
                type="button"
                onClick={resetAllData}
                disabled={resetting}
                className="text-sm font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-60 px-4 py-2 rounded-lg flex items-center gap-2"
              >
                {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Confirm reset
              </button>
              <button type="button" onClick={() => setResetConfirm(false)} className="text-sm text-muted px-3 py-2">
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
