import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Clock, AlertTriangle, MessageSquare, Activity, Zap, FileText, Globe, Loader2, Trash2, Search, FileSpreadsheet, Edit3, ShieldCheck, Mail, ArrowRight, RotateCcw, CheckCircle2, SkipForward, Eye, Save, X, Users, ListChecks } from 'lucide-react';
import { get, post, del, put } from '../api.js';
import { useSession } from '../context/SessionContext.jsx';
import { useEventStream } from '../core/EventStreamProvider.jsx';
import useGmailAuth from '../hooks/useGmailAuth.js';
import { useToast } from '../components/Toast.jsx';
import BatchScrapeProgress from '../components/BatchScrapeProgress.jsx';
import GmailComposeChrome from '../components/GmailComposeChrome.jsx';
import LiveRosterPanel from '../components/LiveRosterPanel.jsx';
import ProcessingQueueTable from '../components/ProcessingQueueTable.jsx';
import StepCard from '../components/StepCard.jsx';
import { Table2 } from 'lucide-react';
import AgentStepToast from '../components/AgentStepToast.jsx';
import InstantSendTimePanel from '../components/InstantSendTimePanel.jsx';
import WorkflowPage from '../components/layout/WorkflowPage.jsx';
import { AnalyticsPopupRegistration } from '../context/AnalyticsPopupContext.jsx';
import ReplyAnalyticsSection from '../components/layout/ReplyAnalyticsSection.jsx';
import OnboardingChecklist from '../components/OnboardingChecklist.jsx';
import DuplicateReviewPanel from '../components/DuplicateReviewPanel.jsx';
import ReadyForNewBanner from '../components/ReadyForNewBanner.jsx';
import ResetNotice from '../components/ResetNotice.jsx';
import RunBatchBar from '../components/RunBatchBar.jsx';
import BulkQueueActions from '../components/BulkQueueActions.jsx';
import CampaignPresets from '../components/CampaignPresets.jsx';
import BasicSubjectOptions, { basicSubjectModeFromSettings } from '../components/BasicSubjectOptions.jsx';
import DesignationSkipFilter from '../components/DesignationSkipFilter.jsx';
import useKeyboardApproval from '../hooks/useKeyboardApproval.js';
import useResumeStep from '../hooks/useResumeStep.js';
import { formatTime12 } from '../utils/dateTime.js';
import useAutoClearAfterBatch from '../hooks/useAutoClearAfterBatch.js';
import useOperationalSummary from '../hooks/useOperationalSummary.js';
import DeliveryFailuresPanel from '../components/DeliveryFailuresPanel.jsx';
import FollowUpsPanel from '../components/FollowUpsPanel.jsx';
import EngagementPanel from '../components/EngagementPanel.jsx';
import { useSettingsModal } from '../context/SettingsModalContext.jsx';
import WorkflowDeck, { WorkflowSlide } from '../components/layout/WorkflowDeck.jsx';
import CombinedLiveSection from '../components/layout/CombinedLiveSection.jsx';
import CommandStrip from '../components/layout/CommandStrip.jsx';
import InstantQueueHistory from '../components/InstantQueueHistory.jsx';

