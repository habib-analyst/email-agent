import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check, Edit3, Globe2, Loader2, Search, Send, ShieldCheck, Sparkles,
} from 'lucide-react';

const STAGES = [
  { key: 'import', label: 'Import', detail: 'Roster', icon: Globe2 },
  { key: 'researching', label: 'Research', detail: 'Profile', icon: Search },
  { key: 'drafted', label: 'Draft', detail: 'Email', icon: Edit3 },
  { key: 'verified', label: 'Verify', detail: 'Safety', icon: ShieldCheck },
  { key: 'sending', label: 'Send', detail: 'Gmail', icon: Send },
];

const NORMALIZED_STAGE = {
  starting: 'import',
  template: 'import',
  scraping: 'researching',
  processing: 'researching',
  fallback: 'drafted',
  drafting: 'drafted',
  awaiting_proceed: 'verified',
  awaiting_approval: 'verified',
  sent: 'sending',
};

function queueCount(queue, states) {
  return queue.filter(item => states.includes(item.state)).length;
}

export default function AgentFlowBar({
  scrapePhase,
  activeStage,
  queue,
  stats,
  liveLabel,
  embedded = false,
}) {
  const hasQueue = Array.isArray(queue) && queue.length > 0;
  const pending = hasQueue
    ? queueCount(queue, ['pending', 'awaiting_proceed', 'awaiting_approval'])
    : Number(stats?.pending || stats?.awaitingProceed || stats?.awaiting_approval || 0);
  const working = hasQueue
    ? queueCount(queue, ['researching', 'drafted', 'verified', 'sending'])
    : Number(stats?.processing || stats?.active || stats?.sending || 0);
  const sent = hasQueue
    ? queueCount(queue, ['sent', 'resent', 'replied'])
    : Number(stats?.sent || stats?.totalSent || 0);
  const failed = hasQueue
    ? queueCount(queue, ['failed', 'skipped'])
    : Number(stats?.failed || 0);
  const duplicates = hasQueue
    ? queueCount(queue, ['duplicate_review', 'duplicate'])
    : Number(stats?.duplicates || 0);

  const rawStage = scrapePhase?.running
    ? (scrapePhase.phase === 'template' ? 'import' : 'researching')
    : activeStage || null;
  const stageKey = NORMALIZED_STAGE[rawStage] || rawStage;
  const activeIndex = stageKey ? STAGES.findIndex(stage => stage.key === stageKey) : -1;
  const isWorking = activeIndex >= 0;
  const activeStageMeta = isWorking ? STAGES[activeIndex] : null;
  const trackProgress = isWorking
    ? Math.max(0, (activeIndex / (STAGES.length - 1)) * 100)
    : 0;
  const total = hasQueue ? queue.length : pending + working + sent + failed;
  const completion = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;
  const statusText = liveLabel
    || (scrapePhase?.running ? 'Importing faculty into the roster' : null)
    || (activeStageMeta ? `${activeStageMeta.label} is active` : 'Pipeline ready');

  return (
    <div className={embedded ? 'space-y-4' : 'card space-y-4 p-4'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <motion.div
            animate={isWorking ? { scale: [1, 1.06, 1] } : { scale: 1 }}
            transition={isWorking ? { duration: 1.8, repeat: Infinity } : {}}
            className={`relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border ${
              isWorking
                ? 'border-brand-300/50 bg-gradient-to-br from-brand-500 via-blue-500 to-violet-600 text-white shadow-lg shadow-brand-500/25'
                : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-600'
            }`}
          >
            {isWorking && <span className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/25 to-transparent animate-pulse" />}
            {isWorking
              ? <Loader2 className="relative h-4.5 w-4.5 animate-spin" />
              : <Sparkles className="relative h-4.5 w-4.5" />}
          </motion.div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-muted">
                Live email pipeline
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[8px] font-extrabold uppercase ${
                isWorking
                  ? 'bg-brand-500/10 text-brand-600'
                  : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${isWorking ? 'animate-pulse bg-brand-500' : 'bg-emerald-500'}`} />
                {isWorking ? 'Working' : 'Ready'}
              </span>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={statusText}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.2 }}
                className="mt-0.5 truncate text-sm font-bold text-[rgb(var(--text-primary))]"
              >
                {statusText}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {[
            { label: 'Waiting', value: pending, tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
            { label: 'Active', value: working, tone: 'bg-blue-500/10 text-blue-700 dark:text-blue-300' },
            { label: 'Sent', value: sent, tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
          ].map(metric => (
            <motion.div
              key={metric.label}
              whileHover={{ y: -2, scale: 1.04 }}
              className={`min-w-[54px] cursor-default rounded-xl px-2 py-1.5 text-center transition-shadow hover:shadow-md ${metric.tone}`}
            >
              <p className="text-xs font-black leading-none tabular-nums">{metric.value}</p>
              <p className="mt-1 text-[7px] font-extrabold uppercase tracking-wider opacity-75">{metric.label}</p>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-[rgb(var(--border-subtle))] bg-gradient-to-br from-brand-500/[0.05] via-[rgb(var(--surface-card))] to-violet-500/[0.05] px-2 pb-3 pt-3 shadow-inner">
        <div className="pointer-events-none absolute left-[10%] right-[10%] top-[31px] z-0 h-[4px] -translate-y-1/2 overflow-hidden rounded-full bg-[rgb(var(--border-subtle))]">
          <motion.div
            initial={false}
            animate={{ width: `${trackProgress}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 24 }}
            className="relative h-full rounded-full bg-gradient-to-r from-emerald-500 via-cyan-500 to-brand-500 shadow-[0_0_12px_rgba(59,130,246,0.45)]"
          >
            {isWorking && (
              <motion.span
                animate={{ x: ['-100%', '220%'] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/80 to-transparent"
              />
            )}
          </motion.div>
        </div>

        <div className="relative z-10 grid grid-cols-5">
          {STAGES.map((stage, index) => {
            const Icon = stage.icon;
            const active = index === activeIndex;
            const complete = isWorking && index < activeIndex;
            return (
              <motion.div
                key={stage.key}
                whileHover={{ y: -5 }}
                whileTap={{ scale: 0.97 }}
                title={`${stage.label} · ${active ? 'Active now' : complete ? 'Completed' : stage.detail}`}
                className="group flex min-w-0 cursor-pointer flex-col items-center rounded-xl px-1 py-0.5 text-center"
              >
                <motion.div
                  animate={active ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                  transition={active ? { duration: 1.5, repeat: Infinity } : {}}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-full border-[3px] transition-all duration-300 ${
                    active
                      ? 'border-white bg-gradient-to-br from-brand-500 via-blue-500 to-violet-600 text-white shadow-[0_0_0_4px_rgba(59,130,246,0.16),0_8px_22px_rgba(59,130,246,0.35)]'
                      : complete
                        ? 'border-emerald-300 bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-[0_6px_16px_rgba(16,185,129,0.28)]'
                        : 'border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-card))] text-muted shadow-sm group-hover:border-brand-400 group-hover:text-brand-600 group-hover:shadow-[0_7px_20px_rgba(59,130,246,0.2)]'
                  }`}
                >
                  {complete
                    ? <Check className="h-4 w-4 stroke-[3.5]" />
                    : <Icon className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" />}
                  {active && (
                    <>
                      <span className="absolute -inset-2 -z-10 rounded-full border border-brand-400/35 animate-ping" />
                      <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-[3px] border-white bg-emerald-400 shadow" />
                    </>
                  )}
                </motion.div>

                <p className={`mt-2 truncate text-[8px] font-black uppercase tracking-wide transition-colors sm:text-[9px] ${
                  active
                    ? 'text-brand-600'
                    : complete
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-muted group-hover:text-brand-600'
                }`}>
                  {stage.label}
                </p>
                <p className={`hidden truncate text-[7px] sm:block ${
                  active ? 'font-bold text-brand-500' : complete ? 'text-emerald-600' : 'text-muted group-hover:text-brand-500'
                }`}>
                  {active ? 'Working now' : complete ? 'Completed' : stage.detail}
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[170px] flex-1">
          <div className="mb-1.5 flex items-center justify-between text-[8px] font-extrabold uppercase tracking-wider text-muted">
            <span>Campaign completion</span>
            <span className="tabular-nums">{sent}/{total || 0} · {completion}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[rgb(var(--surface-muted))]">
            <motion.div
              initial={false}
              animate={{ width: `${completion}%` }}
              transition={{ type: 'spring', stiffness: 100, damping: 22 }}
              className="relative h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/35 to-transparent animate-pulse" />
            </motion.div>
          </div>
        </div>

        {(duplicates > 0 || failed > 0) && (
          <div className="flex gap-1.5 text-[8px] font-extrabold">
            {duplicates > 0 && <span className="rounded-full bg-yellow-500/10 px-2.5 py-1 text-yellow-700 dark:text-yellow-300">{duplicates} duplicates</span>}
            {failed > 0 && <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-red-700 dark:text-red-300">{failed} failed</span>}
          </div>
        )}
      </div>

      {scrapePhase?.running && (
        <div className="flex items-center gap-2 rounded-xl border border-brand-400/15 bg-brand-500/[0.06] px-3 py-2 text-[10px] text-brand-700 dark:text-brand-300">
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          <span className="min-w-0 flex-1 truncate">{scrapePhase.label || scrapePhase.phase}</span>
          <span className="font-black tabular-nums">{scrapePhase.current || 0}/{scrapePhase.total || '…'}</span>
        </div>
      )}
    </div>
  );
}
