import React from 'react';
import { Activity, Send, Search, SkipForward, CheckCircle2, AlertTriangle, RefreshCw, Mail, Zap } from 'lucide-react';

const EVENT_META = {
  sent: { icon: Send, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-neutral-800', label: 'Sent' },
  progress: { icon: Search, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-neutral-800', label: 'Processing' },
  state_change: { icon: RefreshCw, color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-neutral-800', label: 'State' },
  skipped: { icon: SkipForward, color: 'text-slate-500', bg: 'bg-slate-50 dark:bg-neutral-800', label: 'Skipped' },
  scrape_progress: { icon: Activity, color: 'text-[#1a73e8]', bg: 'bg-blue-50 dark:bg-neutral-800', label: 'Import' },
  scrape_complete: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-neutral-800', label: 'Import done' },
  template_loaded: { icon: Mail, color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-neutral-800', label: 'Template' },
  agent_step: { icon: Zap, color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-neutral-800', label: 'Agent step' },
  verification_failed: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', label: 'Verify fail' },
  reset: { icon: RefreshCw, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20', label: 'Reset' },
};

function EventRow({ event }) {
  const meta = EVENT_META[event.type] || { icon: Activity, color: 'text-gray-500', bg: 'bg-gray-50 dark:bg-neutral-800', label: event.type };
  const Icon = meta.icon;
  const detail = event.label || event.professor || event.subject || event.email || event.stage || '';
  const duration = event.duration_ms ? `${(event.duration_ms / 1000).toFixed(1)}s` : null;
  const modelTag = event.model ? `${event.provider || ''}:${event.model}` : null;

  return (
    <div className={`flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-neutral-800/40 transition-colors ${meta.bg} bg-opacity-40`}>
      <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${meta.bg}`}>
        <Icon className={`w-3 h-3 ${meta.color}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-semibold ${meta.color}`}>{meta.label}</span>
          <span className="text-[9px] text-gray-400 font-mono">{event.time}</span>
          {duration && <span className="text-[9px] text-gray-400 font-mono">{duration}</span>}
          {modelTag && <span className="text-[9px] text-indigo-500 font-mono">{modelTag}</span>}
        </div>
        {detail && <p className="text-[10px] text-muted truncate mt-0.5">{detail}</p>}
      </div>
    </div>
  );
}

export default function LiveFeed({ events, connected, embedded = false }) {
  const wrapperClass = embedded
    ? 'h-full flex flex-col overflow-hidden'
    : 'card h-full flex flex-col !p-0 overflow-hidden';

  return (
    <div className={wrapperClass}>
      {!embedded && (
        <div className="px-4 py-3 border-b border-gray-100 dark:border-neutral-800 flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-500" /> Live activity
          </h3>
          <span className={`flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide ${connected ? 'text-emerald-600' : 'text-red-500'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>
      )}
      <div className="flex-1 overflow-auto p-2 space-y-0.5 min-h-[280px] max-h-[400px]">
        {events.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <Activity className="w-8 h-8 text-gray-200 dark:text-gray-700 mb-2" />
            <p className="text-xs text-muted">Waiting for agent activity…</p>
            <p className="text-[10px] text-muted mt-1">Import professors to start</p>
          </div>
        )}
        {events.map((e, i) => <EventRow key={`${e.time}-${e.type}-${i}`} event={e} />)}
      </div>
    </div>
  );
}
