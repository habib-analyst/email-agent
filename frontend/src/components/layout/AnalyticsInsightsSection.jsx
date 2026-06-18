import React from 'react';
import { BarChart3 } from 'lucide-react';
import InsightsPanel from '../InsightsPanel.jsx';
import SectionShell from './SectionShell.jsx';

export default function AnalyticsInsightsSection({
  stats,
  queueStats,
  apiUsage,
  health,
  progress,
  replyStats,
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
      bodyClassName="p-4"
    >
      <InsightsPanel
        stats={stats}
        queueStats={queueStats}
        apiUsage={apiUsage}
        health={health}
        progress={progress}
        replyStats={replyStats}
        hideHeader
      />
    </SectionShell>
  );
}
