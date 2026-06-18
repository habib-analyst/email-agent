import React from 'react';
import { Bot } from 'lucide-react';
import WorkflowStepper from '../WorkflowStepper.jsx';
import AgentActivityPanel from '../AgentActivityPanel.jsx';
import InsightsPanel from '../InsightsPanel.jsx';

/**
 * Unified command center — workflow stepper + live agent + analytics.
 */
export default function CommandCenter({
  mode,
  workflowSteps,
  currentWorkflowStep,
  onStepClick,
  agentContext,
  currentActivity,
  activityLog,
  queue,
  stats,
  scrapeProgress,
  stopped,
  queueStats,
  apiUsage,
  health,
  progress,
  replyStats,
  className = '',
}) {
  return (
    <section className={`space-y-4 ${className}`} aria-label="Agent command center">
      <div className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-500/15 flex items-center justify-center">
              <Bot className="w-4 h-4 text-brand-500" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[rgb(var(--text-primary))]">Command center</h2>
              <p className="text-[11px] text-muted">Where the agent is now · live pipeline · metrics</p>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-4 border-b border-[rgb(var(--border-subtle))]">
          <WorkflowStepper
            steps={workflowSteps}
            currentStep={currentWorkflowStep}
            onStepClick={onStepClick}
            className="border-0 shadow-none bg-transparent p-0"
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-0 xl:divide-x divide-[rgb(var(--border-subtle))]">
          <div className="xl:col-span-3 p-4 space-y-0">
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
              className="space-y-3"
            />
          </div>
          <div className="xl:col-span-2 p-4 bg-[rgb(var(--surface-muted))]/30">
            <InsightsPanel
              stats={stats}
              queueStats={queueStats}
              apiUsage={apiUsage}
              health={health}
              progress={progress}
              replyStats={replyStats}
              compact
              className="space-y-3"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
