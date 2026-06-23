import React, { useEffect, useState, useRef } from 'react';
import {
  Loader2, Mail, Search, CheckCircle2, Paperclip,
  Minus, Maximize2, X, Image, Link2, Smile, MoreVertical, Save, ChevronDown, ChevronUp, FileText, Activity,
} from 'lucide-react';
import useGmailAuth from '../hooks/useGmailAuth.js';

const DEFAULT_INSTRUCTIONS = 'ONLY 3 changes: 1) Subject [Single Keyword] — one research area aligning with prof\'s work + my resume. 2) Dear Prof [LastName]. 3) Interest line — ONLY 3 comma-separated research keywords (the template already has "I am particularly interested in your work in {{INTEREST_LINE}}", so {{INTEREST_LINE}} gets just the keywords like "Distributed Systems, Cloud Computing, Big Data Processing"). Everything else stays exactly the same.';

function TemplatePreview({ html, emptyMessage }) {
  const iframeRef = useRef(null);
  useEffect(() => {
    const el = iframeRef.current;
    if (!el) return;
    const baseStyles = `margin:0;padding:16px 20px;font-family:'Roboto',Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;`;
    if (!html) {
      el.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&display=swap" rel="stylesheet"></head><body style="${baseStyles}color:#5f6368;">${emptyMessage}</body></html>`;
      return;
    }
    el.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&display=swap" rel="stylesheet"><style>body{${baseStyles}} p{margin:0 0 1em 0} ul,ol{margin:0.5em 0;padding-left:2em} li{margin:0.25em 0}</style></head><body>${html}</body></html>`;
  }, [html, emptyMessage]);
  return <iframe ref={iframeRef} title="Email body" className="gmail-chrome-body-frame" sandbox="allow-same-origin" />;
}

const BASIC_SUBJECT = 'Seeking an MS/PhD Position in Your Lab';
const BASIC_SUBJECT_WITH_DEFAULT = '[Machine Learning] Seeking an MS/PhD Position in Your Lab';
const BASIC_SUBJECT_WITH_KEYWORD = '[Keyword] Seeking an MS/PhD Position in Your Lab';

function basicInstructionsForMode(mode = 'fixed') {
  if (mode === 'search') return 'Replace {{LAST_NAME}} and subject [Keyword] from professor research. No interest line.';
  if (mode === 'default') return 'ONLY change {{LAST_NAME}}. Subject stays [Machine Learning] for every professor — no interest line.';
  return 'ONLY change {{LAST_NAME}} with the professor\'s real last name. Subject stays fixed — no keywords or interest line.';
}

function basicSampleSubjectForMode(mode = 'fixed') {
  if (mode === 'search') return BASIC_SUBJECT_WITH_KEYWORD;
  if (mode === 'default') return BASIC_SUBJECT_WITH_DEFAULT;
  return BASIC_SUBJECT;
}

