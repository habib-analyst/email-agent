import React from 'react';
import { TrendingUp, Zap, Target, Send, AlertTriangle, Cpu, BarChart3, Users, ShieldCheck, MessageSquare, CheckCircle2, TimerReset } from 'lucide-react';

function InsightCard({ label, value, sub, icon: Icon, gradient, pulse, compact }) {
  return (
    <div className={`relative overflow-hidden rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-card))] ${compact ? 'p-3' : 'p-4 shadow-sm'} ${pulse ? 'ring-2 ring-brand-400/30' : ''}`}>
      {!compact && <div className={`absolute -top-6 -right-6 w-20 h-20 rounded-full bg-gradient-to-br ${gradient} opacity-10`} />}
      <div className={`flex items-start justify-between gap-2 ${compact ? 'flex-col' : ''}`}>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">{label}</p>
          <p className={`font-bold text-[rgb(var(--text-primary))] tabular-nums mt-1 ${compact ? 'text-lg' : 'text-2xl'}`}>{value}</p>
          <p className="text-[10px] text-muted mt-0.5">{sub}</p>
        </div>
        {!compact && (
          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-md shrink-0`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
        )}
      </div>
    </div>
  );
}

/** Richer analytics strip for mode pages. */
export default function InsightsPanel({ stats, queueStats, apiUsage, health, progress, replyStats, className = '', compact = false, hideHeader = false }) {
  const pending = queueStats?.pending ?? stats?.pending ?? 0;
  const awaiting = queueStats?.awaitingProceed ?? stats?.awaitingProceed ?? queueStats?.approved ?? stats?.approved ?? 0;
  const duplicates = queueStats?.duplicateReview ?? stats?.duplicateReview ?? 0;
  const processing = (queueStats?.researching ?? 0) + (queueStats?.drafted ?? 0) + (queueStats?.verified ?? 0) + (queueStats?.processing ?? 0);
  const sessionSent = stats?.sent ?? queueStats?.sent ?? 0;
  const totalSent = stats?.totalSent ?? stats?.sent_email_history ?? stats?.sentEmailHistory ?? sessionSent;
  const uniqueSent = stats?.uniqueSentEmails ?? 0;
  const failed = stats?.failed ?? queueStats?.failed ?? 0;
  const deliveryFailed = stats?.deliveryFailed ?? queueStats?.deliveryFailed ?? 0;
  const sendLimitFailures = stats?.sendLimitFailures ?? queueStats?.sendLimitFailures ?? 0;
  const notFoundFailures = stats?.notFoundFailures ?? queueStats?.notFoundFailures ?? 0;
  const today = stats?.todaySent ?? 0;
  const workerTotal = health?.queueWorkers ?? 1;
  const activeWorkers = health?.activeWorkers ?? (processing > 0 ? workerTotal : 0);
  const workers = health?.running ? `${activeWorkers}/${workerTotal}` : '0';
  const tokens = apiUsage?.tokens?.total ?? 0;
  const eta = progress?.etaMinutes;
  const replyTotal = (replyStats?.positive ?? 0) + (replyStats?.negative ?? 0) + (replyStats?.neutral ?? 0) + (replyStats?.auto_reply ?? 0);
  const pipelineTotal = pending + awaiting + processing + duplicates;
  const completionRate = pipelineTotal + sessionSent > 0 ? Math.round((sessionSent / (pipelineTotal + sessionSent)) * 100) : 0;
  const lastActivity = health?.lastActivity ? new Date(health.lastActivity).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <section className={`space-y-3 min-w-0 ${className}`}>
      {!hideHeader && (
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-brand-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Insights</h3>
          {processing > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium animate-pulse">Live</span>}
        </div>
      )}
      <div className={`grid gap-3 ${compact ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6'}`}>
        <InsightCard compact={compact} label="Today sent" value={today} sub="since midnight" icon={Send} gradient="from-emerald-500 to-teal-600" />
        <InsightCard compact={compact} label="In pipeline" value={processing} sub={`${pending} queued`} icon={Target} gradient="from-blue-500 to-indigo-600" pulse={processing > 0} />
        <InsightCard compact={compact} label="Total sent" value={totalSent} sub="permanent history" icon={TrendingUp} gradient="from-brand-500 to-violet-600" />
        <InsightCard compact={compact} label="Failed" value={failed + deliveryFailed} sub={`${deliveryFailed} delivery`} icon={AlertTriangle} gradient="from-red-500 to-orange-500" />
        <InsightCard compact={compact} label="Workers" value={workers} sub={health?.running ? 'active / total' : 'idle'} icon={Zap} gradient="from-amber-500 to-orange-500" />
        <InsightCard compact={compact} label="ETA" value={eta != null ? `~${eta}m` : '—'} sub={`${(tokens / 1000).toFixed(1)}k tokens`} icon={Cpu} gradient="from-cyan-500 to-blue-600" />
      </div>
      {!compact && (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
          <InsightCard label="Unique emails" value={uniqueSent} sub="contacted once+" icon={Users} gradient="from-sky-500 to-blue-600" />
          <InsightCard label="Need review" value={awaiting} sub="your approval" icon={ShieldCheck} gradient="from-violet-500 to-purple-600" pulse={awaiting > 0} />
          <InsightCard label="Duplicates" value={duplicates} sub="decide send/skip" icon={AlertTriangle} gradient="from-yellow-500 to-orange-500" pulse={duplicates > 0} />
          <InsightCard label="Not found" value={notFoundFailures} sub="bad recipient bounce" icon={AlertTriangle} gradient="from-red-500 to-rose-600" pulse={notFoundFailures > 0} />
          <InsightCard label="Send limit" value={sendLimitFailures} sub="Gmail quota stops" icon={MessageSquare} gradient="from-orange-500 to-red-600" pulse={sendLimitFailures > 0} />
          <InsightCard label="Batch done" value={`${completionRate}%`} sub={`${sessionSent} sent this run`} icon={CheckCircle2} gradient="from-lime-500 to-emerald-600" />
          <InsightCard label="Last activity" value={lastActivity} sub={health?.db ? 'backend live' : 'backend issue'} icon={TimerReset} gradient="from-slate-500 to-gray-700" />
        </div>
      )}
    </section>
  );
}
