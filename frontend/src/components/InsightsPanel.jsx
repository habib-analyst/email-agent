import React, { useEffect, useState } from 'react';
import {
  TrendingUp, Zap, Target, Send, AlertTriangle, Cpu, BarChart3, Users,
  ShieldCheck, MessageSquare, CheckCircle2, TimerReset, ThumbsUp,
  ThumbsDown, CalendarClock, Layers3,
} from 'lucide-react';
import { formatDateTime12, formatTime12, parseServerDate } from '../utils/dateTime.js';

function InsightCard({ label, value, sub, icon: Icon, gradient, pulse, compact, action, healthState = 'live' }) {
  const Tag = action?.onClick ? 'button' : 'div';
  const resolvedHealthState = healthState === 'live' && (value === 0 || value === '—') ? 'empty' : healthState;
  const healthClass = resolvedHealthState === 'error'
    ? 'ring-1 ring-red-500/40'
    : resolvedHealthState === 'stale'
      ? 'ring-1 ring-amber-500/40'
      : resolvedHealthState === 'action-required'
        ? 'ring-2 ring-violet-400/30'
        : resolvedHealthState === 'empty'
          ? 'opacity-80'
        : '';
  return (
    <Tag
      type={action?.onClick ? 'button' : undefined}
      onClick={action?.onClick}
      disabled={action?.disabled}
      title={action?.label}
      data-health-state={resolvedHealthState}
      className={`relative w-full min-w-0 overflow-hidden rounded-2xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-card))] text-left ${compact ? 'p-3' : 'min-h-[138px] p-4 shadow-sm'} ${pulse ? 'ring-2 ring-brand-400/30' : ''} ${healthClass} ${action?.onClick ? 'cursor-pointer transition hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-md disabled:cursor-default disabled:opacity-60' : ''}`}
    >
      {!compact && <div className={`absolute -top-6 -right-6 w-20 h-20 rounded-full bg-gradient-to-br ${gradient} opacity-10`} />}
      <div className={`grid items-start gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_2.5rem]'}`}>
        <div className="min-w-0 overflow-hidden">
          <p className="break-words text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
          <p className={`mt-1 break-words font-bold tabular-nums text-[rgb(var(--text-primary))] ${compact ? 'text-lg' : 'text-2xl'}`}>{value}</p>
          <p className="mt-0.5 break-words text-[10px] leading-4 text-muted">{sub}</p>
          {action?.onClick && <p className="mt-1 text-[9px] font-semibold text-brand-600 dark:text-brand-300">{action.label || 'Open'}</p>}
        </div>
        {!compact && (
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center self-start rounded-xl bg-gradient-to-br ${gradient} shadow-md`}>
            <Icon className="h-5 w-5 shrink-0 text-white" />
          </div>
        )}
      </div>
    </Tag>
  );
}

/** Richer analytics strip for mode pages. */
export default function InsightsPanel({ stats, queueStats, apiUsage, health, progress, replyStats, actions = {}, freshness = {}, className = '', compact = false, hideHeader = false }) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
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
  const operational = apiUsage?.operational;
  const liveReplies = operational?.replies || replyStats || {};
  const gmail = operational?.gmail;
  const resetMs = gmail?.resetAt ? parseServerDate(gmail.resetAt)?.getTime() - clock : 0;
  const resetLabel = gmail?.available
    ? 'Available'
    : resetMs > 0
      ? `${Math.floor(resetMs / 3_600_000)}h ${Math.floor((resetMs % 3_600_000) / 60_000)}m ${Math.floor((resetMs % 60_000) / 1000)}s`
      : 'Checking';
  const resetSub = gmail?.available
    ? 'Gmail sending ready'
    : gmail?.resetAt
      ? `resets ${formatDateTime12(gmail.resetAt)}`
      : (gmail?.reason || 'Gmail send paused');
  const lastActivity = health?.lastActivity ? formatTime12(health.lastActivity) : '—';

  return (
    <section className={`space-y-3 min-w-0 ${className}`}>
      {!hideHeader && (
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-brand-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Insights</h3>
          {processing > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium animate-pulse">Live</span>}
        </div>
      )}
      <div className={`grid gap-3 ${compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6'}`}>
        <InsightCard compact={compact} label="Today sent" value={today} sub="since midnight" icon={Send} gradient="from-emerald-500 to-teal-600" action={actions.sentHistory} healthState={freshness.state} />
        <InsightCard compact={compact} label="In pipeline" value={processing} sub={`${pending} queued`} icon={Target} gradient="from-blue-500 to-indigo-600" pulse={processing > 0} action={actions.pipeline} healthState={processing ? 'action-required' : freshness.state} />
        <InsightCard compact={compact} label="Total sent" value={totalSent} sub="permanent history" icon={TrendingUp} gradient="from-brand-500 to-violet-600" action={actions.sentHistory} healthState={freshness.state} />
        <InsightCard compact={compact} label="Failed" value={failed + deliveryFailed} sub={`${deliveryFailed} delivery`} icon={AlertTriangle} gradient="from-red-500 to-orange-500" action={actions.failed} healthState={(failed + deliveryFailed) > 0 ? 'action-required' : freshness.state} />
        <InsightCard compact={compact} label="Workers" value={workers} sub={health?.running ? 'active / total' : 'idle'} icon={Zap} gradient="from-amber-500 to-orange-500" action={actions.pipeline} healthState={freshness.state} />
        <InsightCard compact={compact} label="ETA" value={eta != null ? `~${eta}m` : '—'} sub={`${(tokens / 1000).toFixed(1)}k tokens`} icon={Cpu} gradient="from-cyan-500 to-blue-600" action={actions.pipeline} healthState={freshness.state} />
      </div>
      {!compact && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <InsightCard label="Unique emails" value={uniqueSent} sub="contacted once+" icon={Users} gradient="from-sky-500 to-blue-600" action={actions.sentHistory} healthState={freshness.state} />
          <InsightCard label="Need review" value={awaiting} sub="your approval" icon={ShieldCheck} gradient="from-violet-500 to-purple-600" pulse={awaiting > 0} action={actions.review} healthState={awaiting ? 'action-required' : freshness.state} />
          <InsightCard label="Duplicates" value={duplicates} sub="decide send/skip" icon={AlertTriangle} gradient="from-yellow-500 to-orange-500" pulse={duplicates > 0} action={actions.duplicates} healthState={duplicates ? 'action-required' : freshness.state} />
          <InsightCard label="Not found" value={notFoundFailures} sub="bad recipient bounce" icon={AlertTriangle} gradient="from-red-500 to-rose-600" pulse={notFoundFailures > 0} action={actions.notFound} healthState={notFoundFailures ? 'action-required' : freshness.state} />
          <InsightCard label="Send limit" value={sendLimitFailures} sub="Gmail quota stops" icon={MessageSquare} gradient="from-orange-500 to-red-600" pulse={sendLimitFailures > 0} action={actions.sendLimit} healthState={sendLimitFailures ? 'action-required' : freshness.state} />
          <InsightCard label="Batch done" value={`${completionRate}%`} sub={`${sessionSent} sent this run`} icon={CheckCircle2} gradient="from-lime-500 to-emerald-600" action={actions.sentHistory} healthState={freshness.state} />
          <InsightCard label="Last activity" value={lastActivity} sub={health?.db ? 'backend live' : 'backend issue'} icon={TimerReset} gradient="from-slate-500 to-gray-700" action={actions.activity} healthState={health?.db ? freshness.state : 'error'} />
          <InsightCard label="Positive replies" value={liveReplies.positive ?? 0} sub={`${liveReplies.total ?? replyTotal} total replies`} icon={ThumbsUp} gradient="from-emerald-500 to-green-600" action={actions.positiveReplies} healthState={(liveReplies.positive ?? 0) ? 'action-required' : freshness.state} />
          <InsightCard label="Negative replies" value={liveReplies.negative ?? 0} sub={`${liveReplies.autoReply ?? liveReplies.auto_reply ?? 0} auto replies`} icon={ThumbsDown} gradient="from-rose-500 to-red-600" action={actions.negativeReplies} healthState={(liveReplies.negative ?? 0) ? 'action-required' : freshness.state} />
          <InsightCard label="Gmail reset" value={resetLabel} sub={resetSub} icon={TimerReset} gradient={gmail?.available ? 'from-emerald-500 to-teal-600' : 'from-amber-500 to-orange-600'} pulse={gmail && !gmail.available} action={actions.gmail} healthState={gmail && !gmail.available ? 'action-required' : freshness.state} />
          <InsightCard label="Scheduled batches" value={operational?.batches?.scheduled ?? 0} sub="waiting for send time" icon={CalendarClock} gradient="from-violet-500 to-indigo-600" action={actions.scheduledBatches} healthState={(operational?.batches?.scheduled ?? 0) ? 'action-required' : freshness.state} />
          <InsightCard label="Total batches" value={operational?.batches?.total ?? 0} sub="permanent batch history" icon={Layers3} gradient="from-blue-500 to-cyan-600" action={actions.totalBatches} healthState={freshness.state} />
        </div>
      )}
    </section>
  );
}