export default function GmailComposeChrome({
  template, onSaveInstructions, onDetect, sentEmails, onPickSent,
  loading, saved, onPickLatest, settings, resetKey, liveCompose, basicMode = false, basicSubjectMode = 'fixed',
}) {
  const { isConnected, senderEmail: authEmail } = useGmailAuth();
  const [instructions, setInstructions] = useState(template?.instructions || (basicMode
    ? basicInstructionsForMode(basicSubjectMode)
    : DEFAULT_INSTRUCTIONS));
  const [sampleSubject, setSampleSubject] = useState(template?.sample_subject || (basicMode
    ? basicSampleSubjectForMode(basicSubjectMode)
    : BASIC_SUBJECT_WITH_KEYWORD));
  const [showSent, setShowSent] = useState(false);
  const [showAgentPanel, setShowAgentPanel] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);

  const senderEmail = settings?.sender_name
    ? `${settings.sender_name} <${settings.sender_email || authEmail || 'N/A'}>`
    : (settings?.sender_email || authEmail || 'N/A');
  const resumeName = settings?.resume_name || 'Resume.pdf';
  const hasTemplate = !!template?.raw_html;
  const isLive = !!liveCompose?.professor;
  const displaySubject = isLive && liveCompose.subject ? liveCompose.subject : sampleSubject;
  const displayHtml = isLive && liveCompose.htmlPreview ? liveCompose.htmlPreview : template?.raw_html;
  const displayTo = isLive ? liveCompose.professor : 'professor@university.edu';

  useEffect(() => {
    if (template?.instructions) setInstructions(template.instructions);
    else if (basicMode) setInstructions(basicInstructionsForMode(basicSubjectMode));
    else setInstructions(DEFAULT_INSTRUCTIONS);

    if (basicMode || !template?.sample_subject) {
      setSampleSubject(basicMode ? basicSampleSubjectForMode(basicSubjectMode) : BASIC_SUBJECT_WITH_KEYWORD);
    } else if (template?.sample_subject) {
      setSampleSubject(template.sample_subject);
    }
  }, [template, basicMode, basicSubjectMode]);

  useEffect(() => {
    if (!template?.raw_html) {
      setInstructions(basicMode ? basicInstructionsForMode(basicSubjectMode) : DEFAULT_INSTRUCTIONS);
      setSampleSubject(basicMode ? basicSampleSubjectForMode(basicSubjectMode) : BASIC_SUBJECT_WITH_KEYWORD);
    }
  }, [resetKey, template?.raw_html, basicMode, basicSubjectMode]);

  if (!showTemplate) {
    return (
      <button
        type="button"
        onClick={() => setShowTemplate(true)}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-muted))]/45 px-4 py-3 text-left transition-all hover:border-brand-400 hover:bg-brand-500/5"
      >
        <span>
          <span className="block text-xs font-bold text-[rgb(var(--text-primary))]">Email template hidden</span>
          <span className="mt-0.5 block text-[10px] text-muted">Open the Gmail compose preview and template controls.</span>
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-brand-600">Show template <ChevronDown className="h-3.5 w-3.5" /></span>
      </button>
    );
  }

  return (
    <div className="gmail-compose-shell space-y-2">
      <div className="flex justify-end">
        <button type="button" onClick={() => setShowTemplate(false)} className="inline-flex items-center gap-1 rounded-lg border border-[rgb(var(--border-subtle))] px-3 py-1.5 text-[10px] font-bold text-muted hover:text-[rgb(var(--text-primary))]">
          Hide template <ChevronUp className="h-3.5 w-3.5" />
        </button>
      </div>
      <div key={resetKey} className="gmail-chrome-compose gmail-chrome-compose-float">
        <div className="gmail-chrome-header">
          <span className="gmail-chrome-header-title">New Message</span>
          <div className="gmail-chrome-window-btns">
            <button type="button" className="gmail-chrome-winbtn" aria-label="Minimize"><Minus className="w-3.5 h-3.5" /></button>
            <button type="button" className="gmail-chrome-winbtn" aria-label="Pop-out"><Maximize2 className="w-3 h-3" /></button>
            <button type="button" className="gmail-chrome-winbtn gmail-chrome-winbtn-close" aria-label="Close"><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>

        {isLive && (
          <div className="gmail-chrome-template-bar bg-violet-50 border-violet-200">
            <Activity className="w-3.5 h-3.5 shrink-0 text-violet-600 animate-pulse" />
            <span>Agent editing live · <strong>{liveCompose.state}</strong> · {liveCompose.professor}{liveCompose.model ? ` · model: ${liveCompose.model}` : ''}</span>
          </div>
        )}

        {hasTemplate && !isLive && (
          <div className="gmail-chrome-template-bar">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>
              {basicMode
                ? (basicSubjectMode === 'search'
                  ? <>Only <strong>last name</strong> and <strong>searched subject keyword</strong> change per professor — no interest line</>
                  : basicSubjectMode === 'default'
                    ? <>Only <strong>last name</strong> changes — subject stays <strong>[Machine Learning]</strong> for all</>
                    : <>Exact copy of your sent Gmail — only <strong>last name</strong> changes per professor</>)
                : <>Agent personalizes <strong>subject [Keyword]</strong>, <strong>last name</strong>, and <strong>interest line</strong></>}
            </span>
          </div>
        )}

        <div className="gmail-chrome-row">
          <span className="gmail-chrome-label">From</span>
          <div className="gmail-chrome-from-chip">{senderEmail}</div>
        </div>

        <div className="gmail-chrome-row gmail-chrome-row-to">
          <span className="gmail-chrome-label">To</span>
          <span className="gmail-chrome-recipients flex-1">{displayTo}</span>
          {!showCc && (
            <button type="button" onClick={() => setShowCc(true)} className="gmail-chrome-cc-link">Cc Bcc</button>
          )}
        </div>

        {showCc && (
          <>
            <div className="gmail-chrome-row">
              <span className="gmail-chrome-label">Cc</span>
              <span className="gmail-chrome-recipients text-[#9aa0a6] italic text-sm">—</span>
            </div>
            <div className="gmail-chrome-row">
              <span className="gmail-chrome-label">Bcc</span>
              <span className="gmail-chrome-recipients text-[#9aa0a6] italic text-sm">—</span>
            </div>
          </>
        )}

        <div className="gmail-chrome-row gmail-chrome-row-subject">
          <input
            className="gmail-chrome-subject-input"
            value={displaySubject}
            readOnly={isLive}
            onChange={e => !isLive && setSampleSubject(e.target.value)}
            placeholder="Subject"
          />
        </div>

        <div className="gmail-chrome-body-wrap">
          <TemplatePreview
            html={displayHtml}
            emptyMessage={basicMode
              ? (basicSubjectMode === 'search'
                ? "<p style='margin-bottom:12px'><em>Your email template appears here with exact spacing and formatting.</em></p><p>Click the blue <strong>Load template</strong> button below. With <strong>Search subject keyword</strong> ON, the agent personalizes the professor's <strong>last name</strong> and finds a <strong>[Keyword]</strong> from their research — the body stays fixed.</p>"
                : basicSubjectMode === 'default'
                  ? "<p style='margin-bottom:12px'><em>Your email template appears here with exact spacing and formatting.</em></p><p>Click the blue <strong>Load template</strong> button below. With <strong>Default subject</strong> ON, only the professor's <strong>last name</strong> changes — subject stays <strong>[Machine Learning]</strong> for everyone.</p>"
                  : "<p style='margin-bottom:12px'><em>Your email template appears here with exact spacing and formatting.</em></p><p>Click the blue <strong>Load template</strong> button below. In Basic Instant mode, only the professor's last name is personalized — subject and body stay fixed.</p>")
              : "<p style='margin-bottom:12px'><em>Your email template appears here with exact spacing and formatting.</em></p><p>Click the blue <strong>Load template</strong> button below to load a sent email as your template. Once set, it stays fixed — the agent only personalizes subject, last name, and interest line per professor.</p>"}
          />
        </div>

        <div className="gmail-chrome-attachments">
          <div className="gmail-chrome-attach-chip">
            <div className="gmail-chrome-attach-pdf"><FileText className="w-4 h-4 text-red-500" /></div>
            <div className="gmail-chrome-attach-info">
              <span className="gmail-chrome-attach-name">{resumeName}</span>
              <span className="gmail-chrome-attach-meta">PDF · attached to every email · never renamed</span>
            </div>
          </div>
        </div>

        <div className="gmail-chrome-footer">
          <div className="flex items-center gap-0 flex-wrap">
            <div className="gmail-chrome-send-group">
              <button
                type="button"
                onClick={onPickLatest}
                disabled={loading}
                className="gmail-chrome-send-main"
                title="Load predefined email template"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Load template'}
              </button>
              <button type="button" className="gmail-chrome-send-dropdown" disabled={loading} aria-label="More send options">
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
            <div className="gmail-chrome-toolbar-icons">
              <button type="button" className="gmail-chrome-tool" title="Formatting"><span className="font-serif text-sm font-medium">A</span></button>
              <button type="button" className="gmail-chrome-tool" title="Attach"><Paperclip className="w-4 h-4" /></button>
              <button type="button" className="gmail-chrome-tool" title="Insert link"><Link2 className="w-4 h-4" /></button>
              <button type="button" className="gmail-chrome-tool" title="Insert photo"><Image className="w-4 h-4" /></button>
              <button type="button" className="gmail-chrome-tool" title="Emoji"><Smile className="w-4 h-4" /></button>
              <button type="button" onClick={() => setShowSent(!showSent)} className="gmail-chrome-tool" title="Pick from sent"><Mail className="w-4 h-4" /></button>
              <button type="button" onClick={() => setShowAgentPanel(!showAgentPanel)} className={`gmail-chrome-tool ${showAgentPanel ? 'gmail-chrome-tool-active' : ''}`} title="Agent rules"><MoreVertical className="w-4 h-4" /></button>
              <button type="button" onClick={() => onDetect()} disabled={!hasTemplate} className="gmail-chrome-tool" title="Detect placeholders"><Search className="w-4 h-4" /></button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {saved && <span className="text-[10px] text-emerald-600 flex items-center gap-1 font-medium"><CheckCircle2 className="w-3 h-3" />Saved</span>}
            <button type="button" onClick={() => onSaveInstructions(instructions, sampleSubject)} className="gmail-chrome-tool" title="Save instructions"><Save className="w-4 h-4" /></button>
          </div>
        </div>

        {showAgentPanel && (
          <div className="gmail-chrome-agent-panel">
            <p className="text-[10px] font-semibold text-[#1a73e8] mb-1.5 uppercase tracking-wide">Agent instructions</p>
            <p className="text-[10px] text-gray-500 mb-2">Only 3 fields change per professor — everything else stays identical to your sent email.</p>
            <textarea
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              rows={4}
              className="w-full text-xs text-[#3c4043] border border-[#dadce0] rounded-md px-3 py-2 outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]/30 resize-none"
            />
            <button type="button" onClick={() => onSaveInstructions(instructions, sampleSubject)} className="mt-2 text-xs text-[#1a73e8] hover:underline font-medium">
              Save instructions
            </button>
          </div>
        )}

        {showSent && sentEmails?.length > 0 && (
          <div className="gmail-chrome-sent-picker">
            <p className="px-4 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">Pick from sent</p>
            {sentEmails.slice(0, 8).map(e => (
              <button key={e.id} type="button" onClick={() => { onPickSent(e.id); setShowSent(false); }} className="gmail-chrome-sent-item">
                <span className="font-medium truncate text-[#202124]">{e.subject}</span>
                <span className="text-[#5f6368] truncate text-[11px]">To: {e.to}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!isConnected && (
        <p className="text-center text-[11px] text-amber-600 mt-3">Connect Gmail above to load your sent email template</p>
      )}
    </div>
  );
}
