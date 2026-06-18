import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Clock, AlertTriangle, MessageSquare, Activity, Zap, FileText, Globe, Loader2, Trash2, Search, FileSpreadsheet, Edit3, ShieldCheck, Mail, ArrowRight, RotateCcw, CheckCircle2, SkipForward } from 'lucide-react';
import { get, post, del } from '../api.js';
import { useSession } from '../context/SessionContext.jsx';
import { useEventStream } from '../core/EventStreamProvider.jsx';
import useGmailAuth from '../hooks/useGmailAuth.js';
import { useToast } from '../components/Toast.jsx';
import BatchScrapeProgress from '../components/BatchScrapeProgress.jsx';
import AnalyticsPanel from '../components/AnalyticsPanel.jsx';
import GmailComposeChrome from '../components/GmailComposeChrome.jsx';
import GmailConnectionCard from '../components/GmailConnectionCard.jsx';
import LiveFeed from '../components/LiveFeed.jsx';
import AgentFlowBar from '../components/AgentFlowBar.jsx';
import RosterPanel from '../components/RosterPanel.jsx';
import AgentStepToast from '../components/AgentStepToast.jsx';

const AGENT_STEP_LABELS = {
  starting: 'Agent starting…',
  researching: 'Researching professor profile',
  drafted: 'Drafting personalized email',
  verified: 'Verified — sending email',
  sending: 'Sending via Gmail',
  sent: 'Email sent successfully',
  skipped: 'Skipped — duplicate, already sent',
  fallback: 'Fallback sent — no research data available',
};

