import { BarChart3, Sparkles, Clock, Target, Send, AlertTriangle, MessageSquare, ThumbsUp, ThumbsDown, Minus, Cpu } from 'lucide-react';

function KpiCard({ label, value, sub, icon: Icon, gradient }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
      <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br ${gradient} opacity-10 rounded-bl-full`} />
      <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center mb-3 shadow-sm`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums mt-0.5">{value}</p>
      <p className="text-xs text-muted mt-1">{sub}</p>
    </div>
  );
}

export default function AnalyticsPanel({ data, queueStats, replyStats, apiUsage, activeAgents }) {
  const overview = data?.overview;
  const hasData = overview && overview.sent > 0;
  const pending = queueStats?.pending ?? overview?.pending ?? 0;
  const awaitingProceed = queueStats?.awaitingProceed ?? 0;
  const duplicateReview = queueStats?.duplicateReview ?? 0;
  const processing = queueStats?.processing ?? 0;

  const positive = replyStats?.positive ?? 0;
  const negative = replyStats?.negative ?? 0;
  const neutral = replyStats?.neutral ?? 0;
  const autoReply = replyStats?.auto_reply ?? 0;
  const totalReplies = positive + negative + neutral + autoReply;

  // Real-time AI agent stats from /api-usage
  const agentsWorking = activeAgents ?? 0;
  const totalTokens = apiUsage?.tokens?.total ?? 0;
  const apiCalls = apiUsage?.apiCalls;
  const activeModel = apiUsage?.tokens?.usage
    ? Object.entries(apiUsage.tokens.usage).sort((a, b) => b[1] - a[1])[0]?.[0] || '—'
    : '—';

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#1a73e8] to-violet-600 flex items-center justify-center">
          <BarChart3 className="w-4 h-4 text-white" />
        </div>
        <div>
          <h3 className="font-semibold text-sm text-gray-900 dark:text-white">Analytics status</h3>
          <p className="text-[10px] text-muted">Live queue + outreach performance</p>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4 w-full">
        <KpiCard label="Pending" value={pending} sub="awaiting agent" icon={Clock} gradient="from-amber-500 to-orange-500" />
        <KpiCard label="Awaiting" value={awaitingProceed} sub="waiting for you" icon={Sparkles} gradient="from-violet-500 to-purple-600" />
        <KpiCard label="Processing" value={processing} sub="research → send" icon={Target} gradient="from-blue-500 to-indigo-600" />
        <KpiCard label="Sent" value={overview?.sent || queueStats?.sent || 0} sub="all time" icon={Send} gradient="from-[#1a73e8] to-blue-600" />
        <KpiCard label="AI Agents" value={agentsWorking} sub={`${activeModel} · ${totalTokens.toLocaleString()} tokens`} icon={Cpu} gradient="from-teal-500 to-cyan-600" />
      </div>

      {duplicateReview > 0 && (
        <KpiCard label="Already Sent" value={duplicateReview} sub="review duplicates" icon={AlertTriangle} gradient="from-yellow-500 to-orange-500" />
      )}

      {totalReplies > 0 && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-emerald-500" />
            <h4 className="text-xs font-semibold">Reply Insights</h4>
            <span className="text-[10px] text-muted">{totalReplies} total replies</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-50 dark:bg-neutral-800">
              <ThumbsUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{positive}</p>
                <p className="text-[9px] text-emerald-600/70 dark:text-emerald-400/70">Positive</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-red-50 dark:bg-neutral-800">
              <ThumbsDown className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
              <div>
                <p className="text-sm font-bold text-red-700 dark:text-red-400">{negative}</p>
                <p className="text-[9px] text-red-600/70 dark:text-red-400/70">Negative</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-neutral-900/20">
              <Minus className="w-3.5 h-3.5 text-muted" />
              <div>
                <p className="text-sm font-bold text-gray-700 dark:text-gray-400">{neutral}</p>
                <p className="text-[9px] text-gray-600/70 dark:text-gray-400/70">Neutral</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-50 dark:bg-neutral-800">
              <Clock className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <div>
                <p className="text-sm font-bold text-blue-700 dark:text-blue-400">{autoReply}</p>
                <p className="text-[9px] text-blue-600/70 dark:text-blue-400/70">Auto-reply</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {data?.aiHints?.summary && (
        <div className="rounded-xl border border-violet-200/60 dark:border-violet-800/40 bg-violet-50/50 dark:bg-violet-950/20 p-3 text-xs text-gray-700 dark:text-gray-300">
          <span className="font-semibold text-violet-700 dark:text-violet-300">AI targeting: </span>
          {data.aiHints.summary}
        </div>
      )}
    </section>
  );
}
