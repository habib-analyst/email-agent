import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Save, CheckCircle2, Sliders, FileText, Trash2, AlertTriangle, Loader2, X, Minimize2, Maximize2, KeyRound, Plus, Unplug, Upload } from 'lucide-react';
import { put, get, post, del, uploadFile } from '../api.js';
import { useSession } from '../context/SessionContext.jsx';
import GmailConnectionCard from './GmailConnectionCard.jsx';
import ArchivePanel from './ArchivePanel.jsx';
import DuplicatePolicySelect from './DuplicatePolicySelect.jsx';

function newRowId() {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function emptyApiKeyRow() {
  return { id: newRowId(), savedId: null, key: '', baseUrl: '', masked: null, verified: false };
}

function rowsFromSaved(userApiKeys) {
  const saved = userApiKeys?.keys || [];
  if (!saved.length) return [emptyApiKeyRow()];
  return saved.map(k => ({
    id: newRowId(),
    savedId: k.id,
    key: '',
    baseUrl: k.base_url || '',
    masked: k.masked || null,
    verified: true,
  }));
}

function isRowConnected(row) {
  return !!(row.savedId && row.masked);
}

export default function SettingsModal({ open, onClose }) {
  const { settings: s, auth, loadSession, resetAllSession, resetting, setSettings } = useSession();
  const [local, setLocal] = useState(null);
  const [saved, setSaved] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [apiKeyRows, setApiKeyRows] = useState([emptyApiKeyRow()]);
  const [apiKeyTesting, setApiKeyTesting] = useState({});
  const [apiKeyTestResult, setApiKeyTestResult] = useState({});
  const [apiKeyDisconnecting, setApiKeyDisconnecting] = useState({});
  const [dupSaving, setDupSaving] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const openInitRef = useRef(false);

  const uploadAttachment = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setAttachmentBusy(true);
    try {
      const result = await uploadFile('/settings/attachment', file);
      applySettings(result.settings);
      setSettings(result.settings);
    } catch (error) {
      setLoadError(error.message || 'Attachment upload failed');
    } finally {
      setAttachmentBusy(false);
    }
  };

  const removeAttachment = async () => {
    setAttachmentBusy(true);
    try {
      const result = await del('/settings/attachment');
      applySettings(result.settings);
      setSettings(result.settings);
    } catch (error) {
      setLoadError(error.message || 'Could not remove attachment');
    } finally {
      setAttachmentBusy(false);
    }
  };

  const applySettings = useCallback((data) => {
    setLocal(data);
    setApiKeyRows(rowsFromSaved(data?.user_api_keys));
    setApiKeyTestResult({});
  }, []);

  useEffect(() => {
    if (!open) {
      openInitRef.current = false;
      setLoadError(null);
      setLoading(false);
      return undefined;
    }

    if (openInitRef.current) return undefined;
    openInitRef.current = true;

    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    if (s) {
      applySettings(s);
      setLoadError(null);
      setLoading(false);
      return () => { document.body.style.overflow = prev; };
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    (async () => {
      try {
        const data = await get('/settings', { timeout: 12000 });
        if (cancelled) return;
        applySettings(data);
        setSettings(data);
        setLoadError(null);
      } catch (e) {
        if (!cancelled) setLoadError(e.message || 'Failed to load settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      document.body.style.overflow = prev;
    };
  }, [open, applySettings, setSettings]);

  const retryLoad = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await get('/settings', { timeout: 12000 });
      applySettings(data);
      setSettings(data);
    } catch (e) {
      setLoadError(e.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const addApiKeyRow = () => {
    setApiKeyRows(rows => [...rows, emptyApiKeyRow()]);
  };

  const removeApiKeyRow = (rowId) => {
    setApiKeyRows(rows => {
      if (rows.length <= 1) return [emptyApiKeyRow()];
      return rows.filter(r => r.id !== rowId);
    });
    setApiKeyTestResult(prev => {
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
  };

  const buildKeysPayload = (excludeRowId = null) => {
    return apiKeyRows
      .filter(r => r.id !== excludeRowId && (r.savedId || r.key?.trim()))
      .map(r => {
        const item = { baseUrl: r.baseUrl?.trim() || '' };
        if (r.savedId) item.id = r.savedId;
        if (r.key?.trim()) item.key = r.key.trim();
        return item;
      })
      .filter(r => r.key || r.id);
  };

  const disconnectApiKeyRow = async (row) => {
    if (isRowConnected(row)) {
      setApiKeyDisconnecting(d => ({ ...d, [row.id]: true }));
      try {
        const keys = buildKeysPayload(row.id);
        const res = await put('/settings', {
          ...local,
          user_api_keys: { keys },
        });
        if (res?.settings) {
          applySettings(res.settings);
          setSettings(res.settings);
        }
      } catch (e) {
        setApiKeyTestResult(r => ({ ...r, [row.id]: { ok: false, message: e.message || 'Disconnect failed' } }));
      } finally {
        setApiKeyDisconnecting(d => ({ ...d, [row.id]: false }));
      }
      return;
    }
    removeApiKeyRow(row.id);
  };

  const updateApiKeyRow = (rowId, patch) => {
    if (patch.key !== undefined) {
      setApiKeyTestResult(r => ({ ...r, [rowId]: null }));
    }
    setApiKeyRows(rows => rows.map(r => {
      if (r.id !== rowId) return r;
      const next = { ...r, ...patch };
      if (patch.key !== undefined) next.verified = false;
      return next;
    }));
  };

  const testApiKeyRow = async (row) => {
    const key = row.key?.trim();
    if (!key) {
      setApiKeyTestResult(r => ({ ...r, [row.id]: { ok: false, message: 'Enter an API key first' } }));
      return;
    }
    setApiKeyTesting(t => ({ ...t, [row.id]: true }));
    setApiKeyTestResult(r => ({ ...r, [row.id]: null }));
    try {
      const body = { api_key: key };
      if (row.baseUrl?.trim()) body.base_url = row.baseUrl.trim();
      const res = await post('/settings/test-api-key', body);
      setApiKeyTestResult(r => ({ ...r, [row.id]: { ok: true, message: res.message || 'Valid' } }));
      updateApiKeyRow(row.id, { verified: true });
    } catch (e) {
      setApiKeyTestResult(r => ({ ...r, [row.id]: { ok: false, message: e.message || 'Test failed' } }));
    } finally {
      setApiKeyTesting(t => ({ ...t, [row.id]: false }));
    }
  };

  const buildUserApiKeysPayload = () => {
    const keys = buildKeysPayload();
    return keys.length ? { keys } : undefined;
  };

  const saveDuplicatePolicy = async (patch) => {
    const next = { ...local, ...patch };
    setLocal(next);
    setDupSaving(true);
    try {
      const res = await post('/settings/duplicate-policy', {
        duplicate_policy: next.duplicate_policy,
        duplicate_cooldown_days: next.duplicate_cooldown_days,
      });
      if (res?.settings) {
        applySettings(res.settings);
        setSettings(res.settings);
      }
    } catch (e) {
      setLoadError(e.message || 'Could not save duplicate policy');
    } finally {
      setDupSaving(false);
    }
  };

  const save = async () => {
    const user_api_keys = buildUserApiKeysPayload();
    const payload = user_api_keys ? { ...local, user_api_keys } : local;
    const res = await put('/settings', payload);
    if (res?.settings) {
      applySettings(res.settings);
      setSettings(res.settings);
    } else {
      await loadSession({ force: true });
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const resetAllData = async () => {
    const result = await resetAllSession();
    setResetConfirm(false);
    if (result.success) onClose();
  };

  if (!open) return null;

  if (loading || (!local && !loadError)) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="rounded-xl bg-white dark:bg-neutral-900 px-6 py-4 text-sm text-muted shadow-xl flex items-center gap-2" onClick={e => e.stopPropagation()}>
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          Loading settings…
        </div>
      </div>
    );
  }

  if (loadError && !local) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="rounded-xl bg-white dark:bg-neutral-900 border border-red-200 dark:border-red-900/40 px-5 py-4 shadow-xl max-w-sm space-y-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-start gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold">Could not load settings</p>
              <p className="text-xs text-muted mt-1">{loadError}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={retryLoad} className="btn-primary text-xs px-3 py-1.5">Retry</button>
            <button type="button" onClick={onClose} className="text-xs text-muted px-3 py-1.5">Close</button>
          </div>
        </div>
      </div>
    );
  }

  if (!local) return null;

  return (
    <AnimatePresence>
      {open && (
      <motion.div
        key="settings-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 backdrop-blur-sm p-3 sm:p-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: 8 }}
          transition={{ duration: 0.18 }}
          className={`bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-neutral-700 overflow-hidden flex flex-col ${
            maximized ? 'w-full h-full max-w-none max-h-none' : 'w-full max-w-2xl max-h-[min(88vh,900px)]'
          }`}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-modal-title"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-neutral-800 bg-gradient-to-r from-blue-50 to-violet-50 dark:from-neutral-900 dark:to-neutral-900">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-[#1a73e8] to-[#1557b0] rounded-lg flex items-center justify-center shadow-md">
                <Sliders className="w-4 h-4 text-white" />
              </div>
              <h2 id="settings-modal-title" className="text-sm font-semibold">Settings</h2>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setMaximized(!maximized)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/50 dark:hover:bg-neutral-800 transition-colors" title={maximized ? 'Restore' : 'Maximize'}>
                {maximized ? <Minimize2 className="w-4 h-4 text-gray-500" /> : <Maximize2 className="w-4 h-4 text-gray-500" />}
              </button>
              <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/50 dark:hover:bg-neutral-800 transition-colors">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          </div>

            <div className={`p-5 space-y-5 overflow-auto ${maximized ? 'h-[calc(100vh-80px)]' : 'max-h-[70vh]'}`}>
              <GmailConnectionCard variant="card" />

              <ArchivePanel />

              <div className="card p-6 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-brand-500" />
                    <h3 className="font-semibold text-xs">AI API Keys</h3>
                  </div>
                  <button
                    type="button"
                    onClick={addApiKeyRow}
                    className="text-[10px] px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-neutral-700 flex items-center gap-1 font-medium"
                  >
                    <Plus className="w-3 h-3" /> Add more
                  </button>
                </div>
                <p className="text-[11px] text-muted">
                  {auth?.isAdmin
                    ? 'Admin custom keys are added to the global API pool. AI is called only when local parsing cannot complete the task or you explicitly request AI/web research.'
                    : 'When any user key is saved, only those keys are used and all global API keys are disabled. AI is called only when local parsing cannot complete the task or you explicitly request AI/web research.'}
                </p>

                <div className="space-y-3">
                  {apiKeyRows.map((row, index) => {
                    const connected = isRowConnected(row);
                    const testResult = apiKeyTestResult[row.id];
                    const verified = connected || testResult?.ok || row.verified;
                    const failed = testResult?.ok === false;
                    const rowBorder = connected
                      ? 'border-emerald-300 dark:border-emerald-800 ring-1 ring-emerald-500/20'
                      : verified
                        ? 'border-emerald-200 dark:border-emerald-900/60 ring-1 ring-emerald-400/10'
                        : failed
                          ? 'border-red-200 dark:border-red-900/50'
                          : 'border-gray-200 dark:border-neutral-700';
                    const rowBg = connected
                      ? 'bg-gradient-to-br from-emerald-50/90 to-teal-50/30 dark:from-emerald-950/30 dark:to-neutral-900/50'
                      : verified
                        ? 'bg-emerald-50/30 dark:bg-emerald-950/10'
                        : 'bg-gray-50/50 dark:bg-neutral-800/30';

                    return (
                    <div key={row.id} className={`rounded-xl border p-3.5 space-y-2.5 transition-colors ${rowBorder} ${rowBg}`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                          API Key {index + 1}
                        </span>
                        {connected ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <CheckCircle2 className="w-3 h-3" />
                            Connected
                          </span>
                        ) : verified ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3" />
                            Test OK — save to connect
                          </span>
                        ) : failed ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-600 border border-red-500/20">
                            Test failed
                          </span>
                        ) : null}
                      </div>

                      {connected && !row.key ? (
                        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                          <KeyRound className="w-4 h-4 text-emerald-600 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400">Active key</p>
                            <p className="font-mono text-xs text-emerald-900 dark:text-emerald-200 truncate">{row.masked}</p>
                          </div>
                        </div>
                      ) : null}

                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={row.key}
                          onChange={e => updateApiKeyRow(row.id, { key: e.target.value, verified: false })}
                          placeholder={connected ? 'Paste new key to replace' : 'Paste API key'}
                          className={`input text-xs flex-1 ${verified && row.key ? 'border-emerald-300 dark:border-emerald-800' : ''}`}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={() => testApiKeyRow(row)}
                          disabled={apiKeyTesting[row.id] || apiKeyDisconnecting[row.id]}
                          className={`text-xs px-3 py-1.5 rounded-lg border whitespace-nowrap font-medium transition-colors ${
                            verified
                              ? 'border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5'
                              : 'border-gray-200 dark:border-neutral-700'
                          }`}
                        >
                          {apiKeyTesting[row.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Test'}
                        </button>
                      </div>
                      <input
                        type="text"
                        value={row.baseUrl}
                        onChange={e => updateApiKeyRow(row.id, { baseUrl: e.target.value })}
                        placeholder="API base URL (optional)"
                        className="input text-xs w-full"
                      />
                      {testResult && (
                        <p className={`text-[10px] flex items-center gap-1 ${testResult.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600'}`}>
                          {testResult.ok && <CheckCircle2 className="w-3 h-3 shrink-0" />}
                          {testResult.message}
                        </p>
                      )}
                      <div className="flex justify-end pt-0.5">
                        <button
                          type="button"
                          onClick={() => disconnectApiKeyRow(row)}
                          disabled={apiKeyDisconnecting[row.id]}
                          className="inline-flex items-center gap-1.5 text-[10px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 px-2.5 py-1.5 rounded-lg border border-red-200/80 dark:border-red-900/40 transition-colors"
                        >
                          {apiKeyDisconnecting[row.id] ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : connected ? (
                            <Unplug className="w-3 h-3" />
                          ) : (
                            <Trash2 className="w-3 h-3" />
                          )}
                          {connected ? 'Disconnect' : 'Remove'}
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>

              <div className="card p-6">
                <DuplicatePolicySelect
                  settings={local}
                  saving={dupSaving}
                  onChange={(patch) => saveDuplicatePolicy(patch)}
                />
              </div>

              <div className="card p-6 space-y-4">
                <div className="flex items-center gap-2"><Sliders className="w-4 h-4 text-brand-500" /><h3 className="font-semibold text-xs">Sending Config</h3></div>
                {[
                  ['daily_cap', 'Daily Cap', 'number'],
                  ['min_delay_min', 'Min Delay (min)', 'number'],
                  ['max_delay_min', 'Max Delay (min)', 'number'],
                ].map(([key, label, type]) => (
                  <div key={key} className="grid grid-cols-3 gap-2 items-center">
                    <label className="text-xs font-medium">{label}</label>
                    <input type={type} value={local[key]} onChange={e => setLocal({ ...local, [key]: type === 'number' ? +e.target.value : e.target.value })} className="input col-span-2 text-xs" />
                  </div>
                ))}
                <div className="rounded-lg bg-gray-50 dark:bg-neutral-800/50 border border-gray-200 dark:border-neutral-700 p-3 text-[11px] text-muted">
                  <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">Auto-send</p>
                  <p>Use the <strong>Send Mode</strong> toggle on Instant or Basic Instant (Step 1). Auto Send enables both draft-and-send; Manual Review requires approval per email. No separate toggle needed here.</p>
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-neutral-800">
                  <button onClick={save} className="btn-primary text-xs px-4 py-2"><Save className="w-3.5 h-3.5" /> Save</button>
                  {saved && <span className="text-[10px] text-emerald-500 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Saved</span>}
                </div>
              </div>

              <div className="card p-6 space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-brand-500" />
                  <div>
                    <h3 className="font-semibold text-xs">Email attachment</h3>
                    <p className="text-[10px] text-muted">PDF or image, stored only in your private user folder.</p>
                  </div>
                </div>

                <div className="rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-muted))]/40 p-3">
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-200 break-all">
                    {local.resume_name || 'No attachment configured'}
                  </p>
                  {local.attachment && (
                    <p className="text-[10px] text-muted mt-1">
                      {local.attachment.type} · {(local.attachment.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  )}
                  {auth?.isAdmin && local.attachment?.source === 'admin_default' && (
                    <p className="text-[10px] text-brand-600 dark:text-brand-400 mt-1">Admin default resume</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50">
                    {attachmentBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {local.resume_name ? 'Replace file' : 'Upload file'}
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
                      className="hidden"
                      disabled={attachmentBusy}
                      onChange={uploadAttachment}
                    />
                  </label>
                  {local.resume_name && (
                    <button
                      type="button"
                      onClick={removeAttachment}
                      disabled={attachmentBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 text-[11px] font-semibold disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <div className="card p-6 border-red-200 dark:border-red-900/30">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center"><Trash2 className="w-4 h-4 text-red-500" /></div>
                  <div>
                    <h3 className="font-semibold text-xs text-red-600 dark:text-red-400">Reset All Data</h3>
                    <p className="text-[10px] text-muted">Clear queue, professors, and templates for all modes. <strong>Analytics</strong> (send history, replies, topic stats) and permanent archive are <strong>not</strong> deleted.</p>
                  </div>
                </div>
                <div className="mt-3 pt-2 border-t border-gray-100 dark:border-neutral-800">
                  {!resetConfirm ? (
                    <button onClick={() => setResetConfirm(true)} className="inline-flex items-center gap-1 text-[10px] font-medium text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 transition-colors">
                      <Trash2 className="w-3 h-3" /> Reset Everything
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 text-[10px] text-red-500"><AlertTriangle className="w-3 h-3" />Cannot be undone!</div>
                      <button onClick={resetAllData} disabled={resetting} className="inline-flex items-center gap-1 text-[10px] font-medium text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg transition-colors">
                        {resetting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        Confirm
                      </button>
                      <button onClick={() => setResetConfirm(false)} className="text-[10px] text-gray-500 px-2 py-1.5 rounded-lg">Cancel</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
        </motion.div>
      </motion.div>
      )}
    </AnimatePresence>
  );
}