const colorClasses = {
  amber: { active: 'bg-amber-50 dark:bg-amber-900/20 ring-2 ring-amber-300 dark:ring-amber-700', iconBg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400' },
  blue: { active: 'bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-300 dark:ring-blue-700', iconBg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400' },
  purple: { active: 'bg-purple-50 dark:bg-purple-900/20 ring-2 ring-purple-300 dark:ring-purple-700', iconBg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-600 dark:text-purple-400' },
  indigo: { active: 'bg-indigo-50 dark:bg-indigo-900/20 ring-2 ring-indigo-300 dark:ring-indigo-700', iconBg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-600 dark:text-indigo-400' },
  emerald: { active: 'bg-emerald-50 dark:bg-emerald-900/20 ring-2 ring-emerald-300 dark:ring-emerald-700', iconBg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400' },
  green: { active: 'bg-green-50 dark:bg-green-900/20 ring-2 ring-green-300 dark:ring-green-700', iconBg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-600 dark:text-green-400' },
  red: { active: 'bg-red-50 dark:bg-red-900/20 ring-2 ring-red-300 dark:ring-red-700', iconBg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-400' },
  slate: { active: 'bg-slate-50 dark:bg-slate-900/20 ring-2 ring-slate-300 dark:ring-slate-700', iconBg: 'bg-slate-100 dark:bg-slate-900/30', text: 'text-slate-600 dark:text-slate-400' },
};

// ─── FILE PREVIEW ────────────────────────────────────
function FilePreview({ data, onConfirm, onCancel, importing }) {
  if (!data) return null;

  return (
    <div className="mt-3 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-brand-500" />
          <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{data.filename}</span>
        </div>
        <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded">
          {data.emails.length} emails found
        </span>
      </div>

      {data.type === 'spreadsheet' && data.sheets?.map((sheet, si) => (
        <div key={si} className="overflow-auto max-h-[250px]">
          {data.sheets.length > 1 && <div className="px-3 py-1 text-[10px] font-medium text-muted bg-gray-50 dark:bg-gray-800/50">{sheet.name}</div>}
          <table className="w-full text-[11px] border-collapse">
            {sheet.headers.length > 0 && (
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800">
                  {sheet.headers.map((h, i) => (
                    <th key={i} className="px-3 py-1.5 text-left font-semibold text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700 whitespace-nowrap">{h || `Col ${i + 1}`}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {sheet.rows.slice(0, 20).map((row, ri) => (
                <tr key={ri} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                  {row.map((cell, ci) => {
                    const isEmail = /[\w.-]+@[\w.-]+\.[a-z]{2,}/i.test(cell);
                    return <td key={ci} className={`px-3 py-1.5 whitespace-nowrap ${isEmail ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>{cell}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {sheet.totalRows > 20 && <div className="px-3 py-1.5 text-[10px] text-muted bg-gray-50 dark:bg-gray-800/50">...and {sheet.totalRows - 20} more rows</div>}
        </div>
      ))}

      {data.type === 'text' && (
        <div className="overflow-auto max-h-[250px] bg-gray-50 dark:bg-gray-950 border-b border-gray-200 dark:border-gray-700">
          <pre className="px-4 py-3 text-[11px] font-mono text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{data.content}</pre>
        </div>
      )}

      {data.type === 'document' && (
        <div className="overflow-auto max-h-[250px] border-b border-gray-200 dark:border-gray-700">
          <pre className="px-4 py-3 text-[11px] text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{data.content}</pre>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800">
        <span className="text-[10px] text-muted">
          {data.emails.length} valid email{data.emails.length !== 1 ? 's' : ''} detected
        </span>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Cancel</button>
          <button onClick={onConfirm} disabled={importing || data.emails.length === 0} className="btn-primary text-xs px-4 py-1.5">
            {importing ? <Loader2 className="w-3 h-3 animate-spin" /> : <><CheckCircle2 className="w-3 h-3" /> Import {data.emails.length} Emails</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN DASHBOARD ───────────────────────────────────
export default function Dashboard() {
  const {
    stats, queue, template, settings, analytics, sessionReady, sessionError, resetting, sessionVersion,
    setTemplate, setQueue, loadSession, resetSession, applyReset, setAnalytics,
  } = useSession();
  const { isConnected } = useGmailAuth();
  const { connected: sseConnected, subscribe } = useEventStream();
  const toast = useToast();

  const [events, setEvents] = useState([]);
  const [sentEmails, setSentEmails] = useState([]);
  const [scrapeProgress, setScrapeProgress] = useState({ running: false });
  const sessionEpochRef = useRef(0);
  const refreshTimerRef = useRef(null);
  const sectionImportRef = useRef(null);
  const sectionTemplateRef = useRef(null);
  const sectionQueueRef = useRef(null);

  // Import
  const [emailInput, setEmailInput] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [importTab, setImportTab] = useState('url');
  const [filePreview, setFilePreview] = useState(null);
  const [proceedingId, setProceedingId] = useState(null);
  const [agentToast, setAgentToast] = useState(null);
  const [roster, setRoster] = useState([]);
  const [liveCompose, setLiveCompose] = useState(null);
  const [mode, setMode] = useState('instant');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [scheduledBatches, setScheduledBatches] = useState([]);
  const [scheduledDrafts, setScheduledDrafts] = useState([]);
  const [pendingProceedId, setPendingProceedId] = useState(null);
  const agentToastTimerRef = useRef(null);

  // Template
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);

  // Reset
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [resetToast, setResetToast] = useState(false);
  const [resetError, setResetError] = useState('');
  const [replies, setReplies] = useState([]);

  const activeItem = useMemo(() => queue.find(q => ['researching', 'drafted', 'verified'].includes(q.state)), [queue]);
  const awaitingProceedItem = useMemo(() => queue.find(q => q.state === 'awaiting_proceed'), [queue]);

  const agentFlowStage = useMemo(() => {
    if (agentToast?.stage && !['starting'].includes(agentToast.stage)) return agentToast.stage;
    if (scrapeProgress.running) return scrapeProgress.phase === 'template' ? 'import' : 'researching';
    return activeItem?.state || (awaitingProceedItem ? 'import' : null);
  }, [agentToast, scrapeProgress, activeItem, awaitingProceedItem]);

  const liveStats = useMemo(() => ({
    pending: queue.filter(q => q.state === 'pending').length,
    awaitingProceed: queue.filter(q => q.state === 'awaiting_proceed').length,
    processing: queue.filter(q => ['researching', 'drafted', 'verified'].includes(q.state)).length,
    sent: queue.filter(q => q.state === 'sent').length,
    failed: queue.filter(q => q.state === 'failed' || q.state === 'skipped').length,
  }), [queue]);
  const latestEvent = events[0];
  const proceedTarget = awaitingProceedItem || (pendingProceedId ? queue.find(q => q.id === pendingProceedId) : null);

  const isEmptyWorkspace = stats?.total === 0 && !scrapeProgress.running;

  const clearLocalState = () => {
    // Preserve events (Live Activity) and replies — reset only clears queue/template/roster
    setScrapeProgress({ running: false });
    setRoster([]);
    setLiveCompose(null);
    setPendingProceedId(null);
    setEmailInput('');
    setUrlInput('');
    setFilePreview(null);
    setImportMsg('');
    setImportTab('url');
    setTemplateSaved(false);
    setTemplateLoading(false);
    setResetConfirm(false);
    setResetError('');
    setResetKey(k => k + 1);
  };

  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => loadSession(), 600);
  }, [loadSession]);

  const showAgentStep = useCallback((data) => {
    const stage = data.stage || data.state;
    if (!stage || ['stream_connected', 'stream_disconnected', 'connected'].includes(stage)) return;
    const label = data.label || AGENT_STEP_LABELS[stage] || stage;
    clearTimeout(agentToastTimerRef.current);
    setAgentToast({
      stage,
      label,
      professor: data.professor || data.professor_email,
      at: Date.now(),
    });
    agentToastTimerRef.current = setTimeout(() => setAgentToast(null), 5000);
  }, []);

  const showErrorToast = useCallback((message, professor) => {
    clearTimeout(agentToastTimerRef.current);
    setAgentToast({
      stage: 'error',
      label: message || 'Something went wrong',
      professor,
      at: Date.now(),
    });
    agentToastTimerRef.current = setTimeout(() => setAgentToast(null), 8000);
  }, []);

  const patchQueueFromEvent = useCallback((data) => {
    if (!data?.id) return;
    setQueue(prev => prev.map(q => (
      q.id === data.id
        ? {
          ...q,
          state: data.state ?? q.state,
          subject: data.subject ?? q.subject,
          interest_line: data.interest_line ?? q.interest_line,
          error: data.error ?? q.error,
        }
        : q
    )));
  }, [setQueue]);

  useEffect(() => () => {
    clearTimeout(refreshTimerRef.current);
    clearTimeout(agentToastTimerRef.current);
  }, []);

  useEffect(() => {
    if (stats?.sessionEpoch != null) sessionEpochRef.current = stats.sessionEpoch;
  }, [stats?.sessionEpoch]);

  useEffect(() => {
    get('/scrape/status').then(s => { if (s.running) setScrapeProgress(s); }).catch(() => {});
    get('/roster/sheet').then(r => { if (Array.isArray(r) && r.length) setRoster(r); }).catch(() => {
      get('/roster').then(r => { if (Array.isArray(r)) setRoster(r); }).catch(() => {});
    });

    return subscribe((data) => {
      if (data.type === 'reset') {
        const epoch = data.sessionEpoch ?? sessionEpochRef.current + 1;
        sessionEpochRef.current = epoch;
        applyReset(epoch);
        clearLocalState();
        setResetToast(true);
        setTimeout(() => setResetToast(false), 5000);
        return;
      }

      if (data.sessionEpoch != null && data.sessionEpoch !== sessionEpochRef.current) return;

      if (data.type === 'gmail_connected' || data.type === 'gmail_disconnected') {
        loadSession();
        return;
      }

      if (data.type === 'scrape_progress') {
        setScrapeProgress({ running: true, ...data });
      }
      if (data.type === 'scrape_complete') {
        setScrapeProgress({ running: false });
        if (Array.isArray(data.roster)) setRoster(data.roster);
        get('/roster').then(r => { if (Array.isArray(r)) setRoster(r); }).catch(() => {});
        setImportMsg(`${data.added} professors queued · ${data.skipped} skipped${data.templateLoaded ? ' · Template loaded' : ''}${data.autoStarted ? ' · Agent auto-started' : ''}`);
        setUrlInput('');
        loadSession();
        setTimeout(() => setImportMsg(''), 8000);
      }
      if (data.type === 'scrape_cancelled') {
        setScrapeProgress({ running: false });
      }
      if (data.type === 'scrape_skipped') {
        setEvents(prev => [{ type: 'skipped', professor: data.email, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 50));
      }
      if (data.type === 'batch_auto_start') {
        showAgentStep({ stage: 'starting', label: data.label || 'Batch outreach auto-started' });
        scheduleRefresh();
      }
      if (data.type === 'roster_row') {
        setRoster(prev => [...prev, data.row].slice(-200));
      }
      if (data.type === 'compose_update') {
        setLiveCompose(data);
        patchQueueFromEvent({ id: data.id, state: data.state, subject: data.subject, interest_line: data.interestLine, professor: data.professor });
      }
      if (data.type === 'template_loaded') {
        scheduleRefresh();
        setTemplateSaved(true);
        setTimeout(() => setTemplateSaved(false), 3000);
      }
      if (data.type === 'agent_step') {
        showAgentStep(data);
        if (data.id && data.stage === 'starting') {
          patchQueueFromEvent({ id: data.id, state: 'pending' });
        }
      }
      if (data.type === 'state_change') {
        patchQueueFromEvent(data);
        showAgentStep({ ...data, label: AGENT_STEP_LABELS[data.state] || data.state });
        scheduleRefresh();
      }
      if (data.type === 'progress') {
        patchQueueFromEvent({ id: data.id, state: data.stage, professor: data.professor, subject: data.subject });
        showAgentStep(data);
        scheduleRefresh();
      }
      if (['sent', 'skipped', 'verification_failed'].includes(data.type)) {
        if (data.id) {
          const newState = data.type === 'sent' ? (data.fallback ? 'sent' : 'sent') : data.type === 'skipped' ? 'skipped' : 'needs_review';
          patchQueueFromEvent({ id: data.id, state: newState, professor: data.professor, subject: data.subject, error: data.fallback ? 'fallback_no_research' : data.error });
        }
        if (data.type === 'sent') {
          if (data.fallback) {
            showAgentStep({ stage: 'fallback', label: AGENT_STEP_LABELS.fallback, professor: data.professor, subject: data.subject });
          } else {
            showAgentStep({ stage: 'sent', label: AGENT_STEP_LABELS.sent, professor: data.professor, subject: data.subject });
          }
          // Auto-reset for single email: clear proceed state, ready for next
          if (pendingProceedId || proceedingId) {
            setPendingProceedId(null);
            setProceedingId(null);
            setImportMsg(`✓ Email sent to ${data.professor} — ready for next professor`);
            setTimeout(() => setImportMsg(''), 6000);
          }
        }
        if (data.type === 'skipped' && data.error === 'duplicate_skipped') {
          showAgentStep({ stage: 'skipped', label: AGENT_STEP_LABELS.skipped, professor: data.professor });
        }
        scheduleRefresh();
      }
      if (data.type === 'sent') {
        get('/analytics').then(a => { if (a?.overview) setAnalytics(a); }).catch(() => {});
      }
      if (!['stream_connected', 'stream_disconnected', 'connected'].includes(data.type)) {
        setEvents(prev => [{ ...data, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 50));
      }
    });
  }, [applyReset, loadSession, scheduleRefresh, setAnalytics, subscribe, showAgentStep, patchQueueFromEvent]);

  useEffect(() => {
    if (isConnected) get('/gmail/sent').then(setSentEmails).catch(() => setSentEmails([]));
    else setSentEmails([]);
  }, [isConnected]);

  useEffect(() => {
    get('/replies').then(setReplies).catch(() => {});
  }, [stats?.replied, sessionVersion]);

  // Actions
  const proceedNow = async (queueId) => {
    if (!queueId) return;
    setProceedingId(queueId);
    try {
      const res = await post(`/queue/${queueId}/proceed`);
      setQueue(prev => prev.map(q => (q.id === queueId ? { ...q, state: 'pending' } : q)));
      showAgentStep({ stage: 'starting', label: 'Agent starting — loading template…', professor: res.professor_email });
      setPendingProceedId(null);
      setImportMsg('Agent started — processing this professor now');
      setTimeout(() => setImportMsg(''), 8000);
    } catch (e) {
      const message = e.message || 'Could not proceed';
      setImportMsg(`error:${message}`);
      showErrorToast(message);
      setTimeout(() => setImportMsg(''), 5000);
    } finally {
      setProceedingId(null);
    }
  };

  const importEmails = async () => {
    setImporting(true);
    let awaitingProceed = false;
    try {
      const res = await post('/professors', urlInput ? { url: urlInput } : { emails: emailInput });
      if (res.started) {
        setImportMsg('Scraping all professors in background — one by one…');
        setScrapeProgress({ running: true, phase: 'discovering', current: 0, total: 0 });
      } else if (res.awaitingProceed && res.singleQueueId) {
        awaitingProceed = true;
        setPendingProceedId(res.singleQueueId);
        setImportMsg('Professor added — click Proceed Now to load template and start agent');
        setEmailInput('');
        setUrlInput('');
      } else {
        const extras = [
          res.templateLoaded ? 'Template loaded' : null,
          res.autoStarted ? 'Agent auto-started' : null,
        ].filter(Boolean).join(' · ');
        setImportMsg(`${res.added} professor${res.added > 1 ? 's' : ''} added${extras ? ` · ${extras}` : ' — agent processing starts automatically'}`);
        setEmailInput('');
        setUrlInput('');
      }
    } catch (e) {
      const message = e.message?.includes('timed out') ? 'Processing in progress — check Live Activity for status' : (e.message || 'Import failed');
      setImportMsg(`error:${message}`);
      showErrorToast(message);
      // Still refresh session so queue shows any items that were added before timeout
      loadSession();
    }
    setImporting(false);
    if (!urlInput) setTimeout(() => setImportMsg(''), awaitingProceed ? 12000 : 5000);
  };

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload/preview', { method: 'POST', body: form }).then(r => r.json());
      if (res.error) {
        setImportMsg(`error:${res.error}`);
        showErrorToast(res.error);
      } else {
        setFilePreview(res);
      }
    } catch (err) {
      const message = `Upload failed: ${err.message || 'Network error'}`;
      setImportMsg(`error:${message}`);
      showErrorToast(message);
    }
    setImporting(false);
    e.target.value = '';
  };

  const confirmFileImport = async () => {
    if (!filePreview?.emails?.length) return;
    setImporting(true);
    let awaitingProceed = false;
    try {
      const res = await post('/upload/confirm', { emails: filePreview.emails });
      if (res.awaitingProceed && res.singleQueueId) {
        awaitingProceed = true;
        setPendingProceedId(res.singleQueueId);
        setImportMsg('Professor added — click Proceed Now to load template and start agent');
      } else {
        const extras = [
          res.templateLoaded ? 'Template loaded' : null,
          res.autoStarted ? 'Agent auto-started' : null,
        ].filter(Boolean).join(' · ');
        setImportMsg(`${res.added} professor${res.added > 1 ? 's' : ''} imported from file${extras ? ` · ${extras}` : ''}`);
      }
      setFilePreview(null);
      loadSession();
    } catch (err) {
      const message = err.message || 'File import failed';
      setImportMsg(`error:${message}`);
      showErrorToast(message);
    }
    setImporting(false);
    setTimeout(() => setImportMsg(''), awaitingProceed ? 12000 : 5000);
  };

  const resetAll = async () => {
    setResetConfirm(false);
    setResetError('');
    clearLocalState();
    const result = await resetSession();
    if (result.success) {
      sessionEpochRef.current = result.sessionEpoch ?? sessionEpochRef.current;
      setResetToast(true);
      setTimeout(() => setResetToast(false), 5000);
    } else {
      setResetError(result.error || 'Reset failed — please try again');
      await loadSession();
    }
  };

  const saveInstructions = async (instructions, sampleSubject) => {
    setTemplateLoading(true);
    await post('/template/raw', { instructions, sample_subject: sampleSubject });
    await loadSession();
    setTemplateLoading(false);
    setTemplateSaved(true);
    setTimeout(() => setTemplateSaved(false), 3000);
  };

  const detectPlaceholders = async () => {
    setTemplateLoading(true);
    await post('/template/detect');
    await loadSession();
    setTemplateLoading(false);
  };

  const pickSentEmail = async (id) => {
    setTemplateLoading(true);
    try {
      await post('/template', { messageId: id });
      await post('/template/detect');
      await loadSession();
      setTemplateSaved(true);
      setTimeout(() => setTemplateSaved(false), 3000);
    } catch (e) {
      const message = `Failed to load email: ${e.message}`;
      setImportMsg(`error:${message}`);
      showErrorToast(message);
    }
    setTemplateLoading(false);
  };

  const pickLatestSent = async () => {
    setTemplateLoading(true);
    try {
      await post('/template/load-latest');
      await loadSession();
      setTemplateSaved(true);
      setTimeout(() => setTemplateSaved(false), 3000);
    } catch (e) {
      const message = e.message || 'Failed to load latest sent email';
      setImportMsg(`error:${message}`);
      showErrorToast(message);
      setTimeout(() => setImportMsg(''), 5000);
    }
    setTemplateLoading(false);
  };

  const retryItem = (id) => post(`/queue/${id}/retry`).then(loadSession);
  const deleteItem = (id) => del(`/queue/${id}`).then(loadSession).catch(() => {});

  const clearCompleted = async () => {
    try {
      const res = await post('/queue/clear-completed');
      await loadSession();
      toast.success(`Cleared ${res.removed} completed tasks`);
    } catch (e) {
      toast.error(`Failed to clear: ${e.message}`);
    }
  };

  const loadScheduledBatches = useCallback(() => {
    get('/scheduled/batches').then(setScheduledBatches).catch(() => {});
  }, []);

  const loadScheduledDrafts = useCallback((batchId) => {
    get(`/scheduled/batch/${batchId}/drafts`).then(setScheduledDrafts).catch(() => {});
  }, []);

  const scheduleImport = async () => {
    if (!scheduleDate) { setImportMsg('error:Pick a date and time first'); setTimeout(() => setImportMsg(''), 3000); return; }
    const scheduled_at = `${scheduleDate}T${scheduleTime}:00`;
    setImporting(true);
    try {
      const res = await post('/scheduled/batch', { scheduled_at, url: urlInput || undefined, emails: emailInput || undefined });
      setImportMsg(`Scheduled batch #${res.batchId} for ${scheduleDate} at ${scheduleTime}`);
      loadScheduledBatches();
      setUrlInput('');
      setEmailInput('');
    } catch (e) {
      setImportMsg(`error:${e.message || 'Schedule failed'}`);
      showErrorToast(e.message || 'Schedule failed');
    }
    setImporting(false);
    setTimeout(() => setImportMsg(''), 5000);
  };

  const stateStyle = {
    pending: 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400',
    awaiting_proceed: 'bg-violet-100 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400',
    researching: 'bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400',
    drafted: 'bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400',
    verified: 'bg-indigo-100 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400',
    scheduled: 'bg-cyan-100 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-400',
    sent: 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400',
    sent_fallback: 'bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400',
    failed: 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400',
    skipped: 'bg-slate-100 dark:bg-slate-900/20 text-slate-700 dark:text-slate-400',
    duplicate: 'bg-gray-100 dark:bg-gray-900/20 text-gray-700 dark:text-gray-400',
    needs_review: 'bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400',
    replied: 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400',
  };

  if (!sessionReady) return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <Activity className="w-6 h-6 animate-spin text-[#1a73e8]" />
      <p className="text-xs text-muted font-medium">Loading workspace…</p>
    </div>
  );

  return (
    <div className="p-5 lg:p-8 space-y-6 max-w-[1500px] mx-auto pb-12">

      <AgentStepToast toast={agentToast} />

      {sessionError && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs">
          <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{sessionError}</span>
          <button onClick={loadSession} className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 font-medium hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors">Retry</button>
        </div>
      )}

      <GmailConnectionCard variant="banner" />

      {/* Mode Tabs */}
      <div className="flex gap-1 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit">
        <button onClick={() => setMode('instant')} className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-all ${mode === 'instant' ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700'}`}>
          <Zap className="w-3.5 h-3.5" />Instant
        </button>
        <button onClick={() => { setMode('scheduled'); loadScheduledBatches(); }} className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-all ${mode === 'scheduled' ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700'}`}>
          <Clock className="w-3.5 h-3.5" />Scheduled
        </button>
      </div>

      {resetToast && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Dashboard cleared — ready for a new outreach batch
        </motion.div>
      )}

      {mode === 'instant' && <>
      {/* Agent Health + Reset */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${sseConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
              {sseConnected ? (activeItem || scrapeProgress.running ? 'Agent Active' : 'Agent Idle') : 'Disconnected'}
            </span>
            <span className="text-[10px] text-muted">Today: {stats.todaySent || 0} sent</span>
          </div>
          {!resetConfirm ? (
            <button onClick={() => setResetConfirm(true)} className="text-[10px] font-medium text-gray-500 hover:text-red-600 dark:hover:text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/10 border border-transparent hover:border-red-200 dark:hover:border-red-900/30 transition-all flex items-center gap-1.5 shrink-0">
              <Trash2 className="w-3 h-3" /> New Task
            </button>
          ) : (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] text-red-600 dark:text-red-400 font-medium">Clear all sections?</span>
              <button onClick={resetAll} disabled={resetting} className="text-[10px] font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-60 px-3 py-1.5 rounded-lg transition-colors shadow-sm flex items-center gap-1">
                {resetting ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Reset Everything
              </button>
              <button onClick={() => setResetConfirm(false)} className="text-[10px] text-gray-500 hover:text-gray-700 px-2 py-1 rounded-lg">Cancel</button>
            </div>
          )}
        </div>
        {(activeItem || scrapeProgress.running || latestEvent) && (
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-100 dark:border-gray-800">
            {scrapeProgress.running && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-medium">
                {scrapeProgress.label || `Import: ${scrapeProgress.phase}${scrapeProgress.total ? ` · ${scrapeProgress.current || 0}/${scrapeProgress.total}` : ''}`}
              </span>
            )}
            {activeItem && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 font-medium truncate max-w-xs">
                {activeItem.state}: {activeItem.professor_email}
              </span>
            )}
            {latestEvent && !scrapeProgress.running && (
              <span className="text-[10px] text-muted truncate">
                Last event · {latestEvent.time} · {latestEvent.type}{latestEvent.professor ? ` · ${latestEvent.professor}` : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {resetError && (
        <div className="text-xs p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 text-red-600 font-medium">{resetError}</div>
      )}

      {/* Scrape progress */}
      <BatchScrapeProgress progress={scrapeProgress} onStop={async () => { await post('/scrape/cancel'); setScrapeProgress({ running: false }); }} />

      <AnalyticsPanel data={analytics} queueStats={liveStats} />

      <AgentFlowBar
        scrapePhase={scrapeProgress}
        activeStage={agentFlowStage}
        queue={queue}
        stats={stats}
        liveLabel={liveCompose?.professor ? `Editing ${liveCompose.professor}` : null}
      />

      {/* Live Activity */}
      <section className="space-y-3">
        <div className="flex items-center gap-2.5 px-1">
          <Activity className="w-4 h-4 text-[#1a73e8]" />
          <h3 className="font-semibold text-sm text-gray-800 dark:text-gray-100">Live Activity</h3>
          <span className={`w-2 h-2 rounded-full shrink-0 ml-1 ${sseConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
        </div>
        <LiveFeed events={events} connected={sseConnected} />
      </section>

      {/* Replies */}
      {replies.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider px-1">Replies from Professors</h3>
          <div className="card divide-y divide-gray-100 dark:divide-gray-800">
            {replies.slice(0, 10).map(r => (
              <div key={r.id} className="flex items-start gap-3 py-2.5 px-1 first:pt-0 last:pb-0">
                <span className={`shrink-0 mt-0.5 px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                  r.classification === 'positive' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' :
                  r.classification === 'negative' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                  r.classification === 'auto_reply' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
                  'bg-gray-100 dark:bg-gray-800 text-muted'
                }`}>{r.classification === 'auto_reply' ? 'auto' : r.classification}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{r.professor_email}</p>
                  <p className="text-[11px] text-muted mt-0.5 truncate">{r.summary}</p>
                </div>
                <span className="text-[10px] text-muted shrink-0">{r.received_at?.slice(0, 16)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── STEP 1: Import + Roster ─── */}
      <section ref={sectionImportRef} className="space-y-3 scroll-mt-20">
        <div className="flex items-center gap-2.5 px-1">
          <span className="step-badge">1</span>
          <h3 className="font-semibold text-sm text-gray-800 dark:text-gray-100">Import Professors</h3>
          <span className="text-[10px] text-muted ml-auto">Faculty URL, email list, or file upload</span>
        </div>
        <div className="card space-y-4">
          <div className="flex gap-1 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit">
            {[['url', 'Faculty URL', Globe], ['paste', 'Paste Emails', Edit3], ['file', 'Upload File', FileSpreadsheet]].map(([id, label, Icon]) => (
              <button key={id} onClick={() => setImportTab(id)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[11px] font-medium transition-all ${importTab === id ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-gray-100' : 'text-muted hover:text-gray-700 dark:hover:text-gray-300'}`}>
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            ))}
          </div>

          {importTab === 'url' && (
            <div className="space-y-3">
              <input value={urlInput} onChange={e => setUrlInput(e.target.value)} className="input text-sm" placeholder="https://cs.stanford.edu/people/faculty" />
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-muted">Agent scrapes every profile one-by-one — skips professors with no online data</p>
                <button onClick={importEmails} disabled={importing || !urlInput.trim()} className="btn-primary text-xs px-5 py-2 shrink-0">
                  {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Globe className="w-3.5 h-3.5" /> Scrape Profiles</>}
                </button>
              </div>
            </div>
          )}

          {importTab === 'paste' && (
            <div className="space-y-3">
              <textarea value={emailInput} onChange={e => setEmailInput(e.target.value)} rows={4} className="input text-xs font-mono leading-relaxed"
                placeholder="professor@mit.edu&#10;&#10;Paste one email to review first, or multiple emails (one per line) to queue all at once." />
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[10px] text-muted">Single email waits for Proceed Now · multiple emails start automatically</p>
                <button onClick={importEmails} disabled={importing || !emailInput.trim()} className="btn-primary text-xs px-5 py-2">
                  {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Zap className="w-3.5 h-3.5" /> Add to Queue</>}
                </button>
              </div>
              {(proceedTarget || importMsg.includes('Proceed Now')) && (
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-violet-800 dark:text-violet-200">Ready to start</p>
                    <p className="text-[10px] text-violet-600 dark:text-violet-400 truncate">
                      {proceedTarget?.professor_email || 'Professor queued'} — loads Gmail template, then agent runs
                    </p>
                  </div>
                  <button
                    onClick={() => proceedNow(proceedTarget?.id || pendingProceedId)}
                    disabled={(!proceedTarget?.id && !pendingProceedId) || proceedingId === (proceedTarget?.id || pendingProceedId)}
                    className="btn-primary text-xs px-4 py-2 shrink-0 bg-violet-600 hover:bg-violet-700 border-violet-600"
                  >
                    {proceedingId === (proceedTarget?.id || pendingProceedId)
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <><Zap className="w-3.5 h-3.5" /> Proceed Now</>}
                  </button>
                </div>
              )}
            </div>
          )}

          {importTab === 'file' && (
            <div className="space-y-3">
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl py-8 cursor-pointer hover:border-brand-400 dark:hover:border-brand-500 hover:bg-brand-50/30 dark:hover:bg-brand-900/5 transition-all group">
                {importing ? <Loader2 className="w-7 h-7 text-brand-500 animate-spin mb-2" /> : <FileSpreadsheet className="w-7 h-7 text-gray-400 group-hover:text-brand-500 mb-2 transition-colors" />}
                <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{importing ? 'Processing...' : 'Click to upload file'}</span>
                <span className="text-[10px] text-muted mt-1">Excel, CSV, PDF, Word, TXT</span>
                <input type="file" accept=".xlsx,.xls,.csv,.pdf,.docx,.doc,.txt" onChange={handleFile} className="hidden" />
              </label>
              <FilePreview data={filePreview} onConfirm={confirmFileImport} onCancel={() => setFilePreview(null)} importing={importing} />
            </div>
          )}

          {importMsg && (
            <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className={`text-xs p-2.5 rounded-lg font-medium ${importMsg.startsWith('error:') ? 'bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400' : 'bg-emerald-50 dark:bg-emerald-900/10 text-emerald-600 dark:text-emerald-400'}`}>
              {importMsg.replace(/^error:/, '')}
            </motion.div>
          )}
        </div>

        <RosterPanel rows={roster} activeEmail={liveCompose?.professor || activeItem?.professor_email} onClear={async () => { await post('/roster/clear'); setRoster([]); }} />

        </section>

      {/* ─── STEP 2 + 3: Template + Queue side-by-side ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Template */}
        <section ref={sectionTemplateRef} className="space-y-3 scroll-mt-20">
          <div className="flex items-center gap-2.5 px-1">
            <span className="step-badge">2</span>
            <h3 className="font-semibold text-sm text-gray-800 dark:text-gray-100">Email Template</h3>
          </div>
          <GmailComposeChrome
            template={template}
            onSaveInstructions={saveInstructions}
            onDetect={detectPlaceholders}
            sentEmails={sentEmails}
            onPickSent={pickSentEmail}
            onPickLatest={pickLatestSent}
            loading={templateLoading}
            saved={templateSaved}
            settings={settings}
            resetKey={resetKey}
            liveCompose={liveCompose}
          />
        </section>

        {/* Processing Queue */}
        <section ref={sectionQueueRef} className="space-y-3 scroll-mt-20">
          <div className="flex items-center gap-2.5 px-1">
            <span className="step-badge">3</span>
            <h3 className="font-semibold text-sm text-gray-800 dark:text-gray-100">Processing Queue</h3>
            <span className="text-[10px] text-muted ml-auto">{queue.length} items</span>
            {queue.some(q => ['sent', 'skipped'].includes(q.state)) && (
              <button
                onClick={clearCompleted}
                className="text-[10px] font-medium text-gray-500 hover:text-brand-600 dark:text-gray-400 dark:hover:text-brand-400 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />Clear
              </button>
            )}
          </div>
          <div className="card !p-0 overflow-hidden">
            <div className="overflow-auto max-h-[500px]">
              {queue.length === 0 && (
                <div className="text-center py-10 px-4">
                  <Zap className="w-7 h-7 text-gray-200 dark:text-gray-700 mx-auto mb-2" />
                  <p className="text-xs text-muted">Import professors to start</p>
                </div>
              )}
              {queue.length > 0 && (
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-muted text-[10px] uppercase tracking-wider">Name</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted text-[10px] uppercase tracking-wider">Email</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted text-[10px] uppercase tracking-wider">Status</th>
                      <th className="px-3 py-2 text-center font-semibold text-muted text-[10px] uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800/50">
                    {queue.slice(0, 50).map((q) => (
                      <tr key={q.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors group">
                        <td className="px-3 py-2.5 text-gray-800 dark:text-gray-200 truncate max-w-[120px]">
                          {q.professor_email?.split('@')[0] || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-muted truncate max-w-[180px]">
                          {q.professor_email}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`badge text-[9px] min-w-[72px] justify-center ${stateStyle[q.state === 'awaiting_proceed' ? 'awaiting_proceed' : q.state === 'skipped' && q.error === 'duplicate_skipped' ? 'duplicate' : q.state === 'sent' && q.error === 'fallback_no_research' ? 'sent_fallback' : q.state] || ''}`}>
                            {q.state === 'awaiting_proceed' ? 'Awaiting' : q.state === 'skipped' && q.error === 'duplicate_skipped' ? 'Duplicate' : q.state === 'sent' && q.error === 'fallback_no_research' ? 'Fallback' : q.state}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className={`flex items-center justify-center gap-0.5 ${q.state === 'awaiting_proceed' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                            {q.state === 'verified' && <button onClick={() => post(`/queue/${q.id}/send`).then(loadSession)} className="p-1 rounded hover:bg-emerald-50" title="Approve"><Send className="w-3 h-3 text-emerald-500" /></button>}
                            {['failed', 'needs_review', 'skipped'].includes(q.state) && <button onClick={() => retryItem(q.id)} className="p-1 rounded hover:bg-blue-50" title="Retry"><RotateCcw className="w-3 h-3 text-blue-500" /></button>}
                            {['awaiting_proceed', 'pending', 'failed', 'needs_review', 'skipped'].includes(q.state) && (
                              <button onClick={() => proceedNow(q.id)} disabled={proceedingId === q.id} className="p-1 rounded hover:bg-violet-50" title="Proceed">
                                {proceedingId === q.id ? <Loader2 className="w-3 h-3 text-violet-500 animate-spin" /> : <Zap className="w-3 h-3 text-violet-500" />}
                              </button>
                            )}
                            <button onClick={() => deleteItem(q.id)} className="p-1 rounded hover:bg-red-50" title="Delete"><Trash2 className="w-3 h-3 text-red-400" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>  {/* overflow-auto */}
          </div>    {/* card !p-0 */}
        </section>  {/* queue section */}
      </div>        {/* grid */}
      </>} {/* end instant mode */}

      {/* ─── SCHEDULED MODE ─── */}
      {mode === 'scheduled' && (
      <>
        <div className="card p-3 space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${sseConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{sseConnected ? 'Scheduler Connected' : 'Disconnected'}</span>
            </div>
            {!resetConfirm ? (
              <button onClick={() => setResetConfirm(true)} className="text-[10px] font-medium text-gray-500 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-all flex items-center gap-1.5 shrink-0"><Trash2 className="w-3 h-3" /> New Task</button>
            ) : (
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-red-600 font-medium">Clear all?</span>
                <button onClick={resetAll} disabled={resetting} className="text-[10px] font-semibold text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg">Reset</button>
                <button onClick={() => setResetConfirm(false)} className="text-[10px] text-gray-500 px-2 py-1 rounded-lg">Cancel</button>
              </div>
            )}
          </div>
        </div>

        <BatchScrapeProgress progress={scrapeProgress} onStop={async () => { await post('/scrape/cancel'); setScrapeProgress({ running: false }); }} />
        <AnalyticsPanel data={analytics} queueStats={liveStats} />
        <AgentFlowBar scrapePhase={scrapeProgress} activeStage={agentFlowStage} queue={queue} stats={stats} liveLabel={liveCompose?.professor ? `Editing ${liveCompose.professor}` : null} />

        <section className="space-y-3">
          <div className="flex items-center gap-2.5 px-1"><Activity className="w-4 h-4 text-[#1a73e8]" /><h3 className="font-semibold text-sm">Live Activity</h3><span className={`w-2 h-2 rounded-full ml-1 ${sseConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} /></div>
          <LiveFeed events={events} connected={sseConnected} />
        </section>

        <section className="space-y-3 scroll-mt-20">
          <div className="flex items-center gap-2.5 px-1"><span className="step-badge">1</span><h3 className="font-semibold text-sm">Schedule Outreach</h3></div>
          <div className="card space-y-4">
            <div className="flex gap-1 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit">
              {[['url', 'Faculty URL', Globe], ['paste', 'Paste Emails', Edit3]].map(([id, label, Icon]) => (
                <button key={id} onClick={() => setImportTab(id)} className={`flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[11px] font-medium transition-all ${importTab === id ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900' : 'text-gray-500'}`}>
                  <Icon className="w-3.5 h-3.5" />{label}
                </button>
              ))}
            </div>
            {importTab === 'url' && <input value={urlInput} onChange={e => setUrlInput(e.target.value)} className="input text-sm" placeholder="https://cs.stanford.edu/people/faculty" />}
            {importTab === 'paste' && <textarea value={emailInput} onChange={e => setEmailInput(e.target.value)} rows={4} className="input text-xs font-mono" placeholder="professor@mit.edu" />}

            <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <Clock className="w-4 h-4 text-blue-600" />
              <div className="flex-1 space-y-1">
                <p className="text-xs font-semibold text-blue-800 dark:text-blue-200">Schedule date & time</p>
                <div className="flex items-center gap-2">
                  <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} className="input text-xs !py-1.5 !px-2 !bg-blue-50 dark:!bg-blue-900/30 border-blue-200 dark:border-blue-800" />
                  <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} className="input text-xs !py-1.5 !px-2 !bg-blue-50 dark:!bg-blue-900/30 border-blue-200 dark:border-blue-800" />
                </div>
              </div>
              <button onClick={scheduleImport} disabled={importing || !scheduleDate || (!urlInput.trim() && !emailInput.trim())} className="btn-primary text-xs px-4 py-2 shrink-0 bg-blue-600 hover:bg-blue-700">
                {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Clock className="w-3.5 h-3.5" /> Schedule</>}
              </button>
            </div>
            {importMsg && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`text-xs p-2.5 rounded-lg font-medium ${importMsg.startsWith('error:') ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>{importMsg.replace(/^error:/, '')}</motion.div>}
          </div>
          <RosterPanel rows={roster} activeEmail={liveCompose?.professor || activeItem?.professor_email} onClear={async () => { await post('/roster/clear'); setRoster([]); }} />
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2.5 px-1"><span className="step-badge">2</span><h3 className="font-semibold text-sm">Scheduled Batches</h3><span className="text-[10px] text-muted ml-auto">{scheduledBatches.length} batches</span></div>
          <div className="card !p-0 overflow-hidden">
            <div className="overflow-auto max-h-[400px]">
              {scheduledBatches.length === 0 ? (
                <div className="text-center py-10"><Clock className="w-7 h-7 text-gray-200 mx-auto mb-2" /><p className="text-xs text-muted">No scheduled batches yet</p></div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0"><tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Batch</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Scheduled At</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Drafts</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Status</th>
                    <th className="px-3 py-2 text-center font-semibold text-gray-500 text-[10px] uppercase">Actions</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800/50">
                    {scheduledBatches.map(b => (
                      <tr key={b.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 group">
                        <td className="px-3 py-2.5 font-medium"># {b.id}</td>
                        <td className="px-3 py-2.5 text-gray-600">{b.scheduled_at?.replace('T', ' ').slice(0, 16)}</td>
                        <td className="px-3 py-2.5 text-gray-600">{b.draft_count || 0} total · {b.approved_count || 0} approved · {b.sent_count || 0} sent</td>
                        <td className="px-3 py-2.5"><span className={`badge text-[9px] justify-center ${b.status === 'pending' ? 'bg-amber-100 text-amber-700' : b.status === 'processing' ? 'bg-blue-100 text-blue-700' : b.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : b.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>{b.status}</span></td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            <button onClick={() => loadScheduledDrafts(b.id)} className="p-1 rounded hover:bg-blue-50" title="View"><Search className="w-3 h-3 text-blue-500" /></button>
                            {b.status === 'pending' && <button onClick={() => post(`/scheduled/batch/${b.id}/send-now`).then(loadScheduledBatches)} className="p-1 rounded hover:bg-emerald-50" title="Send now"><Send className="w-3 h-3 text-emerald-500" /></button>}
                            {['pending','processing'].includes(b.status) && <button onClick={() => post(`/scheduled/batch/${b.id}/approve-all`).then(() => loadScheduledDrafts(b.id))} className="p-1 rounded hover:bg-violet-50" title="Approve all"><ShieldCheck className="w-3 h-3 text-violet-500" /></button>}
                            <button onClick={() => del(`/scheduled/batch/${b.id}`).then(() => { loadScheduledBatches(); setScheduledDrafts([]); })} className="p-1 rounded hover:bg-red-50" title="Cancel"><Trash2 className="w-3 h-3 text-red-400" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>

        {scheduledDrafts.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2.5 px-1"><span className="step-badge">3</span><h3 className="font-semibold text-sm">Scheduled Drafts</h3><span className="text-[10px] text-muted ml-auto">{scheduledDrafts.length} drafts</span></div>
            <div className="card !p-0 overflow-hidden">
              <div className="overflow-auto max-h-[400px]">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0"><tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Name</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Email</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Subject</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Status</th>
                    <th className="px-3 py-2 text-center font-semibold text-gray-500 text-[10px] uppercase">Actions</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800/50">
                    {scheduledDrafts.map(d => (
                      <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 group">
                        <td className="px-3 py-2.5 truncate max-w-[100px]">{d.last_name || d.professor_email?.split('@')[0]}</td>
                        <td className="px-3 py-2.5 truncate max-w-[160px] text-gray-600">{d.professor_email}</td>
                        <td className="px-3 py-2.5 truncate max-w-[180px] text-gray-600">{d.subject || '—'}</td>
                        <td className="px-3 py-2.5"><span className={`badge text-[9px] justify-center ${d.status === 'draft' ? 'bg-amber-100 text-amber-700' : d.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : d.status === 'sent' ? 'bg-blue-100 text-blue-700' : d.status === 'failed' ? 'bg-red-100 text-red-700' : ''}`}>{d.status}</span></td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            {d.status === 'draft' && <button onClick={() => post(`/scheduled/draft/${d.id}/approve`).then(() => loadScheduledDrafts(d.batch_id))} className="p-1 rounded hover:bg-emerald-50" title="Approve"><ShieldCheck className="w-3 h-3 text-emerald-500" /></button>}
                            <button onClick={() => del(`/scheduled/draft/${d.id}`).then(() => loadScheduledDrafts(d.batch_id))} className="p-1 rounded hover:bg-red-50" title="Remove"><Trash2 className="w-3 h-3 text-red-400" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <section className="space-y-3"><div className="flex items-center gap-2.5 px-1"><span className="step-badge">4</span><h3 className="font-semibold text-sm">Email Template</h3></div>
            <GmailComposeChrome template={template} onSaveInstructions={saveInstructions} onDetect={detectPlaceholders} sentEmails={sentEmails} onPickSent={pickSentEmail} onPickLatest={pickLatestSent} loading={templateLoading} saved={templateSaved} settings={settings} resetKey={resetKey} liveCompose={liveCompose} />
          </section>
          <section className="space-y-3"><div className="flex items-center gap-2.5 px-1"><span className="step-badge">5</span><h3 className="font-semibold text-sm">Processing Queue</h3><span className="text-[10px] text-muted ml-auto">{queue.length} items</span></div>
            <div className="card !p-0 overflow-hidden"><div className="overflow-auto max-h-[500px]">
              {queue.length === 0 ? <div className="text-center py-10"><Zap className="w-7 h-7 text-gray-200 mx-auto mb-2" /><p className="text-xs text-muted">Queue empty</p></div> : (
                <table className="w-full text-xs"><thead className="bg-gray-50 dark:bg-gray-800 sticky top-0"><tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Name</th><th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Email</th><th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Status</th><th className="px-3 py-2 text-center font-semibold text-gray-500 text-[10px] uppercase">Actions</th>
                </tr></thead><tbody className="divide-y divide-gray-50 dark:divide-gray-800/50">
                  {queue.slice(0,50).map(q => (<tr key={q.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 group">
                    <td className="px-3 py-2.5 truncate max-w-[120px]">{q.professor_email?.split('@')[0] || '—'}</td><td className="px-3 py-2.5 truncate max-w-[180px] text-gray-600">{q.professor_email}</td>
                    <td className="px-3 py-2.5"><span className={`badge text-[9px] justify-center ${stateStyle[q.state] || ''}`}>{q.state}</span></td>
                    <td className="px-3 py-2.5 text-center"><div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100"><button onClick={() => deleteItem(q.id)} className="p-1 rounded hover:bg-red-50"><Trash2 className="w-3 h-3 text-red-400" /></button></div></td>
                  </tr>))}
                </tbody></table>
              )}
            </div></div>
          </section>
        </div>
      </>
      )}
    </div>
  );
}
