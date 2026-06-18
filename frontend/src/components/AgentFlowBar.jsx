import React from 'react';
import { Activity, Search, Edit3, ShieldCheck, Send, Globe, Loader2 } from 'lucide-react';

const STEPS = [
  { key: 'import', label: 'Import', icon: Globe },
  { key: 'researching', label: 'Research', icon: Search },
  { key: 'drafted', label: 'Draft', icon: Edit3 },
  { key: 'verified', label: 'Verify', icon: ShieldCheck },
  { key: 'sent', label: 'Send', icon: Send },
];

export default function AgentFlowBar({ scrapePhase, activeStage, queue, stats, liveLabel, embedded = false }) {
  const processing = queue?.filter(q => ['researching', 'drafted', 'verified'].includes(q.state)).length || 0;
  const pending = queue?.filter(q => q.state === 'pending').length || 0;
  const awaitingProceed = queue?.filter(q => q.state === 'awaiting_proceed').length || 0;
  const duplicateReview = queue?.filter(q => q.state === 'duplicate_review').length || 0;
  const sent = queue?.filter(q => q.state === 'sent').length || stats?.sent || 0;

  const currentKey = scrapePhase?.running
    ? (scrapePhase.phase === 'template' ? 'import' : 'researching')
    : activeStage || 'import';

  const stepIndex = Math.max(0, STEPS.findIndex(s => s.key === currentKey));

  return (
    <div className={embedded ? 'space-y-3' : 'card p-4 space-y-3'}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          {!embedded && (
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">Live pipeline</h3>
          )}
          <p className={`font-medium text-[rgb(var(--text-primary))] ${embedded ? 'text-sm' : 'text-sm mt-0.5'}`}>
            {liveLabel || (scrapePhase?.running ? 'Scraping faculty → Excel roster → auto-send' : 'Single & batch share this pipeline')}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 font-semibold tabular-nums">{pending} pending</span>
          {awaitingProceed > 0 && <span className="px-2 py-1 rounded-lg bg-violet-50 dark:bg-neutral-800 text-violet-700 font-semibold tabular-nums">{awaitingProceed} awaiting</span>}
          {duplicateReview > 0 && <span className="px-2 py-1 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 font-semibold tabular-nums">{duplicateReview} dupes</span>}
          <span className="px-2 py-1 rounded-lg bg-blue-50 dark:bg-neutral-800 text-blue-700 font-semibold tabular-nums">{processing} active</span>
          <span className="px-2 py-1 rounded-lg bg-emerald-50 dark:bg-neutral-800 text-emerald-700 font-semibold tabular-nums">{sent} sent</span>
          <span className="flex items-center gap-1 text-emerald-600 font-medium ml-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Live
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          const active = i === stepIndex;
          const done = i < stepIndex;
          return (
            <React.Fragment key={step.key}>
              <div className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl transition-all ${active ? 'bg-[#1a73e8]/10 ring-2 ring-[#1a73e8]/30' : done ? 'bg-emerald-50/80 dark:bg-neutral-800' : 'opacity-50'}`}>
                {active && scrapePhase?.running ? (
                  <Loader2 className="w-4 h-4 text-[#1a73e8] animate-spin" />
                ) : (
                  <Icon className={`w-4 h-4 ${active ? 'text-[#1a73e8]' : done ? 'text-emerald-600' : 'text-gray-400'}`} />
                )}
                <span className="text-[9px] font-medium">{step.label}</span>
              </div>
              {i < STEPS.length - 1 && <div className={`h-0.5 flex-1 min-w-[12px] rounded ${done ? 'bg-emerald-400' : 'bg-gray-200 dark:bg-neutral-700'}`} />}
            </React.Fragment>
          );
        })}
      </div>

      {scrapePhase?.running && (
        <p className="text-[11px] text-muted">
          {scrapePhase.label || scrapePhase.phase} · {scrapePhase.current || 0}/{scrapePhase.total || '…'} profiles → Excel sheet
        </p>
      )}
    </div>
  );
}
