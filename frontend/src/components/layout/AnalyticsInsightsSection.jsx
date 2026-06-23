import React from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import InsightsPanel from '../InsightsPanel.jsx';
import SectionShell from './SectionShell.jsx';

export default function AnalyticsInsightsSection({
  stats,
  queueStats,
  apiUsage,
  health,
  progress,
  replyStats,
  actions,
  freshness,
  openSignal = 0,
  className = '',
}) {
  const processing = (queueStats?.researching ?? 0) + (queueStats?.drafted ?? 0) + (queueStats?.verified ?? 0) + (queueStats?.processing ?? 0);

  return (
    <SectionShell
      className={className}
      icon={BarChart3}
      title="Analytics & insights"
      subtitle="Queue health, send progress, workers, and token usage"
      badge={processing > 0 ? (
        <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 animate-pulse">
          Live
        </span>
      ) : null}
      actions={(
        <div className="flex items-center gap-2">
          <span className={`text-[9px] font-semibold uppercase tracking-wider ${
            freshness?.state === 'error' ? 'text-red-600' :
            freshness?.state === 'stale' ? 'text-amber-600' :
            freshness?.state === 'refreshing' ? 'text-blue-600' : 'text-emerald-600'
          }`}>
            {freshness?.state || 'live'}
          </span>
          {freshness?.updatedAt && (
            <span className="hidden sm:inline text-[9px] text-muted">
              {new Date(freshness.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          {(freshness?.error || freshness?.state === 'stale') && (
            <button type="button" onClick={freshness?.retry} className="inline-flex items-center gap-1 text-[9px] font-semibold text-amber-700 hover:underline">
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          )}
        </div>
      )}
      bodyClassName="p-4"
      openSignal={openSignal}
    >
      <InsightsPanel
        stats={stats}
        queueStats={queueStats}
        apiUsage={apiUsage}
        health={health}
        progress={progress}
        replyStats={replyStats}
        actions={actions}
        freshness={freshness}
        hideHeader
      />
    </SectionShell>
  );
}
