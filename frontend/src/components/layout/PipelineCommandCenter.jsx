import React from 'react';
import { Bot } from 'lucide-react';
import AgentActivityPanel from '../AgentActivityPanel.jsx';
import SectionShell from './SectionShell.jsx';

/**
 * Live pipeline + command center — single shared pipeline for single & batch sends.
 */
export default function PipelineCommandCenter({
  mode,
  agentContext,
  currentActivity,
  activityLog,
  queue,
  stats,
  scrapeProgress,
  stopped,
  queueFooter,
  className = '',
}) {
  return (
    <SectionShell
      className={className}
      icon={Bot}
      title="Live pipeline"
      subtitle="Single & batch share this pipeline — Import → Research → Draft → Verify → Send"
      collapsible
      defaultOpen
      bodyClassName="p-0"
      noPadding
    >
      <div className="p-4">
        <AgentActivityPanel
          mode={mode}
          agentContext={agentContext}
          currentActivity={currentActivity}
          activityLog={activityLog}
          queue={queue}
          stats={stats}
          scrapeProgress={scrapeProgress}
          stopped={stopped}
          embedded
        />
      </div>
      {queueFooter && (
        <div className="border-t border-[rgb(var(--border-subtle))] p-4 bg-[rgb(var(--surface-muted))]/20">
          {queueFooter}
        </div>
      )}
    </SectionShell>
  );
}