// ─── APPROVAL CARD + COMPOSE POPUP ──────────────────────────
function ApprovalCard({ item, onApprove, onReject, onDelete, onEdit, onSend, templateHtml, settings, sent, basicMode = false }) {
  const [composeOpen, setComposeOpen] = useState(false);
  const [popupMode, setPopupMode] = useState('view'); // 'view' or 'edit'
  const [editSubject, setEditSubject] = useState(item.subject || '');
  const [editInterest, setEditInterest] = useState(item.interest_line || '');
  const [editEmail, setEditEmail] = useState(item.professor_email || '');
  const [editHtml, setEditHtml] = useState('');
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(false);
  const editableRef = useRef(null);

  const lastName = item.last_name || (popupMode === 'edit' ? editEmail : item.professor_email)?.split('@')[0] || 'Professor';
  const greetingName = lastName.charAt(0).toUpperCase() + lastName.slice(1).toLowerCase();
  const resumeName = settings?.resume_name || 'Resume.pdf';

  // Helper: strip sentence wrapper from AI-generated interest_line (legacy data fix)
  const cleanInterestLine = (line) => (line || '').replace(/I am (?:particularly )?interested in your work (?:on|in) ?/gi, '').trim();

  const baseHtml = useMemo(() => {
    const src = item.custom_html || templateHtml;
    if (!src) return '';
    const substituted = src
      .replace(/\{\{LAST_NAME\}\}/g, greetingName)
      .replace(/\{\{INTEREST_LINE\}\}/g, basicMode ? '' : cleanInterestLine(item.interest_line));
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&display=swap" rel="stylesheet"><style>body{margin:0;padding:16px 20px;font-family:'Roboto',Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;} p{margin:0 0 1em 0} ul,ol{margin:0.5em 0;padding-left:2em} li{margin:0.25em 0}</style></head><body>${substituted}</body></html>`;
  }, [templateHtml, item.custom_html, item.interest_line, greetingName]);

  useEffect(() => {
    setEditSubject(item.subject || '');
    setEditInterest(item.interest_line || '');
    setEditEmail(item.professor_email || '');
  }, [item.subject, item.interest_line, item.professor_email]);

  // When popup opens in edit mode, set the editable HTML with proper paragraph styling
  useEffect(() => {
    if (composeOpen && popupMode === 'edit') {
      const src = item.custom_html || templateHtml;
      if (!src) return;
      const html = src
        .replace(/\{\{LAST_NAME\}\}/g, greetingName)
        .replace(/\{\{INTEREST_LINE\}\}/g, basicMode ? '' : cleanInterestLine(editInterest || item.interest_line || ''));
      // Wrap with inline styles matching the Gmail preview iframe
      const styledHtml = `<div style="margin:0;padding:0;font-family:'Roboto',Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;">${html}</div>`;
      setEditHtml(styledHtml);
      if (editableRef.current) {
        editableRef.current.innerHTML = styledHtml;
      }
    }
  }, [composeOpen, popupMode]);

  const handleSaveEdits = async () => {
    const html = editableRef.current?.innerHTML || editHtml;
    await onEdit(editSubject, editInterest, editEmail, html);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleSendFromPopup = async () => {
    setSending(true);
    const html = editableRef.current?.innerHTML || editHtml;
    if (popupMode === 'edit') {
      await onEdit(editSubject, editInterest, editEmail, html);
    } else if (item.custom_html) {
      // Already saved — no need to re-save
    }
    await onApprove();
    setSending(false);
    setComposeOpen(false);
  };

  const openPopup = (mode) => {
    setEditSubject(item.subject || '');
    setEditInterest(item.interest_line || '');
    setEditEmail(item.professor_email || '');
    setPopupMode(mode);
    setComposeOpen(true);
    setSaved(false);
  };

  const isDisabled = sent || item.state === 'sent';

  return (
    <>
      {/* Compact approval row */}
      <div className="card p-3 flex items-center gap-3 border-violet-200 dark:border-violet-800 bg-violet-50/30 dark:bg-neutral-800">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{item.subject || 'Draft email'}</p>
          <p className="text-[10px] text-muted">
            {item.professor_email}
            {!basicMode && <> · Interest: {item.interest_line || '—'}</>}
          </p>
        </div>
        <button onClick={() => openPopup('view')} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-[10px] font-semibold shadow-sm transition-colors">
          <Eye className="w-3 h-3" /> View
        </button>
        <button onClick={() => !isDisabled && openPopup('edit')} disabled={isDisabled}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-white text-[10px] font-semibold shadow-sm transition-colors ${isDisabled ? 'bg-gray-300 dark:bg-neutral-600 opacity-60 cursor-not-allowed' : 'bg-brand-500 hover:bg-brand-600'}`}>
          <Edit3 className="w-3 h-3" /> Edit
        </button>
        {!isDisabled && (
          <button onClick={onApprove} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-semibold shadow-sm transition-colors">
            <CheckCircle2 className="w-3 h-3" /> Approve & Send
          </button>
        )}
        {!isDisabled && (
          <button onClick={onReject} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 text-[10px] font-medium border border-red-200 dark:border-red-800 transition-colors">
            <SkipForward className="w-3 h-3" /> Reject
          </button>
        )}
      </div>

      {/* Compose Popup Modal */}
      {composeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setComposeOpen(false)}>
          <div className="w-full max-w-5xl mx-4 bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-neutral-700 overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-neutral-800 border-b border-gray-200 dark:border-neutral-700 shrink-0">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-brand-500" />
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{popupMode === 'view' ? 'View Email' : 'Edit Email'}</span>
                <span className="text-[10px] text-muted">{popupMode === 'edit' ? editEmail : item.professor_email}</span>
              </div>
              <div className="flex items-center gap-2">
                {saved && (
                  <span className="text-[10px] font-medium text-emerald-500 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Saved
                  </span>
                )}
                {!isDisabled && popupMode === 'view' && (
                  <button onClick={() => setPopupMode('edit')} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/10 transition-colors">
                    <Edit3 className="w-3 h-3" /> Switch to Edit
                  </button>
                )}
                {popupMode === 'edit' && (
                  <button onClick={() => setPopupMode('view')} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                    <Eye className="w-3 h-3" /> Switch to View
                  </button>
                )}
                <button onClick={() => setComposeOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">✕</button>
              </div>
            </div>

            {/* Gmail Compose Chrome — identical styling regardless of mode */}
            <div className="border border-gray-200 dark:border-neutral-700 rounded-lg mx-4 mt-3 overflow-hidden shrink-0">
              {/* From/To bar */}
              <div className="px-3 py-2 bg-gray-50 dark:bg-neutral-800 border-b border-gray-100 dark:border-neutral-700 text-[10px] text-gray-500 space-y-1">
                <div className="flex items-center gap-2"><span className="text-gray-400 w-8">From</span><span>{settings?.sender_email || '—'}</span></div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 w-8">To</span>
                  {popupMode === 'edit' ? (
                    <input value={editEmail} onChange={e => setEditEmail(e.target.value)}
                      className="flex-1 text-[11px] font-medium text-gray-700 dark:text-gray-300 bg-transparent focus:outline-none" />
                  ) : (
                    <span className="text-gray-700 dark:text-gray-300 font-medium">{item.professor_email}</span>
                  )}
                </div>
              </div>

              {/* Subject */}
              <div className="px-3 py-2 border-b border-gray-100 dark:border-neutral-700">
                {popupMode === 'edit' ? (
                  <input value={editSubject} onChange={e => setEditSubject(e.target.value)}
                    className="w-full text-sm font-medium text-gray-800 dark:text-gray-100 bg-transparent focus:outline-none" />
                ) : (
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{item.subject || 'Draft email'}</p>
                )}
              </div>
            </div>

            {/* Email body — identical styling for both modes */}
            <div className="flex-1 overflow-auto mx-4 mt-2 mb-2">
              {popupMode === 'edit' ? (
                <div
                  ref={editableRef}
                  contentEditable
                  suppressContentEditableWarning
                  className="w-full min-h-[350px] bg-white rounded-lg border border-gray-200 dark:border-neutral-700 [&_p]:mb-[1em] [&_ul]:my-[0.5em] [&_ol]:my-[0.5em] [&_li]:my-[0.25em]"
                  style={{ fontFamily: "'Roboto', Arial, sans-serif", fontSize: '14px', lineHeight: '1.6', color: '#222', padding: '16px 20px' }}
                />
              ) : (
                <iframe srcDoc={baseHtml} className="w-full min-h-[350px] bg-white rounded-lg border border-gray-200 dark:border-neutral-700" title="Email preview" sandbox="allow-same-origin" />
              )}
            </div>

            {/* Resume attachment */}
            <div className="flex items-center gap-2.5 px-7 py-2 border-t border-gray-100 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-800 shrink-0">
              <div className="flex items-center justify-center w-7 h-7 rounded bg-red-100 dark:bg-red-900/30">
                <FileText className="w-4 h-4 text-red-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{resumeName}</p>
                <p className="text-[10px] text-muted">PDF · attached to every email</p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3 px-4 py-3 shrink-0">
              {!isDisabled && (
                <button onClick={handleSendFromPopup} disabled={sending}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold shadow-sm transition-colors disabled:opacity-60">
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send This Email
                </button>
              )}
              {popupMode === 'edit' && !isDisabled && (
                <button onClick={handleSaveEdits} disabled={sending}
                  className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium text-muted bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-60">
                  <Save className="w-3.5 h-3.5" /> Save Edits
                </button>
              )}
              {!isDisabled && (
                <button onClick={() => { onDelete(); setComposeOpen(false); }}
                  className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              )}
              <button onClick={() => setComposeOpen(false)}
                className="text-xs text-muted hover:text-gray-600 ml-auto">Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const AGENT_STEP_LABELS = {
  starting: 'Agent starting…',
  researching: 'Researching professor profile',
  drafted: 'Drafting personalized email',
  verified: 'Verified — sending email',
  sending: 'Sending via Gmail',
  sent: 'Email sent successfully',
  skipped: 'Skipped — duplicate, already sent',
  duplicate_review: 'Already sent — review before re-sending',
  fallback: 'Fallback sent — no research data available',
};

const colorClasses = {
  amber: { active: 'bg-amber-50 dark:bg-amber-900/20 ring-2 ring-amber-300 dark:ring-amber-700', iconBg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400' },
  blue: { active: 'bg-blue-50 dark:bg-neutral-800 ring-2 ring-blue-300 dark:ring-blue-700', iconBg: 'bg-blue-100 dark:bg-neutral-800', text: 'text-blue-600 dark:text-blue-400' },
  purple: { active: 'bg-purple-50 dark:bg-purple-900/20 ring-2 ring-purple-300 dark:ring-purple-700', iconBg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-600 dark:text-purple-400' },
  indigo: { active: 'bg-indigo-50 dark:bg-neutral-800 ring-2 ring-indigo-300 dark:ring-indigo-700', iconBg: 'bg-indigo-100 dark:bg-neutral-800', text: 'text-indigo-600 dark:text-indigo-400' },
  emerald: { active: 'bg-emerald-50 dark:bg-neutral-800 ring-2 ring-emerald-300 dark:ring-emerald-700', iconBg: 'bg-emerald-100 dark:bg-neutral-800', text: 'text-emerald-600 dark:text-emerald-400' },
  green: { active: 'bg-green-50 dark:bg-green-900/20 ring-2 ring-green-300 dark:ring-green-700', iconBg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-600 dark:text-green-400' },
  red: { active: 'bg-red-50 dark:bg-red-900/20 ring-2 ring-red-300 dark:ring-red-700', iconBg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-400' },
  slate: { active: 'bg-slate-50 dark:bg-neutral-800 ring-2 ring-slate-300 dark:ring-slate-700', iconBg: 'bg-slate-100 dark:bg-neutral-800', text: 'text-slate-600 dark:text-slate-400' },
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
        <div className="px-4 py-2 text-[10px] text-muted border-b border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
          {stats.withName} with last name · names from your sheet are used as-is when you import
        </div>
      )}

      {data.type === 'spreadsheet' && data.sheets?.map((sheet, si) => (
        <div key={si} className="overflow-auto max-h-[250px]">
          {data.sheets.length > 1 && <div className="px-3 py-1 text-[10px] font-medium text-muted bg-gray-50 dark:bg-neutral-800/50">{sheet.name}</div>}
          <table className="w-full text-[11px] border-collapse">
            {sheet.headers.length > 0 && (
              <thead>
                <tr className="bg-gray-50 dark:bg-neutral-800">
                  {sheet.headers.map((h, i) => (
                    <th key={i} className="px-3 py-1.5 text-left font-semibold text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-neutral-700 whitespace-nowrap">{h || `Col ${i + 1}`}</th>
                  ))}
                </tr>
              </thead>
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
          {sheet.totalRows > 20 && <div className="px-3 py-1.5 text-[10px] text-muted bg-gray-50 dark:bg-neutral-800/50">...and {sheet.totalRows - 20} more rows</div>}
        </div>
      ))}

      {data.type === 'text' && (
        <div className="overflow-auto max-h-[250px] bg-gray-50 dark:bg-black border-b border-gray-200 dark:border-neutral-700">
          <pre className="px-4 py-3 text-[11px] font-mono text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{data.content}</pre>
        </div>
      )}

      {data.type === 'document' && (
        <div className="overflow-auto max-h-[250px] border-b border-gray-200 dark:border-neutral-700">
          <pre className="px-4 py-3 text-[11px] text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{data.content}</pre>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-neutral-800">
        <span className="text-[10px] text-muted">
          {count} ready to import{data.organized ? ' (organized sheet → roster Excel)' : ''}
          {subjectModeLabel && <> · {subjectModeLabel}</>}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Cancel</button>
          <button onClick={onConfirm} disabled={importing || count === 0} className="btn-primary text-xs px-4 py-1.5">
            {importing ? <Loader2 className="w-3 h-3 animate-spin" /> : <><CheckCircle2 className="w-3 h-3" /> Import {count} Professors</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN DASHBOARD ───────────────────────────────────
export default function Instant({ pageMode = 'instant', pageLabel = 'Instant' }) {
  const navigate = useNavigate();
  const isBasicMode = pageMode === 'basic_instant';
  const {
    stats, queue, template, instantTemplate, basicTemplate, agentContext, health,
    settings, analytics, sessionLoading, sessionRefreshing, connectionsSettled, sessionError, resetting, sessionVersion,
    backendReachable,
    setTemplate, setQueue, setSettings, setBasicTemplate, setInstantTemplate, loadSession, resetSession, applyReset, setAnalytics, setMode, setAuth,
  } = useSession();
  const activeTemplate = isBasicMode ? basicTemplate : instantTemplate;

  useEffect(() => { setMode(pageMode); }, [setMode, pageMode]);
  const { isConnected } = useGmailAuth();
  const { connected: sseConnected, subscribe } = useEventStream();
  const { openSettings, openSentArchive } = useSettingsModal();
  const toast = useToast();

  const [events, setEvents] = useState([]);
  const [sentEmails, setSentEmails] = useState([]);
  const [scrapeProgress, setScrapeProgress] = useState({ running: false });
  const [foundProfessors, setFoundProfessors] = useState([]);
  const sessionEpochRef = useRef(0);
  const autoClearingRef = useRef(false);
  const refreshTimerRef = useRef(null);
  const sectionImportRef = useRef(null);
  const sectionTemplateRef = useRef(null);
  const sectionPipelineRef = useRef(null);
  const sectionProcessingRef = useRef(null);
  const sectionActivityRef = useRef(null);
  const sectionFailuresRef = useRef(null);
  const sectionRepliesRef = useRef(null);
  const duplicateRef = useRef(null);

  // Import
  const [emailInput, setEmailInput] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [importTab, setImportTab] = useState('url');
  const [filePreview, setFilePreview] = useState(null);
  const [maxProfessors, setMaxProfessors] = useState('');
  const [skipDesignations, setSkipDesignations] = useState([]);
  const [webSearchingId, setWebSearchingId] = useState(null);
  const proceedingIdRef = useRef(null);
  const pendingProceedIdRef = useRef(null);
  const [proceedingId, setProceedingId] = useState(null);
  const [agentToast, setAgentToast] = useState(null);
  const [keywordSaving, setKeywordSaving] = useState(false);
  const [roster, setRoster] = useState([]);
  const [liveCompose, setLiveCompose] = useState(null);
  const [pendingProceedId, setPendingProceedId] = useState(null);
  const [agentStopped, setAgentStopped] = useState(false);
  const [activityLog, setActivityLog] = useState([]);
  const [queueProgress, setQueueProgress] = useState(null);
  const agentToastTimerRef = useRef(null);

  // Template
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);

  // Reset
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [resetToast, setResetToast] = useState(false);
  const [resetError, setResetError] = useState('');
  const [approveAllConfirm, setApproveAllConfirm] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const [rejectAllConfirm, setRejectAllConfirm] = useState(false);
  const [rejectingAll, setRejectingAll] = useState(false);
  const [replies, setReplies] = useState([]);
  const [deliveryFailures, setDeliveryFailures] = useState([]);
  const [queueFilter, setQueueFilter] = useState('all');
  const [replyFilter, setReplyFilter] = useState('all');
  const [failureFilter, setFailureFilter] = useState('all');
  const [sendingAllProcessing, setSendingAllProcessing] = useState(false);
  const [instantQueues, setInstantQueues] = useState([]);
  const [instantQueuesLoading, setInstantQueuesLoading] = useState(false);
  const [openSignals, setOpenSignals] = useState({});
  const [highlightTarget, setHighlightTarget] = useState('');
  const { data: apiUsage, refresh: refreshOperational, freshness } = useOperationalSummary(pageMode);

  const activeItem = useMemo(() => queue.find(q => ['researching', 'drafted', 'verified', 'sending'].includes(q.state)), [queue]);
  const awaitingProceedItem = useMemo(() => queue.find(q => q.state === 'awaiting_proceed'), [queue]);

  const agentFlowStage = useMemo(() => {
    if (agentToast?.stage && !['starting'].includes(agentToast.stage)) return agentToast.stage;
    if (scrapeProgress.running) return scrapeProgress.phase === 'template' ? 'import' : 'researching';
    return activeItem?.state || (awaitingProceedItem ? 'import' : null);
  }, [agentToast, scrapeProgress, activeItem, awaitingProceedItem]);

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
    pending: queue.filter(q => q.state === 'pending').length,
    awaitingProceed: queue.filter(q => q.state === 'awaiting_proceed').length,
    duplicateReview: queue.filter(q => q.state === 'duplicate_review').length,
    processing: queue.filter(q => ['researching', 'drafted', 'verified'].includes(q.state)).length,
    sent: queue.filter(q => q.state === 'sent').length,
    failed: queue.filter(q => q.state === 'failed' || q.state === 'skipped').length,
  }), [queue]);
  const statsForCards = useMemo(() => ({
    ...stats,
    deliveryFailed: apiUsage?.operational?.failures?.pending || 0,
    notFoundFailures: apiUsage?.operational?.failures?.notFound || 0,
    sendLimitFailures: apiUsage?.operational?.failures?.sendLimit || 0,
  }), [stats, apiUsage]);

  const navigateCard = useCallback((target, filter = 'all') => {
    const refs = {
      import: sectionImportRef,
      template: sectionTemplateRef,
      pipeline: sectionProcessingRef,
      activity: sectionActivityRef,
      failures: sectionFailuresRef,
      replies: sectionRepliesRef,
      duplicates: duplicateRef,
    };
    if (target === 'archive') return openSentArchive();
    if (target === 'gmail') return openSettings();
    if (target === 'scheduled') return navigate('/scheduled');
    if (target === 'pipeline') setQueueFilter(filter);
    if (target === 'failures') setFailureFilter(filter);
    if (target === 'replies') setReplyFilter(filter);
    setOpenSignals(current => ({ ...current, [target]: Date.now() }));
    setHighlightTarget(target);
    setTimeout(() => refs[target]?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
    setTimeout(() => setHighlightTarget(current => current === target ? '' : current), 2200);
  }, [navigate, openSentArchive, openSettings]);

  const cardActions = useMemo(() => ({
    sentHistory: { label: 'Open sent archive', onClick: () => navigateCard('archive') },
    pipeline: { label: 'Open processing queue', onClick: () => navigateCard('pipeline', 'processing') },
    review: { label: 'Review pending emails', onClick: () => navigateCard('template') },
    duplicates: { label: 'Review duplicates', onClick: () => navigateCard('duplicates') },
    failed: { label: 'Open failed work', onClick: () => navigateCard('pipeline', 'failed') },
    notFound: { label: 'Open not-found failures', onClick: () => navigateCard('failures', 'not_found') },
    sendLimit: { label: 'Open Gmail limits', onClick: () => navigateCard('failures', 'send_limit') },
    activity: { label: 'Open live activity', onClick: () => navigateCard('activity') },
    positiveReplies: { label: 'Show positive replies', onClick: () => navigateCard('replies', 'positive') },
    negativeReplies: { label: 'Show negative replies', onClick: () => navigateCard('replies', 'negative') },
    gmail: { label: 'Open Gmail settings', onClick: () => navigateCard('gmail') },
    scheduledBatches: { label: 'Open scheduled mode', onClick: () => navigateCard('scheduled') },
    totalBatches: { label: 'Open batch history', onClick: () => navigateCard('scheduled') },
  }), [navigateCard]);
  const workflowStages = useMemo(() => {
    const processingCount = queue.filter(item => ['researching', 'drafted', 'verified', 'sending'].includes(item.state)).length;
    const failedCount = queue.filter(item => item.state === 'failed').length;
    const sentCount = queue.filter(item => item.state === 'sent').length;
    const awaitingCount = queue.filter(item => item.state === 'awaiting_proceed').length;
    const manualReview = (settings?.approval_mode || 'manual') === 'manual' && awaitingCount > 0;
    return [
      {
        id: 'import',
        title: 'Import professors',
        description: 'You add the source; the agent validates and organizes every professor.',
        icon: Globe,
        owner: importing ? 'agent' : 'user',
        status: importing || scrapeProgress.running ? 'active' : queue.length ? 'complete' : 'attention',
        count: queue.length || roster.length || 0,
        onClick: () => navigateCard('import'),
      },
      {
        id: 'roster',
        title: 'Research & roster',
        description: 'The agent researches, removes duplicates, and updates the live roster.',
        icon: Table2,
        owner: 'agent',
        status: processingCount ? 'active' : roster.length ? 'ready' : 'idle',
        count: processingCount || roster.length || 0,
        onClick: () => navigateCard('roster'),
      },
      {
        id: 'draft',
        title: 'Draft & approval',
        description: manualReview ? 'Review the prepared emails before sending.' : 'The agent prepares and verifies each personalized draft.',
        icon: Mail,
        owner: manualReview ? 'user' : 'agent',
        status: manualReview ? 'attention' : templateLoading ? 'active' : activeTemplate?.raw_html ? 'ready' : 'idle',
        count: awaitingCount,
        onClick: () => navigateCard('template'),
      },
      {
        id: 'delivery',
        title: 'Delivery & results',
        description: 'Track sending, failures, replies, and permanent sent history.',
        icon: Send,
        owner: failedCount ? 'user' : 'agent',
        status: failedCount ? 'error' : queue.some(item => item.state === 'sending') ? 'active' : sentCount ? 'complete' : 'idle',
        count: sentCount,
        onClick: () => navigateCard(failedCount ? 'failures' : 'pipeline', failedCount ? 'failed' : 'all'),
      },
    ];
  }, [queue, roster, importing, scrapeProgress.running, settings?.approval_mode, templateLoading, activeTemplate?.raw_html, navigateCard]);
  const proceedTarget = awaitingProceedItem || (pendingProceedId ? queue.find(q => q.id === pendingProceedId) : null);

  const duplicateItems = useMemo(() => queue.filter(q => q.state === 'duplicate_review'), [queue]);
  const awaitingItems = useMemo(() => queue.filter(q => q.state === 'awaiting_proceed'), [queue]);
  const isEmptyWorkspace = stats?.total === 0 && !scrapeProgress.running;

  useResumeStep({
    duplicateCount: duplicateItems.length,
    awaitingCount: awaitingItems.length,
    failedCount: queue.filter(q => q.state === 'failed').length,
    refs: { duplicateRef, templateRef: sectionTemplateRef, importRef: sectionImportRef, queueRef: sectionPipelineRef },
  });

  useKeyboardApproval({
    items: awaitingItems,
    enabled: (settings?.approval_mode || 'manual') === 'manual' && awaitingItems.length > 0,
    onApprove: (item) => post(`/queue/${item.id}/approve`).then(loadSession),
    onReject: (item) => post(`/queue/${item.id}/reject`).then(loadSession),
  });

  const setApprovalMode = useCallback(async (mode) => {
    try {
      await put('/settings', { ...settings, approval_mode: mode, auto_send: mode === 'auto' ? 1 : 0 });
      await loadSession();
    } catch (e) {
      toast.error(e.message || 'Could not update send mode');
    }
  }, [settings, loadSession, toast]);

  const approveAllPending = useCallback(async () => {
    if (!awaitingItems.length) return;
    setApprovingAll(true);
    try {
      const res = await post('/queue/bulk', {
        action: 'approve_all',
        mode: pageMode,
        ids: awaitingItems.map(i => i.id),
      });
      const count = res.affected ?? 0;
      setApproveAllConfirm(false);
      if (count > 0) {
        toast.success(`Sending ${count} email${count === 1 ? '' : 's'} now`);
      } else {
        toast.info('No emails waiting for approval');
      }
      await loadSession();
    } catch (e) {
      toast.error(e.message || 'Could not approve all emails');
    } finally {
      setApprovingAll(false);
    }
  }, [pageMode, awaitingItems, loadSession, toast]);

  const rejectAllPending = useCallback(async () => {
    if (!awaitingItems.length) return;
    setRejectingAll(true);
    try {
      const res = await post('/queue/bulk', {
        action: 'reject_all',
        mode: pageMode,
        ids: awaitingItems.map(i => i.id),
      });
      const count = res.affected ?? 0;
      setRejectAllConfirm(false);
      if (count > 0) toast.success(`Rejected ${count} pending email${count === 1 ? '' : 's'}`);
      else toast.info('No emails waiting for rejection');
      await loadSession();
    } catch (e) {
      toast.error(e.message || 'Could not reject pending emails');
    } finally {
      setRejectingAll(false);
    }
  }, [pageMode, awaitingItems, loadSession, toast]);

  const clearLocalState = () => {
    // Preserve events (Live Activity) and replies — reset only clears queue/template/roster
    setScrapeProgress({ running: false });
    setRoster([]);
    setLiveCompose(null);
    setPendingProceedId(null); pendingProceedIdRef.current = null;
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

  const refreshProcessingQueue = useCallback(() => (
    get(`/queue?mode=${encodeURIComponent(pageMode)}&limit=500`)
      .then(rows => { if (Array.isArray(rows)) setQueue(rows); })
      .catch(() => {})
  ), [pageMode, setQueue]);

  const refreshInstantQueues = useCallback(async () => {
    setInstantQueuesLoading(true);
    try {
      const rows = await get(`/instant-queues?mode=${encodeURIComponent(pageMode)}`);
      setInstantQueues(Array.isArray(rows) ? rows : []);
    } finally {
      setInstantQueuesLoading(false);
    }
  }, [pageMode]);

  useEffect(() => {
    if (backendReachable) refreshInstantQueues();
  }, [backendReachable, pageMode, sessionVersion, refreshInstantQueues]);

  const sendAllSafeProcessing = useCallback(async () => {
    setSendingAllProcessing(true);
    try {
      const result = await post('/queue/send-all-safe', { mode: pageMode, confirm: true }, { timeout: 120000 });
      await refreshProcessingQueue();
      await loadSession({ force: true });
      if (result.affected > 0) toast.success(`Started ${result.affected} safe pending emails`);
      else toast.info(result.message || 'No safe pending emails to send');
    } catch (error) {
      toast.error(error.message || 'Send All could not start');
    } finally {
      setSendingAllProcessing(false);
    }
  }, [loadSession, pageMode, refreshProcessingQueue, toast]);

  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      loadSession();
      refreshProcessingQueue();
      refreshInstantQueues();
    }, 600);
  }, [loadSession, refreshInstantQueues, refreshProcessingQueue]);

  const fetchDeliveryFailures = useCallback(async () => {
    try {
      setDeliveryFailures(await get(`/delivery-failures?mode=${pageMode}`));
    } catch (error) {
      toast.error(error.message || 'Could not load delivery failures');
    }
  }, [pageMode, toast]);

  const defaultSubjectEnabled = !!settings?.basic_subject_keyword;
  const searchSubjectEnabled = !!settings?.basic_search_subject_keyword;
  const basicSubjectMode = basicSubjectModeFromSettings(settings);

  const saveBasicSubjectOptions = useCallback(async ({ defaultSubject, searchSubjectKeyword, activeToggle }) => {
    if (keywordSaving) return;
    const prev = {
      defaultSubject: defaultSubjectEnabled,
      searchSubjectKeyword: searchSubjectEnabled,
    };
    setKeywordSaving(true);
    setSettings(s => s ? {
      ...s,
      basic_subject_keyword: defaultSubject ? 1 : 0,
      basic_search_subject_keyword: searchSubjectKeyword ? 1 : 0,
    } : s);
    try {
      const res = await post('/settings/basic-subject-options', { defaultSubject, searchSubjectKeyword, activeToggle }, { timeout: 15000 });
      if (res?.settings) setSettings(res.settings);
      if (res?.template?.raw_html) setBasicTemplate(res.template);
    } catch (err) {
      setSettings(s => s ? {
        ...s,
        basic_subject_keyword: prev.defaultSubject ? 1 : 0,
        basic_search_subject_keyword: prev.searchSubjectKeyword ? 1 : 0,
      } : s);
      toast.error(err.message || 'Could not save subject options');
    } finally {
      setKeywordSaving(false);
    }
  }, [defaultSubjectEnabled, searchSubjectEnabled, keywordSaving, setSettings, setBasicTemplate, toast]);

  const toggleDefaultSubject = useCallback((e) => {
    e?.stopPropagation?.();
    const next = !defaultSubjectEnabled;
    saveBasicSubjectOptions({ defaultSubject: next, searchSubjectKeyword: next ? false : searchSubjectEnabled, activeToggle: 'default' });
  }, [defaultSubjectEnabled, searchSubjectEnabled, saveBasicSubjectOptions]);

  const toggleSearchSubject = useCallback((e) => {
    e?.stopPropagation?.();
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
    pushActivity({ stage: stage || 'step', label, professor: data.professor || data.professor_email, error: data.error });
  }, [pushActivity]);

  const showErrorToast = useCallback((message, professor) => {
    clearTimeout(agentToastTimerRef.current);
    setAgentToast({
      stage: 'error',
      label: message || 'Something went wrong',
      professor,
      at: Date.now(),
    });
    agentToastTimerRef.current = setTimeout(() => setAgentToast(null), 8000);
    pushActivity({ stage: 'error', label: message || 'Something went wrong', professor, error: true });
  }, [pushActivity]);

  const patchQueueFromEvent = useCallback((data) => {
    if (!data?.id) return;
    setQueue(prev => prev.map(q => (
      q.id === data.id
        ? {
          ...q,
          state: data.state ?? q.state,
          subject: data.subject ?? q.subject,
          interest_line: data.interest_line ?? q.interest_line,
          professor_email: data.professor_email ?? q.professor_email,
          error: data.error ?? q.error,
        }
        : q
    )));
  }, [setQueue]);

  const patchRosterFromEvent = useCallback((email, patch) => {
    if (!email) return;
    setRoster(prev => {
      const norm = email.toLowerCase();
      const idx = prev.findIndex(r => (r.email || '').toLowerCase() === norm);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...patch };
        return next;
      }
      if (patch.row) return [...prev, patch.row].slice(-300);
      return prev;
    });
  }, []);

  const refreshRoster = useCallback(() => (
    get(`/roster/sheet?mode=${pageMode}`)
      .then(rows => { if (Array.isArray(rows)) setRoster(rows); })
      .catch(() => {})
  ), [pageMode]);

  useEffect(() => () => {
    clearTimeout(refreshTimerRef.current);
    clearTimeout(agentToastTimerRef.current);
  }, []);

  useEffect(() => {
    if (stats?.sessionEpoch != null) sessionEpochRef.current = stats.sessionEpoch;
  }, [stats?.sessionEpoch]);

  useEffect(() => {
    get('/scrape/status').then(s => { if (s.running) setScrapeProgress(s); }).catch(() => {});
    refreshRoster();
    refreshProcessingQueue();

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

      // Ignore events from other modes (require mode tag on queue/agent events)
      const globalTypes = new Set(['reset', 'gmail_connected', 'gmail_disconnected', 'connected']);
      if (!globalTypes.has(data.type) && data.mode && data.mode !== pageMode) return;
      if (!globalTypes.has(data.type) && !data.mode && /^(state_change|progress|agent_step|compose_update|sent|awaiting_proceed|batch_auto_start|template_loaded|scrape_)/.test(data.type || '')) return;
      if (pageMode === 'instant' && data.mode === 'basic_instant') return;
      if (pageMode === 'basic_instant' && data.mode === 'instant') return;
      if (data.mode === 'scheduled' || (data.type && data.type.startsWith('scheduled_'))) return;

      if (data.sessionEpoch != null && data.sessionEpoch !== sessionEpochRef.current) return;

      if (data.type === 'gmail_connected') {
        setAuth(prev => ({
          ...prev,
          authenticated: true,
          senderEmail: data.email || prev?.senderEmail,
          senderName: data.name || prev?.senderName,
          canSend: true,
          canLoadTemplate: true,
        }));
        if (data.switched) {
          setSentEmails([]);
          loadSession({ force: true });
        }
        return;
      }
      if (data.type === 'gmail_disconnected') {
        setAuth({ authenticated: false, senderEmail: null, senderName: null, canSend: false, canLoadTemplate: false });
        return;
      }

      if (data.type === 'agent_stopped') {
        setAgentStopped(true);
        setScrapeProgress({ running: false });
        showAgentStep({ stage: 'stopped', label: data.label || 'All work stopped' });
        return;
      }

      if (data.type === 'roster_update') {
        if (data.row?.research_status === 'imported' || data.row?.research_status === 'manual') {
          patchRosterFromEvent(data.email, data.row);
        }
        return;
      }
      if (data.type === 'roster_row_deleted') {
        setRoster(prev => prev.filter(row => String(row.email || '').toLowerCase() !== String(data.email || '').toLowerCase()));
        return;
      }
      if (data.type === 'delivery_failure_updated') {
        fetchDeliveryFailures();
        refreshOperational();
        loadSession();
        return;
      }

      if (data.type === 'scrape_found') {
        setFoundProfessors(prev => [...prev, { name: data.professorName, email: data.professorEmail }]);
      }
      if (data.type === 'scrape_progress') {
        setScrapeProgress({ running: true, ...data });
      }
      if (data.type === 'scrape_complete') {
        setScrapeProgress({ running: false });
        setFoundProfessors([]);
        if (Array.isArray(data.roster)) setRoster(data.roster);
        refreshRoster();
        setImportMsg(`${data.added} professors queued · ${data.skipped} skipped${data.templateLoaded ? ' · Template loaded' : ''}${data.autoStarted ? ' · Agent auto-started' : ''}`);
        setUrlInput('');
        loadSession();
        setTimeout(() => setImportMsg(''), 8000);
      }
      if (data.type === 'web_research_complete') {
        loadSession();
        refreshRoster();
        setImportMsg(`Web research complete for ${data.professor || 'professor'} — keywords updated`);
        setTimeout(() => setImportMsg(''), 6000);
      }
      if (data.type === 'scrape_cancelled') {
        setScrapeProgress({ running: false });
        setFoundProfessors([]);
      }
      if (data.type === 'scrape_skipped') {
        setEvents(prev => [{ type: 'skipped', professor: data.email, time: formatTime12(new Date()) }, ...prev].slice(0, 50));
      }
      if (data.type === 'batch_auto_start') {
        setAgentStopped(false);
        showAgentStep({ stage: 'starting', label: data.label || 'Batch outreach auto-started' });
        scheduleRefresh();
      }
      if (data.type === 'roster_row') {
        setRoster(prev => [...prev, data.row].slice(-200));
      }
      if (data.type === 'compose_update') {
        setLiveCompose(data);
        patchQueueFromEvent({ id: data.id, state: data.state, subject: data.subject, interest_line: data.interestLine || data.interest_line, professor_email: data.professor_email || data.professor, professor: data.professor });
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
      }
      if (data.type === 'progress') {
        patchQueueFromEvent({ id: data.id, state: data.stage, professor: data.professor, subject: data.subject });
        showAgentStep(data);
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
          setAgentStopped(false);
          // Auto-reset for single email: clear proceed state, ready for next
          if (pendingProceedIdRef.current || proceedingIdRef.current) {
            setPendingProceedId(null); pendingProceedIdRef.current = null;
            setProceedingId(null); proceedingIdRef.current = null;
            setImportMsg(`✓ Email sent to ${data.professor} — ready for next professor`);
            setTimeout(() => setImportMsg(''), 6000);
          }
        }
        if (data.type === 'skipped' && data.error === 'duplicate_skipped') {
          showAgentStep({ stage: 'skipped', label: AGENT_STEP_LABELS.skipped, professor: data.professor });
        }
        if (data.type === 'duplicate_review') {
          showAgentStep({ stage: 'duplicate_review', label: AGENT_STEP_LABELS.duplicate_review, professor: data.professor });
        }
      }
      if (data.type === 'send_limit_reached') {
        toast.warning('User-rate limit exceeded. Wait some time before sending again.');
        setAgentStopped(true);
        scheduleRefresh();
      }
      if (data.type === 'batch_complete') {
        toast.success('Done');
        scheduleRefresh();
      }
      if (data.type === 'sent') {
        get(`/analytics?mode=${pageMode}`).then(a => { if (a?.overview) setAnalytics(a); }).catch(() => {});
      }
      if (!['stream_connected', 'stream_disconnected', 'connected'].includes(data.type)) {
        setEvents(prev => [{ ...data, time: formatTime12(new Date()) }, ...prev].slice(0, 50));
      }
    });
  }, [applyReset, loadSession, scheduleRefresh, setAnalytics, subscribe, showAgentStep, patchQueueFromEvent, patchRosterFromEvent, setAuth, pageMode, fetchDeliveryFailures, refreshOperational, refreshRoster, refreshProcessingQueue]);

  useEffect(() => {
    if (!backendReachable) return undefined;
    const tick = () => get(`/queue/progress?mode=${pageMode}`).then(setQueueProgress).catch(() => {});
    tick();
    if (sseConnected) return undefined;
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [backendReachable, pageMode, queue.length, stats?.sent, sseConnected]);

  useEffect(() => {
    if (!backendReachable) return;
    post('/queue/reconcile', { mode: pageMode })
      .then(refreshProcessingQueue)
      .catch(() => {});
  }, [backendReachable, pageMode, sessionVersion, refreshProcessingQueue]);

  const currentActivity = useMemo(() => {
    if (agentStopped) return null;
    if (scrapeProgress.running) return { stage: 'import', label: scrapeProgress.label || 'Scraping faculty profiles', loading: true };
    if (agentToast) return { ...agentToast, loading: ['researching', 'drafted', 'verified', 'sending'].includes(agentToast.stage) };
    if (activeItem) return { stage: activeItem.state, label: AGENT_STEP_LABELS[activeItem.state] || activeItem.state, professor: activeItem.professor_email };
    return null;
  }, [agentStopped, scrapeProgress, agentToast, activeItem]);

  useEffect(() => {
    if (isConnected) get('/gmail/sent').then(setSentEmails).catch(() => setSentEmails([]));
    else setSentEmails([]);
  }, [isConnected]);

  useEffect(() => {
    get(`/replies?mode=${pageMode}`).then(setReplies).catch(() => {});
  }, [stats?.replied, sessionVersion]);

  useEffect(() => {
    fetchDeliveryFailures();
  }, [fetchDeliveryFailures, sessionVersion]);

  // Actions
  const proceedNow = async (queueId) => {
    if (!queueId) return;
    setProceedingId(queueId); proceedingIdRef.current = queueId;
    try {
      const res = await post(`/queue/${queueId}/proceed`);
      setQueue(prev => prev.map(q => (q.id === queueId ? { ...q, state: 'pending' } : q)));
      showAgentStep({ stage: 'starting', label: 'Agent starting — processing professor…', professor: res.professor_email });
      setPendingProceedId(null); pendingProceedIdRef.current = null;
      setImportMsg('Agent started — processing this professor now');
      setTimeout(() => setImportMsg(''), 8000);
    } catch (e) {
      const message = e.message || 'Could not proceed';
      setImportMsg(`error:${message}`);
      showErrorToast(message);
      setTimeout(() => setImportMsg(''), 5000);
    } finally {
      setProceedingId(null); proceedingIdRef.current = null;
    }
  };

  const webSearchQueue = async (queueId) => {
    setWebSearchingId(queueId);
    try {
      await post(`/queue/${queueId}/web-research`);
      setImportMsg('Web search complete — agent will draft using internet research');
      loadSession();
      setTimeout(() => setImportMsg(''), 6000);
    } catch (e) {
      showErrorToast(e.message || 'Web search failed');
    } finally {
      setWebSearchingId(null);
    }
  };

  const webSearchFromRoster = async (professorId, queueId) => {
    const key = queueId || professorId;
    setWebSearchingId(key);
    try {
      if (queueId) await post(`/queue/${queueId}/web-research`);
      else await post(`/professors/${professorId}/web-research`, { mode: pageMode });
      setImportMsg('Web search complete — keywords updated');
      loadSession();
      setTimeout(() => setImportMsg(''), 6000);
    } catch (e) {
      showErrorToast(e.message || 'Web search failed');
    } finally {
      setWebSearchingId(null);
    }
  };

  const webSearchBulk = async () => {
    setWebSearchingId('bulk');
    try {
      const res = await post('/queue/web-research-bulk', { mode: pageMode });
      setImportMsg(`Web search complete for ${res.processed} professor(s)`);
      loadSession();
      setTimeout(() => setImportMsg(''), 8000);
    } catch (e) {
      showErrorToast(e.message || 'Bulk web search failed');
    } finally {
      setWebSearchingId(null);
    }
  };

  const importEmails = async () => {
    setImporting(true);
    let awaitingProceed = false;
    try {
      const payload = {
        mode: pageMode,
        max_professors: maxProfessors ? parseInt(maxProfessors) : undefined,
        ...(skipDesignations.length ? { skip_designations: skipDesignations } : {}),
      };
      const res = await post('/professors', urlInput ? { url: urlInput, ...payload } : { emails: emailInput, ...payload });
      if (res.started) {
        setImportMsg('Scraping all professors in background — one by one…');
        setFoundProfessors([]);
        setScrapeProgress({ running: true, phase: 'discovering', current: 0, total: 0 });
      } else if (res.awaitingProceed && res.singleQueueId) {
        awaitingProceed = true;
        setPendingProceedId(res.singleQueueId); pendingProceedIdRef.current = res.singleQueueId;
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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      const response = await fetch('/api/upload/preview', { method: 'POST', body: form, signal: controller.signal });
      const res = await response.json().catch(() => ({}));
      clearTimeout(timer);
      if (!response.ok || res.error) {
        const message = res.error || `Upload failed (${response.status})`;
        setImportMsg(`error:${message}`);
        showErrorToast(message);
      } else {
        setFilePreview(res);
        if (res.rosterEntries?.length) {
          refreshRoster();
        }
      }
    } catch (err) {
      const message = err.name === 'AbortError' ? 'Upload timed out — try a smaller file' : `Upload failed: ${err.message || 'Network error'}`;
      setImportMsg(`error:${message}`);
      showErrorToast(message);
    }
    setImporting(false);
    e.target.value = '';
  };

  const confirmFileImport = async () => {
    if (!filePreview?.emails?.length && !filePreview?.rosterEntries?.length) return;
    setImporting(true);
    let awaitingProceed = false;
    try {
      const body = {
        mode: pageMode,
        approval_mode: settings?.approval_mode || 'manual',
        max_professors: maxProfessors ? parseInt(maxProfessors) : undefined,
      };
      if (filePreview.rosterEntries?.length) body.rosterEntries = filePreview.rosterEntries;
      else body.emails = filePreview.emails;
      const res = await post('/upload/confirm', body);
      if (res.awaitingProceed && res.singleQueueId) {
        awaitingProceed = true;
        setPendingProceedId(res.singleQueueId); pendingProceedIdRef.current = res.singleQueueId;
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
      refreshInstantQueues();
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
    const result = await resetSession(pageMode);
    if (result.success) {
      sessionEpochRef.current = result.sessionEpoch ?? sessionEpochRef.current;
      setResetToast(true);
      if (result.backupPath) {
        setImportMsg(`Backup saved before reset: ${result.backupPath}`);
        setTimeout(() => setImportMsg(''), 12000);
      }
      setTimeout(() => setResetToast(false), 5000);
    } else {
      setResetError(result.error || 'Reset failed — please try again');
      await loadSession();
    }
  };

  const saveInstructions = async (instructions, sampleSubject) => {
    setTemplateLoading(true);
    await post('/template/raw', { instructions, sample_subject: sampleSubject, mode: pageMode });
    await loadSession();
    setTemplateLoading(false);
    setTemplateSaved(true);
    setTimeout(() => setTemplateSaved(false), 3000);
  };

  const detectPlaceholders = async () => {
    setTemplateLoading(true);
    await post('/template/detect', { mode: pageMode });
    await loadSession();
    setTemplateLoading(false);
  };

  const pickSentEmail = async (id) => {
    setTemplateLoading(true);
    try {
      await post('/template', { messageId: id, mode: pageMode });
      await post('/template/detect', { mode: pageMode });
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
      await post('/template/load-latest', { mode: pageMode });
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
  const rejectDuplicate = (id) => del(`/queue/${id}`).then(loadSession).catch(() => {});
  const rejectAllDuplicates = (ids) => post('/queue/bulk', { action: 'skip_duplicates', mode: pageMode, ids }).then(loadSession);

  const startNewTask = async () => {
    await resetSession(pageMode);
    clearLocalState();
  };

  const autoClearForNewTask = useCallback(async () => {
    if (autoClearingRef.current || resetting) return;
    autoClearingRef.current = true;
    try {
      clearLocalState();
      const result = await resetSession(pageMode);
      if (result.success) {
        sessionEpochRef.current = result.sessionEpoch ?? sessionEpochRef.current;
        setResetToast(true);
        setTimeout(() => setResetToast(false), 5000);
      }
    } finally {
      autoClearingRef.current = false;
    }
  }, [pageMode, resetSession, resetting]);

  useAutoClearAfterBatch({
    queue,
    stats,
    onClear: autoClearForNewTask,
    resetting,
  });

  const clearCompleted = async () => {
    try {
      const res = await post('/queue/clear-completed', { mode: pageMode });
      await loadSession();
      toast.success(`Cleared ${res.removed} completed tasks`);
    } catch (e) {
      toast.error(`Failed to clear: ${e.message}`);
    }
  };

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

      {resetToast && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-neutral-800 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Dashboard cleared — analytics kept. Ready for a new outreach batch.
        </motion.div>
      )}

      {resetError && (
        <div className="text-xs p-3 rounded-xl bg-red-50 dark:bg-neutral-800 border border-red-200 text-red-600 font-medium">{resetError}</div>
      )}

      <AnalyticsPopupRegistration
        stats={statsForCards}
        queueStats={liveStats}
        apiUsage={apiUsage}
        health={health}
        progress={queueProgress}
        replyStats={replyStats}
        actions={cardActions}
        freshness={freshness}
      />

      <ReadyForNewBanner
        queue={queue}
        stats={stats}
        onStartNew={startNewTask}
        resetting={resetting}
        label="outreach batch"
      />

      <div ref={sectionPipelineRef} className={`scroll-mt-20 rounded-xl transition ${['pipeline', 'activity'].includes(highlightTarget) ? 'ring-2 ring-brand-400' : ''}`}>
        <CombinedLiveSection currentActivity={currentActivity} queue={queue} stats={stats} scrapeProgress={scrapeProgress} stopped={agentStopped} events={events} connected={sseConnected} openSignal={Math.max(openSignals.pipeline || 0, openSignals.activity || 0)} />
      </div>

      <CommandStrip>
        <BulkQueueActions mode={pageMode} onRefresh={loadSession} />
        <RunBatchBar mode={pageMode} onStarted={loadSession} />
        <CampaignPresets onApplied={loadSession} />
        <OnboardingChecklist
          hasQueue={queue.length > 0}
          hasTemplate={!!activeTemplate?.raw_html}
          hasSent={(stats?.sent || 0) > 0}
          modeLabel={pageLabel}
          actions={{
            gmail: () => navigateCard('gmail'),
            import: () => navigateCard('import'),
            template: () => navigateCard('template'),
            send: () => navigateCard('archive'),
          }}
        />
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-[rgb(var(--border-subtle))]">
          <ResetNotice scope={pageLabel} />
          {!resetConfirm ? (
            <button type="button" onClick={() => setResetConfirm(true)} className="text-[10px] font-medium text-muted hover:text-red-600 dark:hover:text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/10 border border-transparent hover:border-red-500/30 transition-all flex items-center gap-1.5 shrink-0">
              <Trash2 className="w-3 h-3" /> New task
            </button>
          ) : (
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <span className="text-[10px] text-red-600 dark:text-red-400 font-medium">Clear this mode?</span>
              <button type="button" onClick={resetAll} disabled={resetting} className="text-[10px] font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-60 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
                {resetting ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Confirm reset
              </button>
              <button type="button" onClick={() => setResetConfirm(false)} className="text-[10px] text-muted px-2 py-1 rounded-lg">Cancel</button>
            </div>
          )}
        </div>
      </CommandStrip>

      {/* ─── STEP 1: Import Professors ─── */}
      <WorkflowDeck activeId={highlightTarget}>
      <WorkflowSlide id="import" title="Import" icon={Globe} status={importing ? 'Working' : 'Ready'}>
      <div ref={sectionImportRef} className="scroll-mt-20">
        <StepCard step={1} title="Import" subtitle="Faculty URL, email list, or file upload · send time advisor" icon={Globe}
          active={importing || scrapeProgress.running}
          done={queue.length > 0}
          owner={importing || scrapeProgress.running ? 'agent' : 'user'}
          statusLabel={importing || scrapeProgress.running ? 'Agent importing' : queue.length > 0 ? 'Imported' : 'Add professors'}
          actionRequired={!importing && !scrapeProgress.running && queue.length === 0}
          defaultOpen={isEmptyWorkspace || importing || scrapeProgress.running}
          openSignal={openSignals.import}
        >
          <InstantSendTimePanel embedded />

          <BatchScrapeProgress progress={scrapeProgress} foundProfessors={foundProfessors} onStop={async () => { await post('/scrape/cancel'); setScrapeProgress({ running: false }); setFoundProfessors([]); }} />

          {isBasicMode && (
            <BasicSubjectOptions
              defaultSubjectEnabled={defaultSubjectEnabled}
              searchSubjectEnabled={searchSubjectEnabled}
              saving={keywordSaving}
              onToggleDefault={toggleDefaultSubject}
              onToggleSearch={toggleSearchSubject}
            />
          )}

          <DesignationSkipFilter value={skipDesignations} onChange={setSkipDesignations} className="mb-3" />

          {/* Send Mode Toggle */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-neutral-800/50 border border-gray-200 dark:border-neutral-700">
            <div className="flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">Send Mode</span>
            </div>
            <div className="flex gap-1 p-0.5 bg-gray-200 dark:bg-neutral-700 rounded-lg">
              <button type="button"
                onClick={() => setApprovalMode('auto')}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${(settings?.approval_mode || 'manual') === 'auto' ? 'bg-emerald-500 text-white shadow-sm' : 'text-muted hover:text-gray-700 dark:hover:text-gray-300'}`}
              ><Zap className="w-3 h-3" /> Auto Send</button>
              <button type="button"
                onClick={() => setApprovalMode('manual')}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${(settings?.approval_mode || 'manual') === 'manual' ? 'bg-violet-500 text-white shadow-sm' : 'text-muted hover:text-gray-700 dark:hover:text-gray-300'}`}
              ><ShieldCheck className="w-3 h-3" /> Manual Review</button>
            </div>
            <span className="text-[10px] text-muted ml-auto">
              {(settings?.approval_mode || 'manual') === 'auto' ? 'Auto research, draft & send' : 'Default: review each email in Step 3 before send'}
            </span>
          </div>
          {/* Max Professors */}
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-gray-50 dark:bg-neutral-800/50 border border-gray-200 dark:border-neutral-700">
            <Users className="w-4 h-4 text-muted" />
            <span className="text-[11px] font-medium text-muted">Max Professors</span>
            <input type="number" min="1" max="500" value={maxProfessors} onChange={e => setMaxProfessors(e.target.value)}
              placeholder="All" className="w-20 px-2 py-1.5 text-[11px] rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-400" />
            <span className="text-[10px] text-muted">Limit how many professors to process</span>
          </div>

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
                <p className="text-[10px] text-muted">Agent scrapes every profile one-by-one — skips professors with no online data</p>
                <button onClick={importEmails} disabled={importing || !urlInput.trim()} className="btn-primary text-xs px-5 py-2 shrink-0">
                  {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Globe className="w-3.5 h-3.5" /> Scrape Profiles</>}
                </button>
              </div>
            </div>
          )}

          {importTab === 'paste' && (
            <div className="space-y-3">
              <textarea value={emailInput} onChange={e => setEmailInput(e.target.value)} rows={6} className="input text-xs font-mono leading-relaxed"
                placeholder={"Dr. Jane Smith, jsmith@mit.edu, Machine Learning, NLP, Computer Vision\nProf. Wei Zhang | wzhang@stanford.edu | Distributed Systems, Cloud Computing\n\nPaste name, email, and research keywords (comma or pipe separated). Last name is extracted from the full name."} />
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[10px] text-muted">
                  {isBasicMode
                    ? (searchSubjectEnabled
                      ? 'Agent extracts name, last name, email, and keywords into the Excel roster'
                      : defaultSubjectEnabled
                        ? 'Agent extracts full name and last name into the Excel roster'
                        : 'Agent extracts name and last name — single email waits for Proceed Now')
                    : 'Agent intelligently parses name, email, and research keywords into the Excel roster'}
                </p>
                <button onClick={importEmails} disabled={importing || !emailInput.trim()} className="btn-primary text-xs px-5 py-2">
                  {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Zap className="w-3.5 h-3.5" /> Add to Queue</>}
                </button>
              </div>
              {(proceedTarget || importMsg.includes('Proceed Now')) && (
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-violet-50 dark:bg-neutral-800 border border-violet-200 dark:border-violet-800">
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
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 dark:border-neutral-700 rounded-xl py-8 cursor-pointer hover:border-brand-400 dark:hover:border-brand-500 hover:bg-brand-50/30 dark:hover:bg-brand-900/5 transition-all group">
                {importing ? <Loader2 className="w-7 h-7 text-brand-500 animate-spin mb-2" /> : <FileSpreadsheet className="w-7 h-7 text-gray-400 group-hover:text-brand-500 mb-2 transition-colors" />}
                <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{importing ? 'Processing...' : 'Click to upload file'}</span>
                <span className="text-[10px] text-muted mt-1">Excel, CSV, PDF, Word, TXT</span>
                <input type="file" accept=".xlsx,.xls,.csv,.pdf,.docx,.doc,.txt" onChange={handleFile} className="hidden" />
              </label>
              <FilePreview data={filePreview} onConfirm={confirmFileImport} onCancel={() => setFilePreview(null)} importing={importing} subjectModeLabel={isBasicMode ? (searchSubjectEnabled ? 'Search subject keyword ON' : defaultSubjectEnabled ? 'Default subject ON' : 'Fixed subject') : undefined} />
            </div>
          )}

          {importMsg && (
            <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className={`text-xs p-2.5 rounded-lg font-medium ${importMsg.startsWith('error:') ? 'bg-red-50 dark:bg-neutral-800 text-red-600 dark:text-red-400' : 'bg-emerald-50 dark:bg-neutral-800 text-emerald-600 dark:text-emerald-400'}`}>
              {importMsg.replace(/^error:/, '')}
            </motion.div>
          )}
        </StepCard>
      </div>

      {/* ─── STEP 2: Excel Roster ─── */}
      </WorkflowSlide>
      <WorkflowSlide id="roster" title="Excel roster" icon={Table2} badge={roster.length}>
      <StepCard step={2} title="Excel roster" subtitle="Your imported sheet · changed only by your add, edit, or delete actions" icon={Table2}
        done={roster.length > 0}
        owner="user"
        statusLabel={roster.length ? `${roster.length} imported rows` : 'Waiting for import'}
        defaultOpen={roster.length > 0}
        openSignal={openSignals.roster}
      >
        <LiveRosterPanel
          rows={roster}
          mode={pageMode}
          onClear={async () => { await post('/roster/clear'); setRoster([]); }}
          onSave={() => { refreshRoster(); loadSession(); }}
        />
      </StepCard>

      {/* ─── STEP 3: Email Template Draft ─── */}
      </WorkflowSlide>
      <WorkflowSlide id="pipeline" title="Processing" icon={Activity} badge={queue.length || undefined}>
      <div ref={sectionProcessingRef} className={`scroll-mt-20 rounded-xl transition ${highlightTarget === 'pipeline' ? 'ring-2 ring-brand-400' : ''}`}>
        <StepCard
          step={3}
          title={instantQueues[0] ? `Processing · Queue #${instantQueues[0].queue_number}` : 'Processing'}
          subtitle="Research, duplicate verification, drafting, sending, sent, and failure history"
          icon={Activity}
          active={queue.some(item => ['researching', 'drafted', 'verified', 'sending'].includes(item.state))}
          done={queue.length > 0 && queue.every(item => ['sent', 'replied', 'skipped', 'failed'].includes(item.state))}
          owner="agent"
          actionRequired={queue.some(item => ['awaiting_proceed', 'needs_review', 'duplicate_review'].includes(item.state))}
          statusLabel={`${queue.length} processing records`}
          defaultOpen={queue.length > 0}
          openSignal={openSignals.pipeline}
        >
          <ProcessingQueueTable
            queue={queue}
            onSend={id => post(`/queue/${id}/send`).then(loadSession)}
            onRejectDuplicate={rejectDuplicate}
            onRetry={retryItem}
            onProceed={proceedNow}
            onDelete={deleteItem}
            onWebSearch={webSearchQueue}
            onWebSearchBulk={webSearchBulk}
            webSearchingId={webSearchingId}
            proceedingId={proceedingId}
            onSendAll={sendAllSafeProcessing}
            sendingAll={sendingAllProcessing}
            filter={queueFilter}
            onClearFilter={() => setQueueFilter('all')}
          />
        </StepCard>
      </div>
      </WorkflowSlide>
      <WorkflowSlide id="template" title="Email draft" icon={Mail} badge={awaitingItems.length || undefined}>
      <div ref={sectionTemplateRef} className="scroll-mt-20">
        <StepCard step={4} title="Email draft" subtitle="Review and edit template before sending" icon={Mail}
          active={activeTemplate && !templateSaved}
          done={templateSaved}
          owner={(settings?.approval_mode || 'manual') === 'manual' && awaitingItems.length > 0 ? 'user' : 'agent'}
          actionRequired={(settings?.approval_mode || 'manual') === 'manual' && awaitingItems.length > 0}
          statusLabel={awaitingItems.length > 0 ? `${awaitingItems.length} need review` : templateSaved ? 'Template saved' : activeTemplate?.raw_html ? 'Draft ready' : 'Waiting for template'}
          defaultOpen={!!activeTemplate?.raw_html || awaitingItems.length > 0 || duplicateItems.length > 0}
          openSignal={openSignals.template || openSignals.duplicates}
        >
          <GmailComposeChrome
            key={`compose-${pageMode}-${activeTemplate?.id || 'empty'}`}
            template={activeTemplate}
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
            basicMode={isBasicMode}
            basicSubjectMode={isBasicMode ? basicSubjectMode : 'fixed'}
          />

          {/* ─── Pending Approval Section (Manual Mode) ─── */}
          {(settings?.approval_mode || 'manual') === 'manual' && (
            awaitingItems.length > 0 ? (
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2.5 px-1 flex-wrap">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ShieldCheck className="w-4 h-4 text-violet-500 shrink-0" />
                    <h3 className="font-semibold text-sm text-gray-800 dark:text-gray-100">Pending Approval</h3>
                    <span className="text-[10px] text-muted">{awaitingItems.length} emails awaiting your review</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => (rejectAllConfirm ? rejectAllPending() : setRejectAllConfirm(true))}
                      disabled={rejectingAll || approvingAll}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/10 text-[10px] font-semibold transition-colors disabled:opacity-60"
                    >
                      {rejectingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <SkipForward className="w-3 h-3" />}
                      {rejectAllConfirm ? 'Confirm Reject All' : 'Reject All'}
                    </button>
                    <button
                      type="button"
                      onClick={() => (approveAllConfirm ? approveAllPending() : setApproveAllConfirm(true))}
                      disabled={approvingAll || rejectingAll}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold shadow-sm transition-colors disabled:opacity-60"
                    >
                      {approvingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      {approveAllConfirm ? 'Confirm Send All' : 'Approve & Send All'}
                    </button>
                  </div>
                </div>
                {rejectAllConfirm && (
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
                    <p className="text-xs text-red-800 dark:text-red-200">
                      Click <strong>Confirm Reject All</strong> to reject all {awaitingItems.length} pending email{awaitingItems.length === 1 ? '' : 's'} without sending.
                    </p>
                    <button
                      type="button"
                      onClick={() => setRejectAllConfirm(false)}
                      disabled={rejectingAll}
                      className="text-[10px] text-muted px-2 py-1.5 rounded-lg hover:bg-red-100/60 dark:hover:bg-red-900/20 transition-colors shrink-0"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {approveAllConfirm && (
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                    <p className="text-xs text-emerald-800 dark:text-emerald-200">
                      Click <strong>Confirm Send All</strong> to send all {awaitingItems.length} email{awaitingItems.length === 1 ? '' : 's'} immediately.
                    </p>
                    <button
                      type="button"
                      onClick={() => setApproveAllConfirm(false)}
                      disabled={approvingAll}
                      className="text-[10px] text-muted px-2 py-1.5 rounded-lg hover:bg-emerald-100/60 dark:hover:bg-emerald-900/20 transition-colors shrink-0"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                <div className="space-y-2">
                  {awaitingItems.map(item => (
                    <ApprovalCard key={item.id} item={item}
                      basicMode={isBasicMode}
                      onApprove={() => post(`/queue/${item.id}/approve`).then(loadSession)}
                      onReject={() => del(`/queue/${item.id}`).then(loadSession).catch(() => {})}
                      onDelete={() => del(`/queue/${item.id}`).then(loadSession)}
                      onEdit={(subject, interestLine, professorEmail, customHtml) => put(`/queue/${item.id}/edit`, { subject, interest_line: interestLine, professor_email: professorEmail, custom_html: customHtml }).then(loadSession)}
                      templateHtml={activeTemplate?.raw_html}
                      settings={settings}
                      sent={item.state === 'sent'}
                    />
                  ))}
                </div>
              </section>
            ) : null
          )}
        </StepCard>
      </div>

      </WorkflowSlide>
      <WorkflowSlide id="failures" title="Delivery failures" icon={AlertTriangle} badge={deliveryFailures.length || undefined}>
      <div ref={sectionFailuresRef} className={`scroll-mt-20 rounded-xl transition ${highlightTarget === 'failures' ? 'ring-2 ring-red-400' : ''}`}>
        <StepCard step={5} title="Delivery failures" subtitle="Bounces, not-found addresses, and Gmail limits" icon={AlertTriangle} owner="user" actionRequired={deliveryFailures.some(item => item.status === 'pending')} statusLabel={`${deliveryFailures.length} records`} openSignal={openSignals.failures}>
          <DeliveryFailuresPanel failures={deliveryFailures} onRefresh={fetchDeliveryFailures} filter={failureFilter} onClearFilter={() => setFailureFilter('all')} mode={pageMode} />
        </StepCard>
      </div>
      </WorkflowSlide>

      <WorkflowSlide id="duplicates" title="Duplicates" icon={ShieldCheck} badge={duplicateItems.length || undefined}>
        <div ref={duplicateRef} className="scroll-mt-20">
          <StepCard step={6} title="Duplicates" subtitle="Previously contacted professors remain protected" icon={ShieldCheck} owner="user" actionRequired={duplicateItems.length > 0} statusLabel={duplicateItems.length ? `${duplicateItems.length} need review` : 'Protected'} openSignal={openSignals.duplicates}>
            <DuplicateReviewPanel items={duplicateItems} onReject={rejectDuplicate} onRejectAll={rejectAllDuplicates} onDelete={deleteItem} />
          </StepCard>
        </div>
      </WorkflowSlide>

      <WorkflowSlide id="completed-queues" title="Completed queues" icon={ListChecks} badge={instantQueues.filter(item => item.status === 'completed').length || undefined}>
        <StepCard
          step={7}
          title="Completed queues"
          subtitle={`Permanent ${isBasicMode ? 'Basic Instant' : 'Normal Instant'} queue history`}
          icon={ListChecks}
          owner="agent"
          done={instantQueues.some(item => item.status === 'completed')}
          statusLabel={`${instantQueues.length} queue${instantQueues.length === 1 ? '' : 's'} tracked`}
        >
          <InstantQueueHistory
            mode={pageMode}
            queues={instantQueues}
            loading={instantQueuesLoading}
            onRefresh={refreshInstantQueues}
          />
        </StepCard>
      </WorkflowSlide>

      <WorkflowSlide id="replies" title="Replies" icon={MessageSquare} badge={replies.length || undefined}>
      <div ref={sectionRepliesRef} className={`scroll-mt-20 rounded-xl transition ${highlightTarget === 'replies' ? 'ring-2 ring-brand-400' : ''}`}>
        <StepCard step={8} title="Replies" subtitle="Classified professor replies and manual response actions" icon={MessageSquare} owner="user" statusLabel={`${replies.length} replies`} openSignal={openSignals.replies}>
          <ReplyAnalyticsSection replies={replies} onRefresh={loadSession} filter={replyFilter} onClearFilter={() => setReplyFilter('all')} openSignal={openSignals.replies} />
        </StepCard>
      </div>
      </WorkflowSlide>

      <WorkflowSlide id="follow-ups" title="Follow-ups" icon={Clock}>
        <StepCard step={9} title="Follow-ups" subtitle="Nudge professors who never replied · drafts you review and send manually" icon={Clock} owner="user">
          <FollowUpsPanel />
        </StepCard>
      </WorkflowSlide>

      <WorkflowSlide id="engagement" title="Engagement" icon={Activity}>
        <StepCard step={10} title="Engagement" subtitle="Open, click, and reply rates across your outreach" icon={Activity} owner="user">
          <EngagementPanel />
        </StepCard>
      </WorkflowSlide>
      </WorkflowDeck>
    </WorkflowPage>
  );
}
