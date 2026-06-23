import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { Clock, AlertTriangle, Activity, Zap, FileText, Globe, Loader2, Trash2, Search, FileSpreadsheet, Edit3, ShieldCheck, Send, CheckCircle2, Calendar, Table2, Mail, Plus, Users, Eye, Save, ListChecks, X } from 'lucide-react';
import { get, post, del, put } from '../api.js';
import { useSession } from '../context/SessionContext.jsx';
import { useEventStream } from '../core/EventStreamProvider.jsx';
import useGmailAuth from '../hooks/useGmailAuth.js';
import { useToast } from '../components/Toast.jsx';
import GmailComposeChrome from '../components/GmailComposeChrome.jsx';
import StepCard from '../components/StepCard.jsx';
import AgentStepToast from '../components/AgentStepToast.jsx';
import WorkflowPage from '../components/layout/WorkflowPage.jsx';
import { AnalyticsPopupRegistration } from '../context/AnalyticsPopupContext.jsx';
import ReplyAnalyticsSection from '../components/layout/ReplyAnalyticsSection.jsx';
import LiveRosterPanel from '../components/LiveRosterPanel.jsx';
import ScheduledSendTimePanel from '../components/ScheduledSendTimePanel.jsx';
import ScheduledAgentFlowBar from '../components/ScheduledAgentFlowBar.jsx';
import OnboardingChecklist from '../components/OnboardingChecklist.jsx';
import ReadyForNewBanner from '../components/ReadyForNewBanner.jsx';
import ResetNotice from '../components/ResetNotice.jsx';
import BasicSubjectOptions, { basicSubjectModeFromSettings } from '../components/BasicSubjectOptions.jsx';
import DesignationSkipFilter from '../components/DesignationSkipFilter.jsx';
import { useTimezone } from '../context/TimezoneContext.jsx';
import { useSettingsModal } from '../context/SettingsModalContext.jsx';
import useOperationalSummary from '../hooks/useOperationalSummary.js';
import { rescheduleLocalToUtcIso } from '../utils/scheduleTime.js';
import { TIMEZONE_COUNTRIES } from '../data/timezones.js';
import { formatDateTime12, formatTime12, parseServerDate } from '../utils/dateTime.js';
import WorkflowDeck, { WorkflowSlide } from '../components/layout/WorkflowDeck.jsx';
import CombinedLiveSection from '../components/layout/CombinedLiveSection.jsx';
import CommandStrip from '../components/layout/CommandStrip.jsx';

