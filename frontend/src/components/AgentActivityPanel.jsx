import React, { useMemo } from 'react';
import { Bot, Search, Edit3, ShieldCheck, Send, Globe, Loader2, PauseCircle, Sparkles } from 'lucide-react';
import AgentFlowBar from './AgentFlowBar.jsx';

const STAGE_ICONS = {
  import: Globe,
  researching: Search,
  drafted: Edit3,
  verified: ShieldCheck,
  sending: Send,
  sent: Send,
  awaiting_proceed: ShieldCheck,
  error: PauseCircle,
  stopped: PauseCircle,
};

const WORKFLOW_STEP_LABELS = {
  instant: ['Import professors', 'Research profile', 'Draft email', 'Verify draft', 'Send via Gmail'],
  basic_instant: ['Import professors', 'Lookup last name', 'Draft email', 'Verify draft', 'Send via Gmail'],
  scheduled: ['Import & schedule', 'Research professors', 'Draft emails', 'Review or auto-approve', 'Send at scheduled time'],
  basic_scheduled: ['Import & schedule', 'Lookup last names', 'Draft emails', 'Review or auto-approve', 'Send at scheduled time'],
};

/** Unified agent activity — current task, pipeline, recent steps, workflow rules. */
export default function AgentActivityPanel({
  mode = 'instant',
  agentContext,
  currentActivity,
  activityLog = [],
  queue = [],
  stats,
  scrapeProgress,
  stopped = false,
  className = '',
  embedded = false,
}) {
  const workflowSteps = agentContext?.workflow?.steps || WORKFLOW_STEP_LABELS[mode] || WORKFLOW_STEP_LABELS.instant;

  const StageIcon = STAGE_ICONS[currentActivity?.stage] || Bot;

  const recentLog = useMemo(() => activityLog.slice(0, 8), [activityLog]);

  return (
    <section className={`space-y-3 min-w-0 ${className}`}>
      <div className={`overflow-hidden ${embedded ? '' : 'rounded-2xl border border-gray-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm'}`}>
        {/* Current agent task */}
        <div className="p-4 border-b border-gray-100 dark:border-neutral-800">
          <div className="flex items-start gap-3">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-md
              ${stopped ? 'bg-gray-400' : currentActivity ? 'bg-gradient-to-br from-brand-500 to-violet-600 animate-pulse' : 'bg-gray-200 dark:bg-neutral-700'}
            `}>
              {stopped ? <PauseCircle className="w-5 h-5 text-white" /> : currentActivity?.loading ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <StageIcon className="w-5 h-5 text-white" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Agent now</h3>
                {currentActivity?.model && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-violet-100 dark:bg-neutral-800 text-violet-700 dark:text-violet-300 font-medium">
                    {currentActivity.model}
                  </span>
                )}
                {!stopped && currentActivity && (
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
                )}
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-200 mt-0.5 font-medium">
                {stopped ? 'Stopped — click Run batch or import to resume' : (currentActivity?.label || 'Idle — waiting for professors in queue')}
              </p>
              {currentActivity?.professor && (
                <p className="text-[11px] text-brand-600 dark:text-brand-400 mt-1 truncate">{currentActivity.professor}</p>
              )}
            </div>
          </div>
        </div>

        {/* How agent completes the task */}
        <div className="px-4 py-3 bg-gray-50 dark:bg-neutral-800 border-b border-gray-200 dark:border-neutral-700">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-brand-500 dark:text-brand-400" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">Agent workflow</span>
          </div>
          <ol className="space-y-1">
            {workflowSteps.slice(0, 5).map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px] text-gray-600 dark:text-neutral-300">
                <span className="w-4 h-4 rounded-full bg-white dark:bg-neutral-900 border border-brand-200 dark:border-brand-500/50 text-[9px] font-bold flex items-center justify-center text-brand-600 dark:text-brand-300 shrink-0 mt-0.5">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* Pipeline bar */}
        <div className="p-3">
          <AgentFlowBar
            scrapePhase={scrapeProgress}
            activeStage={currentActivity?.stage}
            queue={queue}
            stats={stats}
            liveLabel={currentActivity?.label}
            embedded={embedded}
          />
        </div>
      </div>

      {/* Recent activity log */}
      {recentLog.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Recent steps</p>
          <ul className="space-y-1.5 max-h-[140px] overflow-y-auto">
            {recentLog.map((e, i) => (
              <li key={e.id || i} className="flex items-center gap-2 text-[11px]">
                <span className="text-gray-400 tabular-nums shrink-0 w-12">{e.time}</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold shrink-0 ${e.error ? 'bg-red-100 text-red-700' : 'bg-gray-100 dark:bg-neutral-800 text-muted'}`}>{e.stage}</span>
                <span className="truncate text-gray-700 dark:text-gray-300">{e.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
