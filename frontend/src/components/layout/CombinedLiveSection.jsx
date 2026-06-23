import React from 'react';
import { Activity, Loader2, PauseCircle } from 'lucide-react';
import AgentFlowBar from '../AgentFlowBar.jsx';
import LiveFeed from '../LiveFeed.jsx';
import SectionShell from './SectionShell.jsx';

export default function CombinedLiveSection({
  currentActivity,
  queue,
  stats,
  scrapeProgress,
  stopped,
  events,
  connected,
  openSignal,
}) {
  return (
    <SectionShell
      icon={Activity}
      title="Live activity & pipeline"
      subtitle="Actual agent progress and real-time events"
      collapsible
      defaultOpen={false}
      openSignal={openSignal}
      badge={(
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${
          connected ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/15 text-red-600 dark:text-red-400'
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
          {connected ? 'Live' : 'Offline'}
        </span>
      )}
      bodyClassName="p-0"
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)]">
        <div className="border-b border-[rgb(var(--border-subtle))] bg-gradient-to-br from-brand-500/[0.04] via-transparent to-violet-500/[0.04] p-4 lg:border-b-0 lg:border-r">
          <div className="mb-4 flex items-center gap-3 rounded-2xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-card))]/80 p-3 shadow-sm">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-sm ${
              stopped ? 'bg-gray-400' : currentActivity ? 'bg-gradient-to-br from-brand-500 to-violet-600' : 'bg-[rgb(var(--surface-muted))]'
            }`}>
              {stopped ? <PauseCircle className="h-5 w-5 text-white" /> : currentActivity?.loading ? <Loader2 className="h-5 w-5 animate-spin text-white" /> : <Activity className="h-5 w-5 text-brand-500" />}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Current work</p>
              <p className="truncate text-sm font-semibold text-[rgb(var(--text-primary))]">
                {stopped ? 'Agent stopped' : currentActivity?.label || 'Waiting for work'}
              </p>
              {currentActivity?.professor && <p className="truncate text-[10px] text-brand-600">{currentActivity.professor}</p>}
            </div>
          </div>
          <div className="rounded-2xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-card))] p-3 shadow-sm">
            <AgentFlowBar
              scrapePhase={scrapeProgress}
              activeStage={currentActivity?.stage}
              queue={queue}
              stats={stats}
              liveLabel={currentActivity?.label}
              embedded
            />
          </div>
        </div>
        <div className="flex h-[360px] min-h-0 min-w-0 flex-col bg-[rgb(var(--surface-card))]">
          <div className="flex shrink-0 items-center justify-between border-b border-[rgb(var(--border-subtle))] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">Live activity</p>
              <p className="text-[10px] text-muted">Newest agent events appear here</p>
            </div>
            <span className="rounded-full bg-[rgb(var(--surface-muted))] px-2.5 py-1 text-[10px] font-semibold tabular-nums text-muted">
              {events?.length || 0} events
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <LiveFeed events={events || []} connected={connected} embedded />
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