const BATCH_STATUS_STYLE = {
  pending: 'bg-amber-100 text-amber-700',
  processing: 'bg-blue-100 text-blue-700',
  drafted: 'bg-violet-100 text-violet-700',
  scheduled: 'bg-indigo-100 text-indigo-700',
  rescheduled: 'bg-fuchsia-100 text-fuchsia-700',
  sending: 'bg-cyan-100 text-cyan-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

const DRAFT_STATUS_STYLE = {
  draft: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  sending: 'bg-cyan-100 text-cyan-700',
  sent: 'bg-blue-100 text-blue-700',
  resent: 'bg-indigo-100 text-indigo-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
  needs_web_research: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
};

// ─── FILE PREVIEW ────────────────────────────────────
function FilePreview({ data, onConfirm, onCancel, importing, subjectModeLabel }) {
  if (!data) return null;
  const stats = data.parseStats;
  const count = data.rosterEntries?.length || data.emails?.length || 0;
  return (
    <div className="mt-3 border border-gray-200 dark:border-neutral-700 rounded-xl overflow-hidden bg-white dark:bg-neutral-900">
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-neutral-800 border-b border-gray-200 dark:border-neutral-700">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-brand-500" />
          <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{data.filename}</span>
        </div>
        <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-neutral-800 px-2 py-0.5 rounded">
          {count} professor{count !== 1 ? 's' : ''} organized
        </span>
      </div>
      {stats && (
        <div className="px-4 py-2 text-[10px] text-muted border-b border-gray-200 dark:border-neutral-700">
          {stats.withName} with last name · {stats.withKeywords} with research keywords
        </div>
      )}
      {data.type === 'text' && (
        <div className="overflow-auto max-h-[250px] bg-gray-50 dark:bg-black border-b border-gray-200 dark:border-neutral-700">
          <pre className="px-4 py-3 text-[11px] font-mono text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{data.content}</pre>
        </div>
      )}
      {data.type === 'spreadsheet' && data.sheets?.map((sheet, si) => (
        <div key={si} className="overflow-auto max-h-[250px]">
          {data.sheets.length > 1 && <div className="px-3 py-1 text-[10px] font-medium text-muted bg-gray-50 dark:bg-neutral-800/50">{sheet.name}</div>}
          <table className="w-full text-[11px] border-collapse">
            {sheet.headers.length > 0 && (
              <thead><tr className="bg-gray-50 dark:bg-neutral-800">
                {sheet.headers.map((h, i) => <th key={i} className="px-3 py-1.5 text-left font-semibold text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-neutral-700 whitespace-nowrap">{h || `Col ${i + 1}`}</th>)}
              </tr></thead>
            )}
            <tbody>
              {sheet.rows.slice(0, 20).map((row, ri) => (
                <tr key={ri} className="border-b border-gray-100 dark:border-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-800/30">
                  {row.map((cell, ci) => {
                    const isEmail = /[\w.-]+@[\w.-]+\.[a-z]{2,}/i.test(cell);
                    return <td key={ci} className={`px-3 py-1.5 whitespace-nowrap ${isEmail ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>{cell}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-neutral-800">
        <span className="text-[10px] text-muted">
          {count} ready to schedule
          {subjectModeLabel && <> · {subjectModeLabel}</>}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Cancel</button>
          <button onClick={onConfirm} disabled={importing || count === 0} className="btn-primary text-xs px-4 py-1.5">
            {importing ? <Loader2 className="w-3 h-3 animate-spin" /> : <><CheckCircle2 className="w-3 h-3" /> Use {count} Professors</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── BATCH CARD (enhanced: roster, inline edit, reschedule, progress) ───
function formatBatchDelta(target) {
  if (!target) return 'No time';
  const ms = parseServerDate(target)?.getTime() - Date.now();
  const abs = Math.abs(ms);
  const minutes = Math.round(abs / 60000);
  if (minutes < 1) return ms >= 0 ? 'due now' : 'overdue';
  if (minutes < 60) return `${ms >= 0 ? 'in' : 'overdue by'} ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return `${ms >= 0 ? 'in' : 'overdue by'} ${hours}h${mins ? ` ${mins}m` : ''}`;
  const days = Math.floor(hours / 24);
  return `${ms >= 0 ? 'in' : 'overdue by'} ${days}d`;
}

function ScheduledTimingBoard({ batches, onOpenBatch, onSendOverdueNow }) {
  const active = (batches || []).filter(b => !['completed', 'cancelled', 'failed'].includes(b.status));
  const next = [...active].filter(b => b.scheduled_at).sort((a, b) => parseServerDate(a.scheduled_at) - parseServerDate(b.scheduled_at))[0];
  const overdue = active.filter(b => b.scheduled_at && parseServerDate(b.scheduled_at)?.getTime() <= Date.now() && b.status !== 'sending');
  const manualReady = active.filter(b => b.status === 'drafted' && !b.auto_approve);
  const autoReady = active.filter(b => b.status === 'scheduled' && b.auto_approve);

  if (!batches?.length) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
      <div className="rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-card))] p-3">
        <p className="text-[9px] uppercase tracking-wider font-semibold text-muted">Next batch</p>
        <p className="text-lg font-bold tabular-nums text-[rgb(var(--text-primary))]">{next ? `#${next.id}` : '-'}</p>
        <p className="text-[10px] text-muted">{next ? `${formatBatchDelta(next.scheduled_at)} - ${next.status}` : 'No active time'}</p>
      </div>
      <div className="rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-card))] p-3">
        <p className="text-[9px] uppercase tracking-wider font-semibold text-muted">Auto batches</p>
        <p className="text-lg font-bold tabular-nums text-emerald-600">{autoReady.length}</p>
        <p className="text-[10px] text-muted">send on saved time</p>
      </div>
      <div className="rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-card))] p-3">
        <p className="text-[9px] uppercase tracking-wider font-semibold text-muted">Manual review</p>
        <p className="text-lg font-bold tabular-nums text-violet-600">{manualReady.length}</p>
        <p className="text-[10px] text-muted">approve or send all</p>
      </div>
      <div className="rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-card))] p-3">
        <p className="text-[9px] uppercase tracking-wider font-semibold text-muted">Overdue</p>
        <p className="text-lg font-bold tabular-nums text-amber-600">{overdue.length}</p>
        {overdue.length ? (
          <div className="flex flex-col gap-1">
            <button type="button" onClick={() => onSendOverdueNow?.()} className="text-[10px] font-semibold text-amber-700 hover:underline text-left">
              send all now
            </button>
            <button type="button" onClick={() => onOpenBatch?.(overdue[0].id)} className="text-[10px] font-semibold text-amber-700 hover:underline text-left">
              open batch #{overdue[0].id}
            </button>
          </div>
        ) : (
          <p className="text-[10px] text-muted">all timing clear</p>
        )}
      </div>
    </div>
  );
}

function targetTimeStatus(date, tz) {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hour12: false,
  }).format(date));
  if (hour >= 8 && hour < 17) return { label: 'Business', cls: 'text-emerald-700 bg-emerald-100 dark:bg-neutral-800 dark:text-emerald-400' };
  if (hour >= 17 && hour < 22) return { label: 'Off hours', cls: 'text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300' };
  return { label: 'Sleep', cls: 'text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-300' };
}

function SelectedTargetTimePreview({ scheduledAt, selectedCountries }) {
  const countries = TIMEZONE_COUNTRIES.filter(c => selectedCountries.includes(c.id));
  if (!scheduledAt || !countries.length) return null;

  return (
    <div className="rounded-xl border border-blue-200 dark:border-neutral-700 bg-blue-50/70 dark:bg-neutral-800 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <p className="text-xs font-semibold text-blue-800 dark:text-blue-300">Target country time preview</p>
        </div>
        <span className="text-[10px] text-blue-700/80 dark:text-blue-300/80">
          Sends at your selected local time. These are equivalent professor times.
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
        {countries.map(c => {
          const status = targetTimeStatus(scheduledAt, c.tz);
          const time = scheduledAt.toLocaleTimeString('en-US', {
            timeZone: c.tz,
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          });
          const date = scheduledAt.toLocaleDateString('en-US', {
            timeZone: c.tz,
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          });
          return (
            <div key={c.id} className="rounded-lg border border-blue-100 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-gray-900 dark:text-gray-100 truncate">{c.flag} {c.label}</p>
                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${status.cls}`}>{status.label}</span>
              </div>
              <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white mt-1">{time}</p>
              <p className="text-[10px] text-muted">{date} · {c.tz}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DeliveryFailureCard({ failures, onRefresh, filter = 'all', onClearFilter }) {
  const toast = useToast();
  const [workingId, setWorkingId] = useState(null);
  const [bulkAction, setBulkAction] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingEmail, setEditingEmail] = useState('');
  const allFailureRows = failures || [];
  const failureRows = allFailureRows.filter(failure => (
    filter === 'all'
    || (filter === 'pending' && failure.status === 'pending')
    || (filter === 'not_found' && failure.failure_type === 'not_found')
    || (filter === 'send_limit' && failure.failure_type === 'send_limit')
    || (filter === 'failed' && !['not_found', 'send_limit'].includes(failure.failure_type))
  ));

  const run = async (label, fn) => {
    try {
      const res = await fn();
      toast.success(res?.message || `${label} complete`);
      onRefresh?.();
    } catch (e) {
      toast.error(e.message || `${label} failed`);
    }
  };

  const scan = async () => {
    setBulkAction('scan');
    await run('Scan', () => post('/delivery-failures/scan', {}, { timeout: 180000 }));
    setBulkAction('');
  };

  const sendOne = async (id) => {
    const row = failureRows.find(item => item.id === id);
    if (!window.confirm(`Resend the saved outreach to ${row?.professor_email || 'this recipient'}? This failure can be resent only once.`)) return;
    setWorkingId(id);
    await run('Send', () => post(`/delivery-failures/${id}/send`, { confirm: true }, { timeout: 120000 }));
    setWorkingId(null);
  };

  const sendAll = async (failureType) => {
    if (!window.confirm(`Resend every pending ${label(failureType).toLowerCase()} item once?`)) return;
    setBulkAction(failureType);
    await run('Send all', () => post('/delivery-failures/send-all', { failure_type: failureType }, { timeout: 300000 }));
    setBulkAction('');
  };

  const rejectAll = async () => {
    setBulkAction('reject');
    await run('Reject all', () => post('/delivery-failures/reject-all', {}, { timeout: 30000 }));
    setBulkAction('');
  };

  const saveEmail = async (id) => {
    setWorkingId(id);
    await run('Update email', () => put(`/delivery-failures/${id}/email`, { email: editingEmail }, { timeout: 30000 }));
    setEditingId(null);
    setEditingEmail('');
    setWorkingId(null);
  };

  const label = (type) => type === 'send_limit' ? 'Send limit' : type === 'not_found' ? 'Not found' : 'Failed';
  const openFailures = allFailureRows.filter(f => f.status === 'pending');
  const limitCount = openFailures.filter(f => f.failure_type === 'send_limit').length;
  const notFoundCount = openFailures.filter(f => f.failure_type === 'not_found').length;

  return (
    <section className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50/70 dark:bg-red-950/10 overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-red-200 dark:border-red-900/40">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-red-800 dark:text-red-300">Delivery failures</h3>
            <p className="text-[10px] text-red-700/80 dark:text-red-300/80">Gmail bounces, send limits, and addresses not found</p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={scan} disabled={bulkAction === 'scan'} className="text-[10px] font-semibold px-3 py-1.5 rounded-lg bg-white/80 dark:bg-neutral-900 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-900/40">
            {bulkAction === 'scan' ? 'Scanning...' : 'Scan Gmail'}
          </button>
          <button type="button" onClick={() => sendAll('send_limit')} disabled={!limitCount || bulkAction === 'send_limit'} className="text-[10px] font-semibold px-3 py-1.5 rounded-lg bg-orange-600 text-white disabled:opacity-50">
            Send limit failed ({limitCount})
          </button>
          <button type="button" onClick={() => sendAll('not_found')} disabled={!notFoundCount || bulkAction === 'not_found'} className="text-[10px] font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white disabled:opacity-50">
            Send not found ({notFoundCount})
          </button>
          <button type="button" onClick={rejectAll} disabled={!openFailures.length || bulkAction === 'reject'} className="text-[10px] font-semibold px-3 py-1.5 rounded-lg bg-white/80 dark:bg-neutral-900 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/40 disabled:opacity-50">
            Reject all
          </button>
          <button type="button" onClick={onRefresh} className="text-[10px] font-semibold px-3 py-1.5 rounded-lg bg-white/80 dark:bg-neutral-900 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/40">
            Refresh
          </button>
        </div>
      </div>
      {filter !== 'all' && (
        <div className="px-4 py-2 flex items-center justify-between gap-2 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-900/40">
          <span className="text-[10px] font-semibold text-amber-800 dark:text-amber-300">Filter: {label(filter)}</span>
          <button type="button" onClick={onClearFilter} className="text-[10px] font-semibold text-amber-700 hover:underline">Clear filter</button>
        </div>
      )}
      <div className="overflow-auto max-h-[320px] bg-[rgb(var(--surface-card))]">
        <table className="w-full text-xs min-w-[760px]">
          <thead className="sticky top-0 bg-[rgb(var(--surface-muted))]">
            <tr>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted">Email</th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted">Type</th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted">Reason</th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted">Received</th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted">Status</th>
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--border-subtle))]">
            {failureRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted">No delivery failures loaded. Use Scan Gmail to import bounces and limit messages.</td>
              </tr>
            )}
            {failureRows.map(f => (
              <React.Fragment key={f.id}>
                <tr className="hover:bg-[rgb(var(--surface-muted))]/50">
                  <td className="px-3 py-2 font-mono text-[11px] text-[rgb(var(--text-primary))]">
                    {editingId === f.id ? (
                      <input value={editingEmail} onChange={e => setEditingEmail(e.target.value)} className="input text-[11px] py-1" />
                    ) : f.professor_email}
                  </td>
                  <td className="px-3 py-2"><span className="badge text-[9px] bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">{label(f.failure_type)}</span></td>
                  <td className="px-3 py-2 text-muted max-w-[260px] truncate" title={f.reason || ''}>{f.reason || '-'}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{formatDateTime12(f.received_at, '-')}</td>
                  <td className="px-3 py-2 text-muted">{f.status || 'pending'}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {editingId === f.id ? (
                        <>
                          <button type="button" onClick={() => saveEmail(f.id)} disabled={workingId === f.id} className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold text-[10px]">Save</button>
                          <button type="button" onClick={() => setEditingId(null)} className="px-2 py-1 rounded-lg bg-gray-500/10 text-muted font-semibold text-[10px]">Cancel</button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => setExpandedId(expandedId === f.id ? null : f.id)} className="px-2 py-1 rounded-lg bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-semibold text-[10px]">View</button>
                          {f.status === 'pending' && (
                            <>
                              <button type="button" onClick={() => { setEditingId(f.id); setEditingEmail(f.professor_email || ''); }} className="px-2 py-1 rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-300 font-semibold text-[10px]">Edit email</button>
                              <button type="button" onClick={() => sendOne(f.id)} disabled={workingId === f.id} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold text-[10px] disabled:opacity-60">
                                {workingId === f.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                                Send
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                {expandedId === f.id && (
                  <tr>
                    <td colSpan={6} className="px-3 py-3 bg-[rgb(var(--surface-muted))]/40">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">Bounce / reply text</p>
                          <pre className="text-[10px] whitespace-pre-wrap max-h-40 overflow-auto rounded-lg bg-[rgb(var(--surface-card))] border border-[rgb(var(--border-subtle))] p-2">{f.raw_excerpt || 'No bounce text stored'}</pre>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">Linked draft</p>
                          <p className="text-xs text-muted">Draft #{f.draft_id || '-'} · Batch #{f.batch_id || '-'}</p>
                          <p className="text-[10px] text-muted mt-1">Use Edit email before Send if the address was wrong. The resend uses the same saved draft body and subject.</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BatchCard({ batch, expanded, onExpand, onRefresh, onBatchDeleted }) {
  const { settings } = useSession();
  const [tab, setTab] = useState('drafts'); // 'drafts' | 'roster'
  const [drafts, setDrafts] = useState([]);
  const [professors, setProfessors] = useState([]);
  const [editingDraftId, setEditingDraftId] = useState(null);
  const [editSubject, setEditSubject] = useState('');
  const [editInterest, setEditInterest] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('09:00');
  const [confirmAction, setConfirmAction] = useState(null); // {type: 'send'|'cancel'|'approve'}
  const [batchDetails, setBatchDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [, setClockTick] = useState(0);

  // Resend state for completed batches
  const [resendRescheduling, setResendRescheduling] = useState(false);
  const [resendDate, setResendDate] = useState('');
  const [resendTime, setResendTime] = useState('09:00');

  // View/Edit popup state
  const [popupDraft, setPopupDraft] = useState(null);  // draft object
  const [popupMode, setPopupMode] = useState('view');  // 'view' | 'edit'
  const [popupHtml, setPopupHtml] = useState('');
  const [editPopupSubject, setEditPopupSubject] = useState('');
  const [editPopupInterest, setEditPopupInterest] = useState('');
  const [editPopupEmail, setEditPopupEmail] = useState('');
  const [popupSaved, setPopupSaved] = useState(false);
  const [popupSaving, setPopupSaving] = useState(false);
  const [webSearchingDraftId, setWebSearchingDraftId] = useState(null);
  const [sendingDraftId, setSendingDraftId] = useState(null);
  const toast = useToast();
  const editableRef = useRef(null);

  const statusBadge = BATCH_STATUS_STYLE[batch.status] || 'bg-gray-100 text-gray-700';
  const isProcessing = ['pending', 'processing'].includes(batch.status);
  const progressPct = batch.total > 0 ? Math.round(((batch.sent_count || 0) + (batch.approved_count || 0) + (batch.failed_count || 0)) / batch.total * 100) : 0;
  const unsentCount = drafts.filter(d => !['sent', 'cancelled'].includes(d.status)).length;

  useEffect(() => {
    if (!batch.scheduled_at || ['completed', 'cancelled'].includes(batch.status)) return undefined;
    const timer = setInterval(() => setClockTick(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [batch.scheduled_at, batch.status]);

  useEffect(() => {
    if (expanded) {
      get(`/scheduled/batch/${batch.id}/drafts`).then(setDrafts).catch(() => {});
      if (tab === 'roster') get(`/scheduled/batch/${batch.id}/professors`).then(setProfessors).catch(() => {});
    }
  }, [expanded, tab, batch.id]);

  const refreshData = () => {
    get(`/scheduled/batch/${batch.id}/drafts`).then(setDrafts).catch(() => {});
    if (tab === 'roster') get(`/scheduled/batch/${batch.id}/professors`).then(setProfessors).catch(() => {});
    onRefresh?.();
  };

  const openBatchDetails = async () => {
    setDetailsLoading(true);
    try {
      setBatchDetails(await get(`/scheduled/batch/${batch.id}/details`));
    } catch (error) {
      toast.error(error.message || 'Could not load batch details');
    } finally {
      setDetailsLoading(false);
    }
  };

  const sendScheduledDraftNow = async (draftId) => {
    if (sendingDraftId) return;
    setSendingDraftId(draftId);
    try {
      const res = await post(`/scheduled/draft/${draftId}/send-now`);
      toast.success(res?.status === 'resent' ? 'Draft resent' : 'Draft sent');
      refreshData();
    } catch (e) {
      toast.error(e?.data?.error || e.message || 'Could not send draft');
      console.error('Scheduled send-now failed', e);
    } finally {
      setSendingDraftId(null);
    }
  };

  const webSearchDraft = async (draftId) => {
    setWebSearchingDraftId(draftId);
    try {
      await post(`/scheduled/draft/${draftId}/web-research`);
      toast.success('Web search complete — draft ready for review');
      refreshData();
    } catch (e) {
      toast.error(e.message || 'Web search failed');
    } finally {
      setWebSearchingDraftId(null);
    }
  };

  const startEditDraft = (d) => {
    setEditingDraftId(d.id);
    setEditSubject(d.subject || '');
    setEditInterest(d.interest_line || '');
  };

  const saveDraftEdit = async () => {
    setSavingEdit(true);
    try {
      await put(`/scheduled/draft/${editingDraftId}`, { subject: editSubject, interest_line: editInterest });
      setEditingDraftId(null);
      refreshData();
    } catch (e) { toast.error(e.message || 'Could not save draft'); }
    setSavingEdit(false);
  };

  const doReschedule = async () => {
    const scheduled_at = rescheduleLocalToUtcIso(rescheduleDate, rescheduleTime);
    if (!scheduled_at) return;
    try {
      await put(`/scheduled/batch/${batch.id}/reschedule`, { scheduled_at });
      setRescheduling(false);
      onRefresh?.();
    } catch (e) { toast.error(e.message || 'Reschedule failed'); }
  };

  const doConfirmAction = async () => {
    if (!confirmAction) return;
    try {
      if (confirmAction.type === 'send') await post(`/scheduled/batch/${batch.id}/send-now`);
      else if (confirmAction.type === 'cancel') {
        await del(`/scheduled/batch/${batch.id}`);
        onBatchDeleted?.(batch.id);
      }
      else if (confirmAction.type === 'purge') {
        await del(`/scheduled/batch/${batch.id}/purge`);
        onBatchDeleted?.(batch.id);
      }
      else if (confirmAction.type === 'approve') await post(`/scheduled/batch/${batch.id}/approve-all`);
      else if (confirmAction.type === 'auto_approve') await put(`/scheduled/batch/${batch.id}/auto-approve`, { auto_approve: !batch.auto_approve });
      else if (confirmAction.type === 'resend') {
        const res = await post(`/scheduled/batch/${batch.id}/resend-remaining`);
        if (res?.batchId) toast.success(`Batch #${res.batchId} resending ${res.draftCount || 0} unsent draft(s)`);
      }
    } catch (e) {
      const msg = e?.data?.verification?.draftFailures?.length
        ? `Pre-send verification failed: ${e.data.verification.draftFailures.map(f => f.errors.join(', ')).join('; ')}`
        : (e.message || 'Action failed');
      toast?.error?.(msg);
    }
    setConfirmAction(null);
    onRefresh?.();
  };

  // Resend a completed batch immediately (inline confirm via confirmAction)
  const requestResendNow = () => {
    setConfirmAction({ type: 'resend' });
  };

  const rescheduleIn30Minutes = async () => {
    try {
      const scheduled_at = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await put(`/scheduled/batch/${batch.id}/reschedule`, { scheduled_at });
      toast.success(`Batch #${batch.id} moved 30 minutes`);
      onRefresh?.();
    } catch (e) {
      toast.error(e.message || 'Reschedule failed');
    }
  };

  // Reschedule & resend
  const doRescheduleResend = async () => {
    const scheduled_at = rescheduleLocalToUtcIso(resendDate, resendTime);
    if (!scheduled_at) return;
    try {
      const res = await post(`/scheduled/batch/${batch.id}/reschedule-resend`, { scheduled_at });
      if (res?.batchId) toast?.success?.(`Batch #${res.batchId} created — scheduled for ${formatDateTime12(scheduled_at)}`);
      setResendRescheduling(false);
      onRefresh?.();
    } catch (e) {
      toast.error('Reschedule failed: ' + (e.message || 'unknown error'));
    }
  };

  const cleanInterestLine = (line) => (line || '').replace(/I am (?:particularly )?interested in your work (?:on|in) ?/gi, '').trim();

  const wrapEmailHtml = (html) => (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&display=swap" rel="stylesheet"><style>body{margin:0;padding:16px 20px;font-family:'Roboto',Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;} p{margin:0 0 1em 0} ul,ol{margin:0.5em 0;padding-left:2em} li{margin:0.25em 0}</style></head><body>${html || ''}</body></html>`
  );

  const openPopup = async (d, mode = 'view') => {
    setPopupDraft(d);
    setPopupMode(mode);
    setEditPopupSubject(d.subject || '');
    setEditPopupInterest(d.interest_line || '');
    setEditPopupEmail(d.professor_email || '');
    setPopupSaved(false);
    setPopupHtml(wrapEmailHtml(d.custom_html || d.html_preview || ''));
  };

  const savePopupEdit = async () => {
    if (!popupDraft) return;
    setPopupSaving(true);
    const html = editableRef.current?.innerHTML || '';
    try {
      await put(`/scheduled/draft/${popupDraft.id}`, {
        subject: editPopupSubject,
        interest_line: editPopupInterest,
        professor_email: editPopupEmail,
        custom_html: html,
      });
      refreshData();
      setPopupDraft(prev => prev ? {
        ...prev,
        subject: editPopupSubject,
        interest_line: editPopupInterest,
        professor_email: editPopupEmail,
        custom_html: html,
      } : prev);
      setPopupHtml(wrapEmailHtml(html));
      setPopupSaved(true);
      setTimeout(() => setPopupSaved(false), 2500);
    } catch (e) { toast.error(e.message || 'Could not save email'); }
    setPopupSaving(false);
  };

  const approveFromPopup = async () => {
    if (!popupDraft) return;
    try {
      await post(`/scheduled/draft/${popupDraft.id}/approve`);
      refreshData();
      setPopupDraft(null);
    } catch (e) { toast.error(e.message || 'Approve failed'); }
  };

  const deleteFromPopup = async () => {
    if (!popupDraft) return;
    try {
      await del(`/scheduled/draft/${popupDraft.id}`);
      refreshData();
      setPopupDraft(null);
    } catch (e) { toast.error(e.message || 'Delete failed'); }
  };

  // Set contentEditable innerHTML when popup opens in edit mode
  useEffect(() => {
    if (popupDraft && popupMode === 'edit' && editableRef.current) {
      editableRef.current.innerHTML = popupDraft.custom_html || popupDraft.html_preview || '';
    }
  }, [popupDraft, popupMode, popupHtml]);

  return (
    <div className="card !p-0 overflow-hidden border border-gray-200 dark:border-neutral-700">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-neutral-800/40" onClick={onExpand}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm font-bold text-gray-900 dark:text-gray-100">#{batch.id}</span>
          <span className={`badge text-[9px] justify-center ${statusBadge}`}>{batch.status}</span>
          {batch.status !== 'completed' && (
            <button onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: batch.status === 'cancelled' ? 'purge' : 'cancel' }); }}
              className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="Delete Batch #{batch.id}">
              <Trash2 className="w-3.5 h-3.5 text-red-500" />
            </button>
          )}
          {batch.status === 'pending' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-neutral-800 text-muted font-medium">Queued</span>}
          {batch.auto_approve === 1 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-neutral-800 text-emerald-600 dark:text-emerald-400 font-medium">Auto-approve</span>}
          {batch.batch_mode === 'basic_scheduled' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-teal-50 dark:bg-neutral-800 text-teal-600 dark:text-teal-400 font-medium">Basic</span>}
          {batch.source_url && <span className="text-[9px] text-gray-400 truncate max-w-[120px]" title={batch.source_url}>📎 URL</span>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-muted flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {batch.gmail_retry_at
              ? `Gmail retry ${formatDateTime12(batch.gmail_retry_at)} · ${formatBatchDelta(batch.gmail_retry_at)}`
              : batch.scheduled_at
                ? `${formatDateTime12(batch.scheduled_at)} · ${formatBatchDelta(batch.scheduled_at)}`
                : '—'}
          </span>
          <span className="text-xs text-gray-600 dark:text-gray-300">
            {batch.draft_count || 0} drafts
            {(batch.needs_web_count > 0) && ` · ${batch.needs_web_count} need web`}
            {batch.sent_count > 0 && ` · ${batch.sent_count} sent`}
            {batch.failed_count > 0 && ` · ${batch.failed_count} failed`}
          </span>
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); openBatchDetails(); }}
            disabled={detailsLoading}
            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 px-2.5 py-1.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-950/30"
          >
            {detailsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListChecks className="h-3 w-3" />}
            Details
          </button>
          <Search className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Progress bar for processing batches */}
      {isProcessing && batch.total > 0 && (
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 mb-1">
            <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
              Processing {batch._current || batch.approved_count || 0}/{batch.total}
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-neutral-700 rounded-full h-1.5">
            <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {/* Pipeline flow bar */}
      <div className="px-4 pb-2">
        <ScheduledAgentFlowBar batch={batch} />
      </div>

      {expanded && (
        <>
          {/* Tabs */}
          <div className="flex items-center gap-1 px-4 pt-2 border-t border-gray-100 dark:border-neutral-800">
            <button onClick={(e) => { e.stopPropagation(); setTab('drafts'); }}
              className={`text-[10px] font-medium px-3 py-1.5 rounded-t-lg transition-colors ${tab === 'drafts' ? 'bg-white dark:bg-neutral-900 text-blue-600 border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-700'}`}>
              Drafts ({batch.draft_count || 0})
            </button>
            <button onClick={(e) => { e.stopPropagation(); setTab('roster'); get(`/scheduled/batch/${batch.id}/professors`).then(setProfessors).catch(() => {}); }}
              className={`text-[10px] font-medium px-3 py-1.5 rounded-t-lg transition-colors ${tab === 'roster' ? 'bg-white dark:bg-neutral-900 text-emerald-600 border-b-2 border-emerald-500' : 'text-gray-500 hover:text-gray-700'}`}>
              Roster ({batch.total || 0})
            </button>
          </div>

          {/* Drafts tab */}
          {tab === 'drafts' && drafts.length > 0 && (
            <div className="overflow-auto max-h-[350px]">
              {drafts.some(d => d.status === 'needs_web_research') && (
                <div className="px-3 py-2 border-b border-amber-100 dark:border-amber-900/30 bg-amber-50/50 dark:bg-amber-950/20 flex justify-end">
                  <button
                    type="button"
                    onClick={async () => {
                      setWebSearchingDraftId('bulk');
                      try {
                        await post(`/scheduled/batch/${batch.id}/web-research-bulk`);
                        toast.success('Bulk web search finished');
                        refreshData();
                      } catch (e) {
                        toast.error(e.message || 'Bulk web search failed');
                      } finally {
                        setWebSearchingDraftId(null);
                      }
                    }}
                    disabled={webSearchingDraftId === 'bulk'}
                    className="text-[10px] px-3 py-1.5 flex items-center gap-1 rounded-lg bg-sky-500/10 text-sky-700 dark:text-sky-300 font-medium"
                  >
                    {webSearchingDraftId === 'bulk' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Globe className="w-3 h-3" />}
                    Web search all ({drafts.filter(d => d.status === 'needs_web_research').length})
                  </button>
                </div>
              )}
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-neutral-800 sticky top-0"><tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Sr.</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Name</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Last Name</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Email</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Subject</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Interest Line</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Status</th>
                  <th className="px-3 py-2 text-center font-semibold text-gray-500 text-[10px] uppercase">Action</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800/50">
                  {drafts.map((d, i) => (
                    <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-neutral-800/40 group">
                      <td className="px-3 py-2.5 tabular-nums text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2.5 truncate max-w-[120px] text-gray-900 dark:text-gray-100">{d.full_name || d.professor_name || d.last_name || d.professor_email?.split('@')[0]}</td>
                      <td className="px-3 py-2.5 truncate max-w-[120px] text-gray-600">{d.last_name || '—'}</td>
                      <td className="px-3 py-2.5 truncate max-w-[140px] text-gray-600">{d.professor_email}</td>
                      {editingDraftId === d.id ? (
                        <>
                          <td className="px-3 py-1.5"><input value={editSubject} onChange={e => setEditSubject(e.target.value)} className="w-full bg-gray-50 dark:bg-neutral-800 border border-gray-300 dark:border-neutral-600 rounded px-2 py-1 text-[10px] text-gray-900 dark:text-gray-100" /></td>
                          <td className="px-3 py-1.5"><input value={editInterest} onChange={e => setEditInterest(e.target.value)} className="w-full bg-gray-50 dark:bg-neutral-800 border border-gray-300 dark:border-neutral-600 rounded px-2 py-1 text-[10px] text-gray-900 dark:text-gray-100" /></td>
                          <td className="px-3 py-2.5"></td>
                          <td className="px-3 py-2.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={saveDraftEdit} disabled={savingEdit} className="p-1 rounded hover:bg-emerald-50" title="Save">
                                {savingEdit ? <Loader2 className="w-3 h-3 animate-spin text-emerald-500" /> : <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                              </button>
                              <button onClick={() => setEditingDraftId(null)} className="p-1 rounded hover:bg-gray-100" title="Cancel"><Trash2 className="w-3 h-3 text-gray-400" /></button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2.5 truncate max-w-[140px] text-gray-600">{d.subject || (d.status === 'needs_web_research' ? '—' : '—')}</td>
                          <td className="px-3 py-2.5 truncate max-w-[140px] text-gray-500">
                            {d.status === 'needs_web_research' ? (
                              <span className="text-amber-700 dark:text-amber-300 text-[10px]">{d.error || 'No info on page'}</span>
                            ) : (d.interest_line || '—')}
                          </td>
                          <td className="px-3 py-2.5"><span className={`badge text-[9px] justify-center ${DRAFT_STATUS_STYLE[d.status] || ''}`}>{d.status === 'needs_web_research' ? 'needs web search' : d.status}</span></td>
                          <td className="px-3 py-2.5 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {d.status === 'needs_web_research' && (
                                <button
                                  type="button"
                                  onClick={() => webSearchDraft(d.id)}
                                  disabled={webSearchingDraftId === d.id}
                                  className="px-2 py-1 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-[9px] font-semibold text-sky-700 dark:text-sky-300 flex items-center gap-1"
                                  title="Search publications on the internet"
                                >
                                  {webSearchingDraftId === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Globe className="w-3 h-3" />}
                                  Web search
                                </button>
                              )}
                              {(d.custom_html || d.html_preview || (d.subject && d.status !== 'needs_web_research')) ? (
                                <button onClick={(e) => { e.stopPropagation(); openPopup(d, 'view'); }} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-indigo-200 text-[10px] font-semibold text-indigo-600 hover:bg-indigo-50 dark:border-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/20" title="View email">
                                  <Search className="w-3 h-3" /> View
                                </button>
                              ) : null}
                              {['draft', 'approved', 'sent', 'resent'].includes(d.status) && (
                                <button onClick={(e) => { e.stopPropagation(); openPopup(d, 'edit'); }} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-blue-200 text-[10px] font-semibold text-blue-600 hover:bg-blue-50 dark:border-blue-900/40 dark:text-blue-300 dark:hover:bg-blue-900/20" title="Edit email">
                                  <Edit3 className="w-3 h-3" /> Edit
                                </button>
                              )}
                              {d.status === 'draft' && (
                                <button onClick={() => post(`/scheduled/draft/${d.id}/approve`).then(refreshData)} className="p-1 rounded hover:bg-emerald-50" title="Approve">
                                  <ShieldCheck className="w-3 h-3 text-emerald-500" />
                                </button>
                              )}
                              {d.status !== 'cancelled' && (
                                <button onClick={() => del(`/scheduled/draft/${d.id}`).then(refreshData)} className="p-1 rounded hover:bg-red-50" title="Remove">
                                  <Trash2 className="w-3 h-3 text-red-400" />
                                </button>
                              )}
                              {d.status === 'sent' || d.status === 'resent' ? (
                                <button onClick={() => sendScheduledDraftNow(d.id)} disabled={sendingDraftId === d.id} className="px-2 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-[9px] font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1 disabled:opacity-60" title="Resend email">
                                  {sendingDraftId === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Resend
                                </button>
                              ) : (
                                <button onClick={() => sendScheduledDraftNow(d.id)} disabled={sendingDraftId === d.id} className="px-2 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-[9px] font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1 disabled:opacity-60" title="Send now">
                                  {sendingDraftId === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Send
                                </button>
                              )}
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Roster tab */}
          {tab === 'roster' && (
            <div className="overflow-auto max-h-[350px]">
              {professors.length === 0 ? (
                <div className="text-center py-6"><Table2 className="w-5 h-5 text-gray-200 mx-auto mb-1" /><p className="text-[10px] text-muted">No professors found yet</p></div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-emerald-50 dark:bg-emerald-950/40 sticky top-0"><tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Name</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Email</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">University</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Research</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 text-[10px] uppercase">Draft</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800/50">
                    {professors.map(p => (
                      <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-neutral-800/40">
                        <td className="px-3 py-2 font-medium truncate max-w-[120px] text-gray-900 dark:text-gray-100">{p.last_name || p.email?.split('@')[0] || '—'}</td>
                        <td className="px-3 py-2 truncate max-w-[160px] text-gray-600">{p.email}</td>
                        <td className="px-3 py-2 truncate max-w-[120px] text-gray-500">{p.university || '—'}</td>
                        <td className="px-3 py-2 truncate max-w-[180px] text-gray-500">{p.research_areas || '—'}</td>
                        <td className="px-3 py-2"><span className={`badge text-[9px] justify-center ${DRAFT_STATUS_STYLE[p.draft_status] || 'bg-gray-100 text-gray-500'}`}>{p.draft_status || 'no draft'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Reschedule */}
          {rescheduling ? (
            <div className="border-t border-gray-100 dark:border-neutral-800 flex items-center gap-3 px-4 py-3 bg-yellow-50 dark:bg-yellow-900/10">
              <Calendar className="w-4 h-4 text-yellow-600 shrink-0" />
              <input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} className="input text-xs w-36" min={new Date().toISOString().split('T')[0]} />
              <input type="time" value={rescheduleTime} onChange={e => setRescheduleTime(e.target.value)} className="input text-xs w-28" />
              <button onClick={doReschedule} disabled={!rescheduleDate} className="btn-primary text-[10px] px-3 py-1.5">Save</button>
              <button onClick={() => setRescheduling(false)} className="text-[10px] text-gray-500 hover:text-gray-700">Cancel</button>
            </div>
          ) : null}

          {/* Resend reschedule picker (for completed batches) */}
          {resendRescheduling ? (
            <div className="border-t border-gray-100 dark:border-neutral-800 flex items-center gap-3 px-4 py-3 bg-blue-50 dark:bg-neutral-800">
              <Calendar className="w-4 h-4 text-blue-600 shrink-0" />
              <span className="text-[10px] font-medium text-blue-700 dark:text-blue-300">Reschedule &amp; Resend Batch #{batch.id}</span>
              <input type="date" value={resendDate} onChange={e => setResendDate(e.target.value)} className="input text-xs w-36" min={new Date().toISOString().split('T')[0]} />
              <input type="time" value={resendTime} onChange={e => setResendTime(e.target.value)} className="input text-xs w-28" />
              <button onClick={doRescheduleResend} disabled={!resendDate} className="btn-primary text-[10px] px-3 py-1.5">Create &amp; Schedule</button>
              <button onClick={() => setResendRescheduling(false)} className="text-[10px] text-gray-500 hover:text-gray-700">Cancel</button>
            </div>
          ) : null}

          {/* Confirm dialog */}
          {confirmAction && (
            <div className="border-t border-gray-100 dark:border-neutral-800 flex items-center gap-3 px-4 py-3 bg-red-50 dark:bg-neutral-800">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              <span className="text-xs text-red-700 dark:text-red-300">
                {confirmAction.type === 'send' && 'Send all approved, failed, and draft rows now? Sent rows stay skipped.'}
                {confirmAction.type === 'cancel' && `Cancel Batch #${batch.id} and all its drafts?`}
                {confirmAction.type === 'purge' && `Permanently delete Batch #${batch.id} and all its data?`}
                {confirmAction.type === 'approve' && 'Approve all pending drafts?'}
                {confirmAction.type === 'auto_approve' && (batch.auto_approve ? 'Disable auto-approve? New drafts will need manual approval.' : 'Enable auto-approve? New drafts will be auto-approved.')}
                {confirmAction.type === 'resend' && `Resend Batch #${batch.id} for only unsent emails? Sent emails will be skipped.`}
              </span>
              <button onClick={doConfirmAction} className="btn-primary text-[10px] px-3 py-1.5 bg-red-600 hover:bg-red-700">Confirm</button>
              <button onClick={() => setConfirmAction(null)} className="text-[10px] text-gray-500 hover:text-gray-700">Cancel</button>
            </div>
          )}

          {/* Action bar */}
          <div className="border-t border-gray-100 dark:border-neutral-800 flex flex-wrap items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-neutral-800/50">
            {['drafted', 'processing'].includes(batch.status) && (
              <button onClick={() => setConfirmAction({ type: 'approve' })} className="btn-primary text-[10px] px-3 py-1.5 bg-violet-600 hover:bg-violet-700">
                <ShieldCheck className="w-3 h-3" /> Approve All
              </button>
            )}
            {!['cancelled', 'sending'].includes(batch.status) && (unsentCount > 0 || batch.approved_count > 0 || batch.failed_count > 0 || ['pending', 'drafted', 'scheduled'].includes(batch.status)) && (
              <button onClick={() => setConfirmAction({ type: 'send' })} className="btn-primary text-[10px] px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700">
                <Send className="w-3 h-3" /> Send Now
              </button>
            )}
            {batch.status === 'completed' && (
              <button onClick={requestResendNow} className="btn-primary text-[10px] px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700">
                <Send className="w-3 h-3" /> Resend Now
              </button>
            )}
            {batch.status === 'completed' && (
              <button onClick={() => { setResendRescheduling(true); setResendDate(''); setResendTime('09:00'); }}
                className="text-[10px] px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-medium transition-colors flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Reschedule &amp; Resend
              </button>
            )}
            {!['completed', 'cancelled', 'sending'].includes(batch.status) && (
              <button onClick={rescheduleIn30Minutes}
                className="text-[10px] text-blue-600 hover:text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors flex items-center gap-1">
                <Clock className="w-3 h-3" /> +30 min
              </button>
            )}
            {!['completed', 'cancelled', 'sending'].includes(batch.status) && (
              <button onClick={() => { setRescheduling(true); const d = batch.scheduled_at?.split('T'); if (d) { setRescheduleDate(d[0]); setRescheduleTime((d[1] || '09:00').slice(0, 5)); } }}
                className="text-[10px] text-amber-600 hover:text-amber-700 px-3 py-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Edit Time
              </button>
            )}
            <button onClick={() => setConfirmAction({ type: 'auto_approve' })}
              className={`text-[10px] px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 ${batch.auto_approve ? 'text-emerald-600 hover:bg-emerald-50' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
              <ShieldCheck className="w-3 h-3" /> {batch.auto_approve ? 'Auto approval' : 'Manual approval'}
            </button>
          </div>
        </>
      )}

      {/* View/Edit compose modal */}
      {popupDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setPopupDraft(null)}>
          <div className="w-full max-w-5xl mx-4 bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-neutral-700 overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-neutral-800 border-b border-gray-200 dark:border-neutral-700 shrink-0">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-brand-500" />
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{popupMode === 'view' ? 'View Email' : 'Edit Email'}</span>
                <span className="text-[10px] text-muted">{popupMode === 'edit' ? editPopupEmail : popupDraft.professor_email}</span>
              </div>
              <div className="flex items-center gap-2">
                {popupSaved && <span className="text-[10px] font-medium text-emerald-500 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Saved</span>}
                {popupMode === 'view' ? (
                  <button onClick={() => setPopupMode('edit')} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/10 transition-colors"><Edit3 className="w-3 h-3" /> Switch to Edit</button>
                ) : (
                  <button onClick={() => setPopupMode('view')} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"><Eye className="w-3 h-3" /> Switch to View</button>
                )}
                <button onClick={() => setPopupDraft(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">x</button>
              </div>
            </div>

            <div className="border border-gray-200 dark:border-neutral-700 rounded-lg mx-4 mt-3 overflow-hidden shrink-0">
              <div className="px-3 py-2 bg-gray-50 dark:bg-neutral-800 border-b border-gray-100 dark:border-neutral-700 text-[10px] text-gray-500 space-y-1">
                <div className="flex items-center gap-2"><span className="text-gray-400 w-8">From</span><span>{settings?.sender_email || settings?.gmail_email || 'connected Gmail'}</span></div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 w-8">To</span>
                  {popupMode === 'edit' ? (
                    <input value={editPopupEmail} onChange={e => setEditPopupEmail(e.target.value)} className="flex-1 text-[11px] font-medium text-gray-700 dark:text-gray-300 bg-transparent focus:outline-none" />
                  ) : (
                    <span className="text-gray-700 dark:text-gray-300 font-medium">{popupDraft.professor_email}</span>
                  )}
                </div>
              </div>
              <div className="px-3 py-2 border-b border-gray-100 dark:border-neutral-700">
                {popupMode === 'edit' ? (
                  <input value={editPopupSubject} onChange={e => setEditPopupSubject(e.target.value)} className="w-full text-sm font-medium text-gray-800 dark:text-gray-100 bg-transparent focus:outline-none" />
                ) : (
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{popupDraft.subject || 'Draft email'}</p>
                )}
              </div>
              {!batch.batch_mode?.includes('basic') && (
                <div className="px-3 py-2">
                  {popupMode === 'edit' ? (
                    <input value={editPopupInterest} onChange={e => setEditPopupInterest(cleanInterestLine(e.target.value))} className="w-full text-[11px] text-gray-600 dark:text-gray-300 bg-transparent focus:outline-none" placeholder="Interest line" />
                  ) : (
                    <p className="text-[11px] text-gray-600 dark:text-gray-300">Interest: {popupDraft.interest_line || '-'}</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-auto mx-4 mt-2 mb-2">
              {popupMode === 'view' ? (
                <iframe srcDoc={popupHtml} className="w-full min-h-[350px] bg-white rounded-lg border border-gray-200 dark:border-neutral-700" title="Email preview" sandbox="allow-same-origin" />
              ) : (
                <div ref={editableRef} contentEditable suppressContentEditableWarning
                  className="w-full min-h-[350px] bg-white rounded-lg border border-gray-200 dark:border-neutral-700 [&_p]:mb-[1em] [&_ul]:my-[0.5em] [&_ol]:my-[0.5em] [&_li]:my-[0.25em]"
                  style={{ fontFamily: "'Roboto', Arial, sans-serif", fontSize: '14px', lineHeight: '1.6', color: '#222', padding: '16px 20px' }} />
              )}
            </div>

            <div className="flex items-center gap-2.5 px-7 py-2 border-t border-gray-100 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-800 shrink-0">
              <div className="flex items-center justify-center w-7 h-7 rounded bg-red-100 dark:bg-red-900/30"><FileText className="w-4 h-4 text-red-500" /></div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{settings?.resume_name || 'Resume.pdf'}</p>
                <p className="text-[10px] text-muted">PDF attached when Gmail sends</p>
              </div>
            </div>

            <div className="flex items-center gap-3 px-4 py-3 shrink-0">
              {popupMode === 'edit' && (
                <button onClick={savePopupEdit} disabled={popupSaving} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium text-muted bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-60">
                  {popupSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save Edits
                </button>
              )}
              {popupDraft.status === 'draft' && (
                <button onClick={approveFromPopup} className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold shadow-sm transition-colors">
                  <ShieldCheck className="w-3 h-3" /> Approve
                </button>
              )}
              {popupDraft.status !== 'sent' && popupDraft.status !== 'cancelled' && (
                <button onClick={deleteFromPopup} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              )}
              <button onClick={() => setPopupDraft(null)} className="text-xs text-muted hover:text-gray-600 ml-auto">Close</button>
            </div>
          </div>
        </div>
      )}
      {batchDetails && createPortal(
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm">
          <button type="button" className="absolute inset-0" aria-label="Close batch details" onClick={() => setBatchDetails(null)} />
          <div className="relative flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-neutral-700">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Batch #{batch.id} details</h3>
                <p className="text-[11px] text-muted">Schedule history, Gmail reset recovery, sends, failures, and replies</p>
              </div>
              <button type="button" onClick={() => setBatchDetails(null)} className="rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-neutral-800"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 border-b border-gray-100 p-4 sm:grid-cols-5 dark:border-neutral-800">
              {[
                ['Sent', batchDetails.counts.sent, 'text-emerald-600'],
                ['Remaining', batchDetails.counts.remaining, 'text-blue-600'],
                ['Failed', batchDetails.counts.failed, 'text-red-600'],
                ['Replies', batchDetails.counts.replies, 'text-violet-600'],
                ['Total', batchDetails.counts.total, 'text-gray-900 dark:text-white'],
              ].map(([label, value, color]) => (
                <div key={label} className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-neutral-800 dark:bg-neutral-800/60">
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-muted">{label}</p>
                  <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-3 border-b border-gray-100 px-4 py-3 text-xs sm:grid-cols-3 dark:border-neutral-800">
              <div><p className="text-[9px] uppercase tracking-wider text-muted">Status</p><p className="mt-1 font-semibold">{batchDetails.batch.status}</p></div>
              <div><p className="text-[9px] uppercase tracking-wider text-muted">Gmail reset</p><p className="mt-1 font-semibold">{batchDetails.batch.gmail_reset_at ? formatDateTime12(batchDetails.batch.gmail_reset_at) : 'Not paused'}</p></div>
              <div><p className="text-[9px] uppercase tracking-wider text-muted">Reset + 2 minute retry</p><p className="mt-1 font-semibold">{batchDetails.batch.gmail_retry_at ? formatDateTime12(batchDetails.batch.gmail_retry_at) : batchDetails.batch.scheduled_at ? formatDateTime12(batchDetails.batch.scheduled_at) : '—'}</p></div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <table className="w-full min-w-[720px] text-[11px]">
                <thead className="sticky top-0 bg-gray-50 text-left text-muted dark:bg-neutral-800">
                  <tr><th className="px-3 py-2">Timestamp</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Schedule</th><th className="px-3 py-2">Gmail reset</th><th className="px-3 py-2">Details</th></tr>
                </thead>
                <tbody>
                  {batchDetails.history.map(row => (
                    <tr key={row.id} className="border-t border-gray-100 dark:border-neutral-800">
                      <td className="whitespace-nowrap px-3 py-2">{row.created_at ? formatDateTime12(row.created_at) : '—'}</td>
                      <td className="px-3 py-2 font-semibold">{String(row.action || '').replaceAll('_', ' ')}</td>
                      <td className="px-3 py-2">{[row.from_status, row.to_status].filter(Boolean).join(' → ') || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2">{row.scheduled_at ? formatDateTime12(row.scheduled_at) : '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2">{row.gmail_reset_at ? formatDateTime12(row.gmail_reset_at) : '—'}</td>
                      <td className="px-3 py-2 text-muted">{row.detail || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─── MAIN SCHEDULED PAGE ───────────────────────────────────
export default function Scheduled() {
  const navigate = useNavigate();
  const {
    scheduledStats, scheduledBatches, scheduledDrafts, scheduledTemplate, basicScheduledTemplate, basicScheduledAgentContext,
    agentContext,
    settings, analytics, health, sessionLoading, sessionRefreshing, connectionsSettled, sessionError, resetting, sessionVersion,
    backendReachable,
    setScheduledBatches, setScheduledDrafts, setScheduledStats, setScheduledTemplate, setBasicScheduledTemplate,
    setSettings, setAnalytics, setMode, loadSession, resetSession, applyReset, setAuth,
  } = useSession();
  const { selectedCountries } = useTimezone();
  const { openSettings, openSentArchive } = useSettingsModal();

  useEffect(() => { setMode('scheduled'); }, [setMode]);
  const { isConnected } = useGmailAuth();
  const { connected: sseConnected, subscribe } = useEventStream();
  const toast = useToast();

  const [events, setEvents] = useState([]);
  const sessionEpochRef = useRef(0);
  const refreshTimerRef = useRef(null);
  const rosterRequestRef = useRef(null);
  const failureRequestRef = useRef(null);
  const repliesRequestRef = useRef(null);
  const sectionImportRef = useRef(null);
  const sectionBatchRef = useRef(null);
  const sectionTemplateRef = useRef(null);
  const sectionYourBatchesRef = useRef(null);
  const sectionPipelineRef = useRef(null);
  const sectionActivityRef = useRef(null);
  const sectionFailuresRef = useRef(null);
  const sectionRepliesRef = useRef(null);
  const sectionDuplicatesRef = useRef(null);

  // Scheduled roster
  const [rosterRows, setRosterRows] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [agentStopped, setAgentStopped] = useState(false);

  // Import + schedule
  const [emailInput, setEmailInput] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [importTab, setImportTab] = useState('url');
  const [filePreview, setFilePreview] = useState(null);
  const [maxProfessors, setMaxProfessors] = useState('');
  const [skipDesignations, setSkipDesignations] = useState([]);
  const [scheduledAt, setScheduledAt] = useState(null);
  // Derive local date/time strings from the Date object for API calls
  const scheduleDate = scheduledAt ? `${scheduledAt.getFullYear()}-${String(scheduledAt.getMonth()+1).padStart(2,'0')}-${String(scheduledAt.getDate()).padStart(2,'0')}` : '';
  const scheduleTime = scheduledAt ? `${String(scheduledAt.getHours()).padStart(2,'0')}:${String(scheduledAt.getMinutes()).padStart(2,'0')}` : '09:00';
  const [autoApprove, setAutoApprove] = useState(true);
  const [pendingSkippedDuplicates, setPendingSkippedDuplicates] = useState([]);
  const [scheduleSubMode, setScheduleSubMode] = useState(() => {
    try { return localStorage.getItem('email-agent-schedule-submode') || 'scheduled'; } catch { return 'scheduled'; }
  });
  const [keywordSaving, setKeywordSaving] = useState(false);
  const [webSearchingDraftId, setWebSearchingDraftId] = useState(null);

  const webSearchScheduledDraft = async (draftId) => {
    setWebSearchingDraftId(draftId);
    try {
      await post(`/scheduled/draft/${draftId}/web-research`);
      toast.success('Web search complete — draft ready');
      loadSession();
    } catch (e) {
      showErrorToast(e.message || 'Web search failed');
    } finally {
      setWebSearchingDraftId(null);
    }
  };

  const webSearchScheduledBulk = async (batchId) => {
    setWebSearchingDraftId('bulk');
    try {
      const res = await post(`/scheduled/batch/${batchId}/web-research-bulk`);
      toast.success(`Web search finished for ${res.processed} draft(s)`);
      loadSession();
    } catch (e) {
      showErrorToast(e.message || 'Bulk web search failed');
    } finally {
      setWebSearchingDraftId(null);
    }
  };

  const isBasicSchedule = scheduleSubMode === 'basic_scheduled';
  const defaultSubjectEnabled = !!settings?.basic_subject_keyword;
  const searchSubjectEnabled = !!settings?.basic_search_subject_keyword;
  const basicSubjectMode = basicSubjectModeFromSettings(settings);
  const activeScheduledTemplate = isBasicSchedule ? basicScheduledTemplate : scheduledTemplate;
  const activeAgentContext = isBasicSchedule ? basicScheduledAgentContext : agentContext;
  const [agentToast, setAgentToast] = useState(null);
  const agentToastTimerRef = useRef(null);

  // Batch expansion
  const [expandedBatchId, setExpandedBatchId] = useState(null);

  // Template
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);

  // Reset
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [resetToast, setResetToast] = useState(false);
  const [resetError, setResetError] = useState('');

  const [sentEmails, setSentEmails] = useState([]);
  const [replies, setReplies] = useState([]);
  const [deliveryFailures, setDeliveryFailures] = useState([]);
  const [batchFilter, setBatchFilter] = useState('all');
  const [replyFilter, setReplyFilter] = useState('all');
  const [failureFilter, setFailureFilter] = useState('all');
  const [openSignals, setOpenSignals] = useState({});
  const [highlightTarget, setHighlightTarget] = useState('');
  const { data: apiUsage, refresh: refreshOperational, freshness } = useOperationalSummary(scheduleSubMode);

  const setScheduleClockTime = useCallback((value) => {
    const [hourRaw, minuteRaw] = String(value || '').split(':');
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return;
    const base = scheduledAt ? new Date(scheduledAt) : new Date();
    base.setHours(hour, minute, 0, 0);
    setScheduledAt(base);
  }, [scheduledAt]);

  useEffect(() => {
    try { localStorage.setItem('email-agent-schedule-submode', scheduleSubMode); } catch { /* ignore */ }
  }, [scheduleSubMode]);

  useEffect(() => {
    if (isBasicSchedule && !basicScheduledTemplate) {
      get('/scheduled/template?mode=basic_scheduled').then(t => {
        if (t?.raw_html) setBasicScheduledTemplate(t);
      }).catch(() => {});
    }
  }, [isBasicSchedule, sessionVersion, basicScheduledTemplate, setBasicScheduledTemplate]);

  const saveBasicSubjectOptions = useCallback(async ({ defaultSubject, searchSubjectKeyword, activeToggle }) => {
    if (keywordSaving) return;
    const prev = { defaultSubject: defaultSubjectEnabled, searchSubjectKeyword: searchSubjectEnabled };
    setKeywordSaving(true);
    setSettings(s => s ? {
      ...s,
      basic_subject_keyword: defaultSubject ? 1 : 0,
      basic_search_subject_keyword: searchSubjectKeyword ? 1 : 0,
    } : s);
    try {
      const res = await post('/settings/basic-subject-options', { defaultSubject, searchSubjectKeyword, activeToggle }, { timeout: 15000 });
      if (res?.settings) setSettings(res.settings);
      const basicTpl = await get('/scheduled/template?mode=basic_scheduled');
      if (basicTpl?.raw_html) setBasicScheduledTemplate(basicTpl);
    } catch (e) {
      setSettings(s => s ? {
        ...s,
        basic_subject_keyword: prev.defaultSubject ? 1 : 0,
        basic_search_subject_keyword: prev.searchSubjectKeyword ? 1 : 0,
      } : s);
      toast.error(e.message || 'Could not update subject options');
    } finally {
      setKeywordSaving(false);
    }
  }, [defaultSubjectEnabled, searchSubjectEnabled, keywordSaving, setSettings, setBasicScheduledTemplate, toast]);

  const toggleDefaultSubject = useCallback(() => {
    const next = !defaultSubjectEnabled;
    saveBasicSubjectOptions({ defaultSubject: next, searchSubjectKeyword: next ? false : searchSubjectEnabled, activeToggle: 'default' });
  }, [defaultSubjectEnabled, searchSubjectEnabled, saveBasicSubjectOptions]);

  const toggleSearchSubject = useCallback(() => {
    const next = !searchSubjectEnabled;
    saveBasicSubjectOptions({ defaultSubject: next ? false : defaultSubjectEnabled, searchSubjectKeyword: next, activeToggle: 'search' });
  }, [defaultSubjectEnabled, searchSubjectEnabled, saveBasicSubjectOptions]);

  const pushActivity = useCallback((entry) => {
    setActivityLog(prev => [{
      id: `${Date.now()}-${entry.stage}`,
      time: formatTime12(new Date()),
      ...entry,
    }, ...prev].slice(0, 20));
  }, []);

  const showAgentStep = useCallback((data) => {
    const label = data.label || data.phase || data.type;
    if (!label) return;
    clearTimeout(agentToastTimerRef.current);
    const stage = data.phase || data.type || 'step';
    setAgentToast({ stage, label, professor: data.email || data.professor, batchId: data.batchId, tokens: data.tokens, at: Date.now() });
    agentToastTimerRef.current = setTimeout(() => setAgentToast(null), 5000);
    pushActivity({ stage, label, professor: data.email || data.professor, error: data.error });
  }, [pushActivity]);

  const showErrorToast = useCallback((message) => {
    clearTimeout(agentToastTimerRef.current);
    setAgentToast({ stage: 'error', label: message || 'Something went wrong', at: Date.now() });
    agentToastTimerRef.current = setTimeout(() => setAgentToast(null), 8000);
    pushActivity({ stage: 'error', label: message || 'Something went wrong', error: true });
  }, [pushActivity]);

  const fetchRoster = useCallback(async () => {
    if (rosterRequestRef.current) return rosterRequestRef.current;
    const request = get('/scheduled/roster', { timeout: 20000 })
      .then(rows => setRosterRows(rows))
      .catch(error => toast.error(error.message || 'Scheduled roster could not refresh'))
      .finally(() => { rosterRequestRef.current = null; });
    rosterRequestRef.current = request;
    return request;
  }, [toast]);

  const fetchDeliveryFailures = useCallback(async () => {
    if (failureRequestRef.current) return failureRequestRef.current;
    const request = get('/delivery-failures?mode=scheduled', { timeout: 20000 })
      .then(rows => setDeliveryFailures(rows))
      .catch(error => toast.error(error.message || 'Delivery failures could not refresh'))
      .finally(() => { failureRequestRef.current = null; });
    failureRequestRef.current = request;
    return request;
  }, [toast]);

  const fetchReplies = useCallback(async () => {
    if (repliesRequestRef.current) return repliesRequestRef.current;
    const request = get('/replies?mode=scheduled', { timeout: 20000 })
      .then(rows => setReplies(rows))
      .catch(error => toast.error(error.message || 'Replies could not refresh'))
      .finally(() => { repliesRequestRef.current = null; });
    repliesRequestRef.current = request;
    return request;
  }, [toast]);

  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      loadSession();
      fetchRoster();
      fetchDeliveryFailures();
      refreshOperational();
    }, 600);
  }, [loadSession, fetchRoster, fetchDeliveryFailures, refreshOperational]);

  useEffect(() => { fetchRoster(); }, [fetchRoster]);
  useEffect(() => { fetchDeliveryFailures(); }, [fetchDeliveryFailures, sessionVersion]);

  const clearLocalState = () => {
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
    setExpandedBatchId(null);
    setRosterRows([]);
    setScheduledBatches([]);
    setScheduledDrafts([]);
  };

  const clearImportFormForNextBatch = () => {
    setEmailInput('');
    setUrlInput('');
    setFilePreview(null);
    setMaxProfessors('');
    setPendingSkippedDuplicates([]);
    setScheduledAt(null);
    setImportTab('file');
    setRosterRows([]);
  };

  useEffect(() => () => {
    clearTimeout(refreshTimerRef.current);
    clearTimeout(agentToastTimerRef.current);
  }, []);

  useEffect(() => {
    if (scheduledStats?.sessionEpoch != null) sessionEpochRef.current = scheduledStats.sessionEpoch;
  }, [scheduledStats?.sessionEpoch]);

  // ── SSE subscription — only scheduled-mode events ──
  useEffect(() => {
    return subscribe((data) => {
      // Only process scheduled-mode events
      const isScheduledEvent = data.mode === 'scheduled' || (data.type && data.type.startsWith('scheduled_'));
      if (data.type === 'reset') {
        const epoch = data.sessionEpoch ?? sessionEpochRef.current + 1;
        sessionEpochRef.current = epoch;
        applyReset(epoch);
        clearLocalState();
        setResetToast(true);
        setTimeout(() => setResetToast(false), 5000);
        return;
      }
      if (data.type === 'gmail_connected') {
        setAuth(prev => ({
          ...prev,
          authenticated: true,
          senderEmail: data.email || prev?.senderEmail,
          senderName: data.name || prev?.senderName,
          canSend: true,
          canLoadTemplate: true,
        }));
        if (data.switched) loadSession({ force: true });
        return;
      }
      if (data.type === 'gmail_disconnected') {
        setAuth({ authenticated: false, senderEmail: null, senderName: null, canSend: false, canLoadTemplate: false });
        return;
      }
      if (data.type === 'agent_stopped') {
        setAgentStopped(true);
        setAgentToast(null);
        setScheduledBatches(prev => prev.map(b => (b.status === 'processing' || b.status === 'sending') ? { ...b, status: 'drafted', _phase: null } : b));
        scheduleRefresh();
        return;
      }
      // Ignore instant-mode events on this page
      if (!isScheduledEvent) return;

      if (data.sessionEpoch != null && data.sessionEpoch !== sessionEpochRef.current) return;

      if (data.type === 'delivery_failure_updated') {
        scheduleRefresh();
        return;
      }

      if (data.type === 'scheduled_batch_processing_started') {
        setScheduledBatches(prev => prev.map(b => b.id === data.batchId ? { ...b, status: 'processing' } : b));
        scheduleRefresh();
      }
      if (data.type === 'scheduled_batch_progress') {
        showAgentStep(data);
        setScheduledBatches(prev => prev.map(b => b.id === data.batchId ? { ...b, status: data.phase === 'complete' ? (b.auto_approve ? 'scheduled' : 'drafted') : 'processing', _phase: data.phase, _label: data.label, _current: data.current, _total: data.total } : b));
      }
      if (data.type === 'scheduled_draft_ready') {
        if (data.professorEmail) {
          setRosterRows(prev => {
            const norm = data.professorEmail.toLowerCase();
            const idx = prev.findIndex(r => (r.email || '').toLowerCase() === norm);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = {
                ...next[idx],
                draft_status: 'draft',
                interest_line: data.interest_line || data.interestLine || next[idx].interest_line,
                subject: data.subject || next[idx].subject,
                research_info: data.fromWebResearch ? 'From web' : next[idx].research_info,
              };
              return next;
            }
            return prev;
          });
        }
        if (data.fromWebResearch) {
          toast.success(`Web search complete — draft ready for ${data.professorEmail || 'professor'}`);
        }
        scheduleRefresh();
      }
      if (data.type === 'scheduled_batch_approved') {
        setScheduledBatches(prev => prev.map(b => b.id === data.batchId ? { ...b, status: 'scheduled' } : b));
        scheduleRefresh();
      }
      if (data.type === 'scheduled_batch_drafted') {
        scheduleRefresh();
      }
      if (data.type === 'scheduled_batch_manual_due') {
        toast.info(data.label || `Batch #${data.batchId} is ready to review and send`);
        setExpandedBatchId(data.batchId);
        scheduleRefresh();
      }
      if (data.type === 'scheduled_batch_ready_soon') {
        toast.info(data.label || `Batch #${data.batchId} is ready to send`);
        scheduleRefresh();
      }
      if (data.type === 'scheduled_batch_retry_scheduled') {
        toast.info(data.label || `Batch #${data.batchId} will retry in 30 seconds`);
        setScheduledBatches(prev => prev.map(batch => batch.id === data.batchId ? {
          ...batch,
          status: 'scheduled',
          scheduled_at: data.retryAt || batch.scheduled_at,
          gmail_retry_at: data.retryAt || batch.gmail_retry_at,
          gmail_reset_at: data.resetAt || batch.gmail_reset_at,
        } : batch));
        scheduleRefresh();
      }
      if (data.type === 'scheduled_batch_sending') {
        setScheduledBatches(prev => prev.map(b => b.id === data.batchId ? { ...b, status: 'sending' } : b));
        showAgentStep({ phase: 'sending', label: `Sending batch #${data.batchId}`, batchId: data.batchId });
      }
      if (data.type === 'scheduled_sending_paused') {
        const retryAt = data.retryAt ? formatDateTime12(data.retryAt) : null;
        const message = retryAt
          ? `Gmail paused sending until ${retryAt}. The batch will resume automatically.`
          : data.reason || data.error || 'Gmail temporarily paused sending';
        toast.error(message);
        setAgentStopped(true);
        setScheduledBatches(prev => prev.map(batch => batch.id === data.batchId ? {
          ...batch,
          status: 'scheduled',
          scheduled_at: data.retryAt || batch.scheduled_at,
          gmail_retry_at: data.retryAt || batch.gmail_retry_at,
          gmail_reset_at: data.gmailResetAt || batch.gmail_reset_at,
        } : batch));
        showErrorToast(message);
        scheduleRefresh();
      }
      if (data.type === 'scheduled_send_limit_reached') {
        toast.error(data.error || 'Gmail send limit reached — sending stopped');
        setAgentStopped(true);
        scheduleRefresh();
      }
      if (data.type === 'scheduled_batch_complete') {
        setScheduledBatches(prev => prev.map(b => b.id === data.batchId ? { ...b, status: 'completed', sent: data.sent } : b));
        toast.success('Done');
        scheduleRefresh();
      }
      if (data.type === 'scheduled_batch_error') {
        setScheduledBatches(prev => prev.map(b => b.id === data.batchId ? { ...b, status: 'failed' } : b));
        showErrorToast(data.error || 'Batch failed');
      }
      if (data.type === 'scheduled_draft_sent') {
        setScheduledDrafts(prev => prev.map(d => d.id === data.draftId ? { ...d, status: 'sent' } : d));
        setScheduledBatches(prev => prev.map(b => b.id === data.batchId ? { ...b, sent_count: (b.sent_count || 0) + 1 } : b));
      }
      if (data.type === 'scheduled_draft_failed') {
        setScheduledDrafts(prev => prev.map(d => d.id === data.draftId ? { ...d, status: 'failed', error: data.error } : d));
      }
      if (data.type === 'scheduled_batch_cancelled') {
        setScheduledBatches(prev => prev.filter(b => b.id !== data.batchId));
        if (expandedBatchId === data.batchId) setExpandedBatchId(null);
      }
      if (data.type === 'scheduled_batch_deleted' || data.type === 'scheduled_batch_purged') {
        setScheduledBatches(prev => prev.filter(b => b.id !== data.batchId));
        setScheduledDrafts(prev => prev.filter(d => d.batch_id !== data.batchId));
        setRosterRows(prev => prev.filter(r => String(r.batch_id) !== String(data.batchId)));
        if (expandedBatchId === data.batchId) setExpandedBatchId(null);
      }
      if (data.type === 'scheduled_batch_updated' && data.status) {
        setScheduledBatches(prev => prev.map(b => b.id === data.batchId ? { ...b, status: data.status } : b));
      }

      setEvents(prev => [{ ...data, time: formatTime12(new Date()) }, ...prev].slice(0, 50));
    });
  }, [subscribe, applyReset, loadSession, scheduleRefresh, showAgentStep, showErrorToast, setScheduledBatches, setScheduledDrafts, expandedBatchId, setAuth]);

  useEffect(() => {
    if (isConnected) get('/gmail/sent').then(setSentEmails).catch(() => setSentEmails([]));
    else setSentEmails([]);
  }, [isConnected]);

  useEffect(() => {
    fetchReplies();
    fetchDeliveryFailures();
  }, [scheduledStats?.sent, sessionVersion, fetchDeliveryFailures, fetchReplies]);

  // ── Actions ──

  const createBatch = async () => {
    if (!scheduledAt) { setImportMsg('Pick a date and time first'); setTimeout(() => setImportMsg(''), 3000); return; }
    if (!urlInput && !emailInput && !filePreview?.emails?.length && !filePreview?.rosterEntries?.length) { setImportMsg('Provide a URL, emails, or file'); setTimeout(() => setImportMsg(''), 3000); return; }

    // Convert local time to UTC ISO string for correct backend comparison
    const scheduled_at = scheduledAt ? scheduledAt.toISOString() : `${scheduleDate}T${scheduleTime}:00`;
    setImporting(true);
    setAgentStopped(false);
    try {
      if (filePreview?.rosterEntries?.length) {
        await post('/upload/roster', { rosterEntries: filePreview.rosterEntries });
      }
      const emails = filePreview?.rosterEntries?.length
        ? filePreview.rosterEntries
        : filePreview?.emails?.length
          ? filePreview.emails
          : (emailInput?.trim() ? emailInput : undefined);
      const res = await post('/scheduled/batch', {
        scheduled_at,
        url: urlInput || undefined,
        emails,
        auto_approve: autoApprove ? 1 : 0,
        max_professors: maxProfessors ? parseInt(maxProfessors) : undefined,
        skip_duplicates: true,
        batch_mode: scheduleSubMode,
        target_countries: selectedCountries.length ? selectedCountries : undefined,
        ...(skipDesignations.length ? { skip_designations: skipDesignations } : {}),
      });
      setImportMsg(res.skippedDuplicates?.length
        ? `Batch #${res.batchId} scheduled — ${res.skippedDuplicates.length} duplicate(s) skipped (see archive). ${res.processedCount ?? 0} new professor(s) queued.`
        : `Batch #${res.batchId} (${isBasicSchedule ? 'Basic' : 'Normal'}) scheduled for ${formatDateTime12(scheduledAt)} — agent processing started`);
      setPendingSkippedDuplicates(res.skippedDuplicates || []);
      setExpandedBatchId(res.batchId);
      clearImportFormForNextBatch();
      loadSession();
      setTimeout(() => sectionYourBatchesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    } catch (e) {
      setImportMsg(e.message || 'Schedule failed');
      showErrorToast(e.message || 'Schedule failed');
    }
    setImporting(false);
    setTimeout(() => setImportMsg(''), 8000);
  };

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      const response = await fetch('/api/upload/preview', { method: 'POST', body: form, signal: controller.signal });
      const res = await response.json().catch(() => ({}));
      clearTimeout(timer);
      if (!response.ok || res.error) {
        const message = res.error || `Upload failed (${response.status})`;
        setImportMsg(message);
        showErrorToast(message);
      } else {
        setFilePreview(res);
      }
    } catch (err) {
      const message = err.name === 'AbortError' ? 'Upload timed out' : `Upload failed: ${err.message || 'Network error'}`;
      setImportMsg(message);
      showErrorToast(message);
    }
    setImporting(false);
    e.target.value = '';
  };

  const resetAll = async () => {
    setResetConfirm(false);
    setResetError('');
    clearLocalState();
    const result = await resetSession(isBasicSchedule ? 'basic_scheduled' : 'scheduled');
    if (result.success) {
      sessionEpochRef.current = result.sessionEpoch ?? sessionEpochRef.current;
      setResetToast(true);
      setTimeout(() => setResetToast(false), 5000);
    } else {
      setResetError(result.error || 'Reset failed');
      await loadSession();
    }
  };

  const saveInstructions = async (instructions, sampleSubject) => {
    setTemplateLoading(true);
    await post('/scheduled/template/raw', { instructions, sample_subject: sampleSubject, mode: scheduleSubMode });
    if (isBasicSchedule) {
      const t = await get('/scheduled/template?mode=basic_scheduled');
      if (t?.raw_html) setBasicScheduledTemplate(t);
    } else {
      await loadSession();
    }
    setTemplateLoading(false);
    setTemplateSaved(true);
    setTimeout(() => setTemplateSaved(false), 3000);
  };

  const detectPlaceholders = async () => {
    setTemplateLoading(true);
    await post('/template/detect', { mode: 'scheduled' });
    await loadSession();
    setTemplateLoading(false);
  };

  const pickSentEmail = async (id) => {
    setTemplateLoading(true);
    try {
      await post('/template', { messageId: id, mode: 'scheduled' });
      await post('/template/detect', { mode: 'scheduled' });
      await loadSession();
      setTemplateSaved(true);
      setTimeout(() => setTemplateSaved(false), 3000);
    } catch (e) {
      showErrorToast(`Failed to load email: ${e.message}`);
    }
    setTemplateLoading(false);
  };

  const pickLatestSent = async () => {
    setTemplateLoading(true);
    try {
      await post('/template/load-latest', { mode: 'scheduled' });
      await loadSession();
      setTemplateSaved(true);
      setTimeout(() => setTemplateSaved(false), 3000);
    } catch (e) {
      showErrorToast(e.message || 'Failed to load latest sent email');
    }
    setTemplateLoading(false);
  };

  // ── Stats ──
  const isEmptyWorkspace = !scheduledBatches.length;
  const completedBatches = scheduledBatches.filter(batch => batch.status === 'completed');
  const activeBatches = scheduledBatches.filter(batch => batch.status !== 'completed');
  const matchesBatchFilter = useCallback((batch) => {
    if (batchFilter === 'all') return true;
    if (batchFilter === 'scheduled') return ['scheduled', 'rescheduled'].includes(batch.status);
    if (batchFilter === 'review') return batch.status === 'drafted';
    if (batchFilter === 'processing') return ['pending', 'processing', 'sending'].includes(batch.status);
    return batch.status === batchFilter;
  }, [batchFilter]);
  const visibleActiveBatches = activeBatches.filter(matchesBatchFilter);
  const visibleCompletedBatches = completedBatches.filter(matchesBatchFilter);

  const replyStats = useMemo(() => {
    if (!replies.length) return null;
    return {
      positive: replies.filter(r => r.classification === 'positive').length,
      negative: replies.filter(r => r.classification === 'negative').length,
      neutral: replies.filter(r => r.classification === 'neutral').length,
      auto_reply: replies.filter(r => r.classification === 'auto_reply').length,
    };
  }, [replies]);

  const liveStats = useMemo(() => ({
    pending: scheduledStats?.pending || 0,
    approved: scheduledStats?.approved || 0,
    processing: scheduledBatches.filter(b => ['processing', 'sending'].includes(b.status)).length,
    sent: scheduledStats?.sent || 0,
    failed: scheduledStats?.failed || 0,
  }), [scheduledStats, scheduledBatches]);

  const statsForCards = useMemo(() => ({
    ...scheduledStats,
    deliveryFailed: apiUsage?.operational?.failures?.pending || 0,
    notFoundFailures: apiUsage?.operational?.failures?.notFound || 0,
    sendLimitFailures: apiUsage?.operational?.failures?.sendLimit || 0,
  }), [scheduledStats, apiUsage]);

  const navigateCard = useCallback((target, filter = 'all') => {
    if (target === 'archive') {
      openSentArchive();
      return;
    }
    if (target === 'gmail') {
      openSettings();
      return;
    }
    const refs = {
      pipeline: sectionPipelineRef,
      activity: sectionActivityRef,
      import: sectionImportRef,
      roster: sectionBatchRef,
      template: sectionTemplateRef,
      batches: sectionYourBatchesRef,
      failures: sectionFailuresRef,
      replies: sectionRepliesRef,
      duplicates: sectionDuplicatesRef,
    };
    if (target === 'batches') setBatchFilter(filter);
    if (target === 'failures') setFailureFilter(filter);
    if (target === 'replies') setReplyFilter(filter);
    setOpenSignals(current => ({ ...current, [target]: (current[target] || 0) + 1 }));
    setHighlightTarget(target);
    setTimeout(() => refs[target]?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    setTimeout(() => setHighlightTarget(current => current === target ? '' : current), 2200);
  }, [openSentArchive, openSettings]);

  const cardActions = useMemo(() => ({
    pipeline: { label: 'Open pipeline', onClick: () => navigateCard('pipeline') },
    review: { label: 'Review batches', onClick: () => navigateCard('batches', 'review') },
    duplicates: { label: 'Review duplicates', onClick: () => navigateCard('duplicates') },
    failed: { label: 'Show failed batches', onClick: () => navigateCard('batches', 'failed') },
    notFound: { label: 'Show not found', onClick: () => navigateCard('failures', 'not_found') },
    sendLimit: { label: 'Show send limits', onClick: () => navigateCard('failures', 'send_limit') },
    positiveReplies: { label: 'Show positive replies', onClick: () => navigateCard('replies', 'positive') },
    negativeReplies: { label: 'Show negative replies', onClick: () => navigateCard('replies', 'negative') },
    scheduledBatches: { label: 'Show scheduled batches', onClick: () => navigateCard('batches', 'scheduled') },
    totalBatches: { label: 'Show all batches', onClick: () => navigateCard('batches', 'all') },
    sentHistory: { label: 'Open sent archive', onClick: () => navigateCard('archive') },
    activity: { label: 'Open live activity', onClick: () => navigateCard('activity') },
    gmail: { label: 'Open Gmail status', onClick: () => navigateCard('gmail') },
  }), [navigateCard]);
  const workflowStages = useMemo(() => {
    const processingCount = scheduledBatches.filter(batch => ['pending', 'processing'].includes(batch.status)).length;
    const reviewCount = scheduledBatches.filter(batch => batch.status === 'drafted').length;
    const scheduledCount = scheduledBatches.filter(batch => ['scheduled', 'rescheduled', 'sending'].includes(batch.status)).length;
    const failedCount = scheduledBatches.filter(batch => batch.status === 'failed').length;
    return [
      {
        id: 'import',
        title: 'Import & timing',
        description: 'You add professors and choose when the scheduled workflow should run.',
        icon: Calendar,
        owner: 'user',
        status: importing ? 'active' : scheduledBatches.length ? 'complete' : 'attention',
        count: scheduledBatches.length,
        onClick: () => navigateCard('import'),
      },
      {
        id: 'roster',
        title: 'Research & roster',
        description: 'The agent researches professors and builds the live scheduled roster.',
        icon: Table2,
        owner: 'agent',
        status: processingCount ? 'active' : rosterRows.length ? 'ready' : 'idle',
        count: processingCount || rosterRows.length,
        onClick: () => navigateCard('roster'),
      },
      {
        id: 'draft',
        title: 'Draft & approval',
        description: !autoApprove && reviewCount ? 'Review prepared drafts before the scheduled send.' : 'The agent prepares and verifies every scheduled draft.',
        icon: Mail,
        owner: !autoApprove && reviewCount ? 'user' : 'agent',
        status: !autoApprove && reviewCount ? 'attention' : processingCount ? 'active' : activeScheduledTemplate?.raw_html ? 'ready' : 'idle',
        count: reviewCount,
        onClick: () => navigateCard('template'),
      },
      {
        id: 'delivery',
        title: 'Scheduled delivery',
        description: 'Track upcoming, rescheduled, sending, completed, and failed batches.',
        icon: Clock,
        owner: failedCount ? 'user' : 'agent',
        status: failedCount ? 'error' : scheduledBatches.some(batch => batch.status === 'sending') ? 'active' : scheduledCount ? 'ready' : completedBatches.length ? 'complete' : 'idle',
        count: scheduledCount || completedBatches.length,
        onClick: () => navigateCard('batches', failedCount ? 'failed' : 'all'),
      },
    ];
  }, [scheduledBatches, rosterRows.length, importing, autoApprove, activeScheduledTemplate?.raw_html, completedBatches.length, navigateCard]);

  const activeBatch = useMemo(
    () => scheduledBatches.find(b => ['processing', 'sending'].includes(b.status)),
    [scheduledBatches],
  );

  const batchProgress = useMemo(() => {
    if (!activeBatch) return { running: false };
    return {
      running: true,
      phase: activeBatch._phase || activeBatch.status,
      label: activeBatch._label || `Batch #${activeBatch.id} — ${activeBatch.status}`,
      current: activeBatch._current || 0,
      total: activeBatch._total || activeBatch.total || 0,
    };
  }, [activeBatch]);

  const currentActivity = useMemo(() => {
    if (agentStopped) return null;
    if (agentToast) return { ...agentToast, loading: ['processing', 'scraping', 'researching', 'sending'].includes(agentToast.stage) };
    if (activeBatch) {
      return {
        stage: activeBatch.status === 'sending' ? 'sending' : (activeBatch._phase || 'processing'),
        label: activeBatch._label || `Batch #${activeBatch.id} — ${activeBatch.status}`,
        professor: agentToast?.professor,
      };
    }
    return null;
  }, [agentStopped, agentToast, activeBatch]);

  const activeRosterEmail = agentToast?.professor || currentActivity?.professor;

  return (
    <WorkflowPage>

      {sessionLoading && !connectionsSettled && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-blue-50 dark:bg-neutral-800 border border-blue-200 dark:border-neutral-700 text-blue-700 dark:text-blue-300 text-xs">
          <Activity className="w-4 h-4 animate-spin shrink-0" />
          Connecting to backend…
        </div>
      )}

      {sessionRefreshing && connectionsSettled && (
        <div className="h-0.5 w-full bg-brand-200 dark:bg-brand-900 overflow-hidden rounded-full">
          <div className="h-full w-1/3 bg-brand-500 animate-pulse rounded-full" />
        </div>
      )}

      <AgentStepToast toast={agentToast} />

      {sessionError && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs">
          <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{sessionError}</span>
          <button onClick={loadSession} className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 font-medium hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors">Retry</button>
        </div>
      )}

      {resetError && (
        <div className="text-xs p-3 rounded-xl bg-red-50 dark:bg-neutral-800 border border-red-200 text-red-600 font-medium">{resetError}</div>
      )}

      {resetToast && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-neutral-800 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Dashboard cleared — analytics kept. Ready for a new batch.
        </motion.div>
      )}

      <AnalyticsPopupRegistration
        stats={statsForCards}
        queueStats={liveStats}
        apiUsage={apiUsage}
        health={health}
        replyStats={replyStats}
        actions={cardActions}
        freshness={freshness}
      />

      <ReadyForNewBanner
        batches={scheduledBatches}
        stats={scheduledStats}
        onStartNew={resetAll}
        resetting={resetting}
        label="scheduled batch"
      />

      <div ref={sectionPipelineRef} className={`scroll-mt-20 rounded-2xl transition-shadow ${['pipeline', 'activity'].includes(highlightTarget) ? 'ring-2 ring-brand-400 ring-offset-2' : ''}`}>
        <CombinedLiveSection currentActivity={currentActivity} queue={[]} stats={scheduledStats} scrapeProgress={batchProgress} stopped={agentStopped} events={events} connected={sseConnected} openSignal={Math.max(openSignals.pipeline || 0, openSignals.activity || 0)} />
      </div>

      <CommandStrip>
        <OnboardingChecklist
          hasQueue={scheduledBatches.length > 0}
          hasTemplate={!!activeScheduledTemplate?.raw_html}
          hasSent={(scheduledStats?.totalSent || 0) > 0}
          modeLabel={isBasicSchedule ? 'Basic Scheduled' : 'Scheduled'}
          actions={{
            gmail: () => navigateCard('gmail'),
            import: () => navigateCard('import'),
            template: () => navigateCard('template'),
            send: () => navigateCard('archive'),
          }}
        />
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-[rgb(var(--border-subtle))]">
          <ResetNotice scope={isBasicSchedule ? 'Basic Scheduled mode' : 'Scheduled mode'} />
          {!resetConfirm ? (
            <button type="button" onClick={() => setResetConfirm(true)} className="text-[10px] font-medium text-muted hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-500/10 border border-transparent hover:border-red-500/30 transition-all flex items-center gap-1.5 shrink-0">
              <Trash2 className="w-3 h-3" /> New task
            </button>
          ) : (
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <span className="text-[10px] text-red-600 dark:text-red-400 font-medium">Clear all batches?</span>
              <button type="button" onClick={resetAll} disabled={resetting} className="text-[10px] font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-60 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
                {resetting ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Confirm reset
              </button>
              <button type="button" onClick={() => setResetConfirm(false)} className="text-[10px] text-muted px-2 py-1 rounded-lg">Cancel</button>
            </div>
          )}
        </div>
      </CommandStrip>

      {/* Step 1: Import + Schedule */}
      <WorkflowDeck activeId={highlightTarget}>
      <WorkflowSlide id="import" title="Import" icon={Calendar} status={importing ? 'Working' : 'Ready'}>
      <div ref={sectionImportRef} className={`scroll-mt-20 rounded-2xl transition-shadow ${highlightTarget === 'import' ? 'ring-2 ring-brand-400 ring-offset-2' : ''}`}>
      <StepCard step={1} title="Import & Schedule" subtitle="Add professors and set send time" icon={Calendar}
        active={importing}
        done={scheduledBatches.length > 0}
        owner="user"
        actionRequired={!importing && scheduledBatches.length === 0}
        statusLabel={importing ? 'Agent preparing batch' : scheduledBatches.length ? 'Batch created' : 'Choose data and time'}
        defaultOpen={scheduledBatches.length === 0 || importing}
        openSignal={openSignals.import}>
        <div className="space-y-4">
          <ScheduledSendTimePanel onSuggestTime={(d) => setScheduledAt(d)} embedded />

          <div className="panel p-4 space-y-4">
          {/* Normal vs Basic scheduled mode */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-indigo-50 dark:bg-neutral-800 border border-indigo-200 dark:border-indigo-800">
            <span className="text-xs font-semibold text-indigo-900 dark:text-indigo-100 shrink-0">Outreach mode</span>
            <div className="flex gap-1 p-0.5 bg-indigo-100 dark:bg-neutral-800 rounded-lg">
              <button type="button" onClick={() => setScheduleSubMode('scheduled')}
                className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${!isBasicSchedule ? 'bg-white dark:bg-neutral-800 text-indigo-700 shadow-sm' : 'text-indigo-600/70 hover:text-indigo-800'}`}>
                Normal
              </button>
              <button type="button" onClick={() => setScheduleSubMode('basic_scheduled')}
                className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${isBasicSchedule ? 'bg-teal-500 text-white shadow-sm' : 'text-indigo-600/70 hover:text-indigo-800'}`}>
                Basic
              </button>
            </div>
            <p className="text-[10px] text-indigo-700/90 dark:text-indigo-300/90 flex-1 min-w-0">
              {isBasicSchedule
                ? 'Last name only — optional default [Machine Learning] subject or search subject keyword from research'
                : 'Full personalization: subject keyword + 3 interest keywords'}
            </p>
          </div>

          {isBasicSchedule && (
            <BasicSubjectOptions
              defaultSubjectEnabled={defaultSubjectEnabled}
              searchSubjectEnabled={searchSubjectEnabled}
              saving={keywordSaving}
              onToggleDefault={toggleDefaultSubject}
              onToggleSearch={toggleSearchSubject}
            />
          )}

          <DesignationSkipFilter value={skipDesignations} onChange={setSkipDesignations} className="mb-3" />

          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted pt-1">Schedule send time</p>

          {/* Date/Time picker */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2 block">Schedule Date</label>
              <DatePicker
                selected={scheduledAt}
                onChange={date => setScheduledAt(date || null)}
                dateFormat="MMMM d, yyyy"
                minDate={new Date()}
                placeholderText="Select date"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500"
                calendarClassName="!border-gray-200 dark:!border-gray-700 !rounded-xl !shadow-lg"
                dayClassName={d => d.getTime() < new Date().setHours(0,0,0,0) ? '!text-gray-300' : '!hover:bg-blue-100'}
                popperPlacement="bottom-start"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2 block">Schedule Time</label>
              <input
                type="time"
                value={scheduledAt ? scheduleTime : ''}
                onChange={e => setScheduleClockTime(e.target.value)}
                step="60"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500"
              />
              <p className="text-[10px] text-muted mt-1">Minute-level clock time in your local/Pakistan time.</p>
            </div>
          </div>
          {scheduledAt && (
            <div className="p-3 bg-blue-50 dark:bg-neutral-800 rounded-lg border border-blue-200 dark:border-neutral-700">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
                  Scheduled for: {formatDateTime12(scheduledAt)} (your local time → stored as UTC)
                </span>
              </div>
            </div>
          )}
          <SelectedTargetTimePreview scheduledAt={scheduledAt} selectedCountries={selectedCountries} />

          {/* Approval mode toggle */}
          <div className="p-3 bg-gray-50 dark:bg-neutral-800/50 rounded-lg border border-gray-200 dark:border-neutral-700">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-4 h-4 text-muted" />
              <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">Approval Mode</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex p-0.5 bg-gray-200 dark:bg-neutral-700 rounded-lg">
                <button onClick={() => setAutoApprove(true)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-all ${autoApprove ? 'bg-emerald-500 text-white shadow-sm' : 'text-muted hover:text-gray-700 dark:hover:text-gray-300'}`}>
                  <Zap className="w-3.5 h-3.5" /> Auto
                </button>
                <button onClick={() => setAutoApprove(false)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-all ${!autoApprove ? 'bg-violet-500 text-white shadow-sm' : 'text-muted hover:text-gray-700 dark:hover:text-gray-300'}`}>
                  <Edit3 className="w-3.5 h-3.5" /> Manual
                </button>
              </div>
              <p className="text-[10px] text-muted flex-1">
                {autoApprove ? 'Drafts sent automatically at scheduled time' : 'Each draft pauses for your review — view, edit, approve, or delete'}
              </p>
            </div>
          </div>

          {/* Permanent duplicate guard */}
          <div className="p-3 bg-gray-50 dark:bg-neutral-800/50 rounded-lg border border-gray-200 dark:border-neutral-700">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <div>
                <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">Permanent duplicate protection</p>
                <p className="text-[10px] text-muted">Every recipient is checked against sent email history. Previously contacted professors are always skipped.</p>
              </div>
            </div>
          </div>

          {/* Max Professors */}
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-gray-50 dark:bg-neutral-800/50 border border-gray-200 dark:border-neutral-700">
            <Users className="w-4 h-4 text-muted" />
            <span className="text-[11px] font-medium text-muted">Max Professors</span>
            <input type="number" min="1" max="500" value={maxProfessors} onChange={e => setMaxProfessors(e.target.value)}
              placeholder="All" className="w-20 px-2 py-1.5 text-[11px] rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-400" />
            <span className="text-[10px] text-muted">Limit how many professors to process</span>
          </div>

          {/* Import tabs */}
          <div className="flex gap-1 p-0.5 bg-gray-100 dark:bg-neutral-800 rounded-lg w-fit">
            {[['url', 'Faculty URL', Globe], ['paste', 'Paste Emails', Edit3], ['file', 'Upload File', FileSpreadsheet]].map(([id, label, Icon]) => (
              <button key={id} onClick={() => setImportTab(id)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[11px] font-medium transition-all ${importTab === id ? 'bg-white dark:bg-neutral-700 shadow-sm text-gray-900 dark:text-gray-100' : 'text-muted hover:text-gray-700 dark:hover:text-gray-300'}`}>
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            ))}
          </div>

          {importTab === 'url' && (
            <div className="space-y-3">
              <input value={urlInput} onChange={e => setUrlInput(e.target.value)} className="input text-sm" placeholder="https://cs.stanford.edu/people/faculty" />
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-muted">Agent scrapes profiles — drafts but doesn't send until scheduled time</p>
                <button onClick={createBatch} disabled={importing || !urlInput.trim() || !scheduledAt} className="btn-primary text-xs px-5 py-2 shrink-0">
                  {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Clock className="w-3.5 h-3.5" /> Schedule Batch</>}
                </button>
              </div>
            </div>
          )}

          {importTab === 'paste' && (
            <div className="space-y-3">
              <textarea value={emailInput} onChange={e => setEmailInput(e.target.value)} rows={6} className="input text-xs font-mono leading-relaxed"
                placeholder={"Dr. Jane Smith, jsmith@mit.edu, Machine Learning, NLP, Computer Vision\nProf. Wei Zhang | wzhang@stanford.edu | Distributed Systems, Cloud Computing\n\nPaste name, email, and research keywords. Last name is extracted from the full name."} />
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[10px] text-muted">
                  {isBasicSchedule
                    ? (searchSubjectEnabled
                      ? 'Agent parses name, last name, email, and keywords into the roster'
                      : defaultSubjectEnabled
                        ? 'Agent parses full name and last name into the roster'
                        : 'Agent parses name and last name — sends at scheduled time')
                    : 'Agent parses name, email, and research keywords into the roster'}
                </p>
                <button onClick={createBatch} disabled={importing || !emailInput.trim() || !scheduledAt} className="btn-primary text-xs px-5 py-2">
                  {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Clock className="w-3.5 h-3.5" /> Schedule Batch</>}
                </button>
              </div>
            </div>
          )}

          {importTab === 'file' && (
            <div className="space-y-3">
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 dark:border-neutral-700 rounded-xl py-8 cursor-pointer hover:border-brand-400 dark:hover:border-brand-500 hover:bg-brand-50/30 dark:hover:bg-brand-900/5 transition-all group">
                {importing ? <Loader2 className="w-7 h-7 text-brand-500 animate-spin mb-2" /> : <FileSpreadsheet className="w-7 h-7 text-gray-400 group-hover:text-brand-500 mb-2 transition-colors" />}
                <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{importing ? 'Processing...' : 'Click to upload file'}</span>
                <span className="text-[10px] text-muted mt-1">Excel, CSV, PDF, Word, TXT</span>
                <input type="file" accept=".xlsx,.xls,.csv,.pdf,.docx,.doc,.txt" onChange={handleFile} className="hidden" />
              </label>
              <FilePreview data={filePreview} onConfirm={createBatch} onCancel={() => setFilePreview(null)} importing={importing} subjectModeLabel={isBasicSchedule ? (searchSubjectEnabled ? 'Search subject keyword ON' : defaultSubjectEnabled ? 'Default subject ON' : 'Fixed subject') : undefined} />
            </div>
          )}

          {importMsg && (
            <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className={`text-xs p-2.5 rounded-lg font-medium ${importMsg.startsWith('error') || importMsg.startsWith('Pick') || importMsg.startsWith('Provide') ? 'bg-red-50 dark:bg-neutral-800 text-red-600 dark:text-red-400' : 'bg-emerald-50 dark:bg-neutral-800 text-emerald-600 dark:text-emerald-400'}`}>
              {importMsg}
            </motion.div>
          )}

          {pendingSkippedDuplicates.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 space-y-2">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                {pendingSkippedDuplicates.length} professor(s) already in permanent archive
              </p>
              <ul className="text-[10px] text-amber-700/90 dark:text-amber-300/90 max-h-24 overflow-auto space-y-0.5">
                {pendingSkippedDuplicates.slice(0, 8).map(s => (
                  <li key={s.email} className="font-mono truncate">{s.email} — sent {s.prior?.sent_at ? new Date(s.prior.sent_at).toLocaleDateString() : 'before'}</li>
                ))}
                {pendingSkippedDuplicates.length > 8 && <li>…and {pendingSkippedDuplicates.length - 8} more</li>}
              </ul>
              <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">These recipients were permanently blocked and were not added to the batch.</p>
            </div>
          )}

          </div>
        </div>
      </StepCard>
      </div>

      {/* Step 2: Excel roster + batches */}
      </WorkflowSlide>
      <WorkflowSlide id="roster" title="Excel roster" icon={Table2} badge={rosterRows.length}>
      <div ref={sectionBatchRef} className={`scroll-mt-20 rounded-2xl transition-shadow ${highlightTarget === 'roster' ? 'ring-2 ring-brand-400 ring-offset-2' : ''}`}>
      <StepCard step={2} title="Excel roster" subtitle="Live roster and scheduled batch progress" icon={Table2}
        active={scheduledBatches.some(b => ['processing', 'sending'].includes(b.status))}
        done={scheduledBatches.some(b => b.status === 'completed')}
        owner="agent"
        statusLabel={scheduledBatches.some(b => ['processing', 'sending'].includes(b.status)) ? 'Agent processing' : rosterRows.length ? `${rosterRows.length} professors` : 'Waiting for batch'}
        defaultOpen={scheduledBatches.length > 0}
        openSignal={openSignals.roster}>
        <ScheduledTimingBoard
          batches={scheduledBatches}
          onOpenBatch={(id) => {
            setExpandedBatchId(id);
            setTimeout(() => sectionYourBatchesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
          }}
          onSendOverdueNow={async () => {
            try {
              await post('/scheduled/batches/send-overdue-now');
              await loadSession({ force: true });
            } catch (e) {
              toast.error(e.message || 'Could not send overdue batches');
            }
          }}
        />
        <div className="h-4" />
        <LiveRosterPanel
          rows={rosterRows}
          activeEmail={activeRosterEmail}
          onSave={fetchRoster}
          onClear={async () => { await post('/roster/clear'); setRosterRows([]); }}
          mode={scheduleSubMode}
          live
        />
      </StepCard>
      </div>

      {/* Step 3: Email draft */}
      </WorkflowSlide>
      <WorkflowSlide id="template" title="Email draft" icon={Mail} badge={scheduledBatches.filter(batch => batch.status === 'drafted').length || undefined}>
      <div ref={sectionTemplateRef} className={`scroll-mt-20 rounded-2xl transition-shadow ${highlightTarget === 'template' ? 'ring-2 ring-brand-400 ring-offset-2' : ''}`}>
      <StepCard step={3} title="Email draft" subtitle={`Review and edit template for ${isBasicSchedule ? 'basic' : 'normal'} scheduled batches`} icon={Mail}
        active={activeScheduledTemplate && !templateSaved}
        done={templateSaved}
        owner={!autoApprove && scheduledBatches.some(batch => batch.status === 'drafted') ? 'user' : 'agent'}
        actionRequired={!autoApprove && scheduledBatches.some(batch => batch.status === 'drafted')}
        statusLabel={!autoApprove && scheduledBatches.some(batch => batch.status === 'drafted') ? 'Review required' : templateSaved ? 'Template saved' : activeScheduledTemplate?.raw_html ? 'Draft ready' : 'Waiting for template'}
        defaultOpen={!!activeScheduledTemplate?.raw_html}
        openSignal={openSignals.template}>
        <GmailComposeChrome
          key={`sched-compose-${scheduleSubMode}`}
          template={activeScheduledTemplate}
          onSaveInstructions={saveInstructions}
          onDetect={detectPlaceholders}
          sentEmails={sentEmails}
          onPickSent={pickSentEmail}
          onPickLatest={pickLatestSent}
          loading={templateLoading}
          saved={templateSaved}
          settings={settings}
          resetKey={resetKey}
          basicMode={isBasicSchedule}
          basicSubjectMode={isBasicSchedule ? basicSubjectMode : 'fixed'}
        />
      </StepCard>
      </div>


      {/* Your Batches */}
      </WorkflowSlide>
      <WorkflowSlide id="batches" title="Batches" icon={Clock} badge={scheduledBatches.length || undefined}>
      <div ref={sectionYourBatchesRef} className={`scroll-mt-20 rounded-2xl transition-shadow ${highlightTarget === 'batches' ? 'ring-2 ring-brand-400 ring-offset-2' : ''}`}>
        <StepCard step={4} title="Your Batches" subtitle="Ready, scheduled, manual, and auto-send batches" icon={Clock}
          active={scheduledBatches.some(b => ['pending', 'processing', 'drafted', 'scheduled', 'sending'].includes(b.status))}
          done={scheduledBatches.some(b => b.status === 'completed')}
          owner={scheduledBatches.some(batch => batch.status === 'drafted' && !batch.auto_approve) ? 'user' : 'agent'}
          actionRequired={scheduledBatches.some(batch => batch.status === 'drafted' && !batch.auto_approve)}
          statusLabel={scheduledBatches.some(batch => batch.status === 'sending') ? 'Sending now' : scheduledBatches.some(batch => batch.status === 'drafted' && !batch.auto_approve) ? 'Approval required' : activeBatches.length ? `${activeBatches.length} active` : completedBatches.length ? `${completedBatches.length} completed` : 'No batches'}
          defaultOpen={scheduledBatches.length > 0}
          openSignal={openSignals.batches}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Your Batches</h3>
              <p className="text-[10px] text-muted mt-0.5">Edit time, delete, or switch each batch between manual and auto approval.</p>
            </div>
            <button onClick={() => { setExpandedBatchId(null); sectionImportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
              className="btn-primary text-[10px] px-3 py-1.5 flex items-center gap-1.5">
              <Plus className="w-3 h-3" /> Add Another Batch
            </button>
          </div>
          {batchFilter !== 'all' && (
            <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/40 dark:bg-amber-950/20">
              <span className="text-[10px] font-semibold text-amber-800 dark:text-amber-300">Filter: {batchFilter}</span>
              <button type="button" onClick={() => setBatchFilter('all')} className="text-[10px] font-semibold text-amber-700 hover:underline">Clear filter</button>
            </div>
          )}
          {scheduledBatches.length === 0 ? (
            <div className="text-center py-10"><Clock className="w-7 h-7 text-gray-200 mx-auto mb-2" /><p className="text-xs text-muted">No scheduled batches yet - import and schedule above</p></div>
          ) : (
            <div className="space-y-6">
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-gray-900 dark:text-gray-100">Scheduled batches</h4>
                    <p className="text-[10px] text-muted">Pending, processing, drafted, scheduled, and sending.</p>
                  </div>
                  <span className="text-[10px] text-muted">{visibleActiveBatches.length}</span>
                </div>
                {visibleActiveBatches.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-200 dark:border-neutral-700 py-6 text-center text-xs text-muted">No active scheduled batches.</div>
                ) : visibleActiveBatches.map(b => (
                  <BatchCard
                    key={b.id}
                    batch={b}
                    expanded={expandedBatchId === b.id}
                    onExpand={() => setExpandedBatchId(prev => prev === b.id ? null : b.id)}
                    onRefresh={() => { loadSession(); fetchRoster(); }}
                    onBatchDeleted={(id) => {
                      setExpandedBatchId(prev => prev === id ? null : prev);
                      setScheduledBatches(prev => prev.filter(batch => batch.id !== id));
                      setRosterRows([]);
                      loadSession();
                    }}
                  />
                ))}
              </section>

              <section className="space-y-3 border-t border-[rgb(var(--border-subtle))] pt-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Completed batches</h4>
                    <p className="text-[10px] text-muted">Permanent history with every sent, failed, and unsent email.</p>
                  </div>
                  <span className="text-[10px] text-muted">{visibleCompletedBatches.length}</span>
                </div>
                {visibleCompletedBatches.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-emerald-200 dark:border-emerald-900/40 py-6 text-center text-xs text-muted">Completed batches will appear here permanently.</div>
                ) : visibleCompletedBatches.map(b => (
                  <BatchCard
                    key={b.id}
                    batch={b}
                    expanded={expandedBatchId === b.id}
                    onExpand={() => setExpandedBatchId(prev => prev === b.id ? null : b.id)}
                    onRefresh={() => { loadSession(); fetchRoster(); }}
                    onBatchDeleted={() => {}}
                  />
                ))}
              </section>
            </div>
          )}
        </StepCard>
      </div>
      </WorkflowSlide>
      <WorkflowSlide id="failures" title="Delivery failures" icon={AlertTriangle} badge={deliveryFailures.length || undefined}>
      <div ref={sectionFailuresRef} className={`scroll-mt-20 rounded-2xl transition-shadow ${highlightTarget === 'failures' ? 'ring-2 ring-brand-400 ring-offset-2' : ''}`}>
        <StepCard step={5} title="Delivery failures" subtitle="Bounces, not-found addresses, and Gmail limits" icon={AlertTriangle} owner="user" actionRequired={deliveryFailures.some(item => item.status === 'pending')} statusLabel={`${deliveryFailures.length} records`} openSignal={openSignals.failures}>
          <DeliveryFailureCard failures={deliveryFailures} onRefresh={fetchDeliveryFailures} filter={failureFilter} onClearFilter={() => setFailureFilter('all')} />
        </StepCard>
      </div>
      </WorkflowSlide>

      <WorkflowSlide id="duplicates" title="Duplicates" icon={ShieldCheck} badge={pendingSkippedDuplicates.length || undefined}>
        <div ref={sectionDuplicatesRef} className="scroll-mt-20">
        <StepCard step={6} title="Duplicates" subtitle="Previously contacted professors are automatically blocked" icon={ShieldCheck} owner="agent" statusLabel={pendingSkippedDuplicates.length ? `${pendingSkippedDuplicates.length} skipped` : 'Protected'} openSignal={openSignals.duplicates}>
          {pendingSkippedDuplicates.length ? (
            <div className="max-h-72 overflow-auto rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/40 dark:bg-amber-950/15">
              {pendingSkippedDuplicates.map(item => <p key={item.email} className="border-b border-amber-200/60 py-2 font-mono text-[11px] last:border-0">{item.email}</p>)}
            </div>
          ) : (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-xs text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/15 dark:text-emerald-300">Permanent sent-history protection is active. No duplicates are waiting.</p>
          )}
        </StepCard>
        </div>
      </WorkflowSlide>

      <WorkflowSlide id="replies" title="Replies" icon={Mail} badge={replies.length || undefined}>
      <div ref={sectionRepliesRef} className={`scroll-mt-20 rounded-2xl transition-shadow ${highlightTarget === 'replies' ? 'ring-2 ring-brand-400 ring-offset-2' : ''}`}>
        <StepCard step={7} title="Replies" subtitle="Classified professor replies and manual response actions" icon={Mail} owner="user" statusLabel={`${replies.length} replies`} openSignal={openSignals.replies}>
          <ReplyAnalyticsSection replies={replies} onRefresh={loadSession} filter={replyFilter} onClearFilter={() => setReplyFilter('all')} openSignal={openSignals.replies} />
        </StepCard>
      </div>
      </WorkflowSlide>
      </WorkflowDeck>
    </WorkflowPage>
  );
}
