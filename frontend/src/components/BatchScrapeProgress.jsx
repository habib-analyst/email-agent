import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Users, CheckCircle2, SkipForward, Globe, FileText, Square, Search, User } from 'lucide-react';

export default function BatchScrapeProgress({ progress, onStop, foundProfessors = [] }) {
  if (!progress?.running) return null;

  const phase = progress.step === 'pagination' ? 'pagination' : (progress.phase || 'discovering');
  const total = progress.total || 0;
  const current = progress.current || 0;
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : null;

  const phaseConfig = {
    discovering: { label: progress.label || 'Scanning faculty page…', icon: Globe, color: 'bg-blue-500' },
    pagination: { label: progress.label || 'Scanning paginated pages…', icon: Globe, color: 'bg-indigo-500' },
    discovered: { label: `Found ${total || '…'} professors`, icon: Users, color: 'bg-violet-500' },
    saving: { label: 'Preparing profile scrape…', icon: Loader2, color: 'bg-indigo-500' },
    enriching: { label: 'Scraping professor profiles', icon: Users, color: 'bg-[#1a73e8]' },
    profile_scrape: { label: progress.label || 'Visiting faculty profiles…', icon: Users, color: 'bg-[#1a73e8]' },
    deep_scraping: { label: progress.label || 'Deep scraping profiles…', icon: Search, color: 'bg-indigo-500' },
    lastname_lookup: { label: progress.label || 'Looking up last names…', icon: User, color: 'bg-teal-500' },
    template: { label: 'Checking template…', icon: FileText, color: 'bg-emerald-500' },
  }[phase] || { label: 'Import in progress…', icon: Loader2, color: 'bg-blue-500' };

  const Icon = phaseConfig.icon;
  const isEnriching = (phase === 'enriching' || phase === 'profile_scrape' || phase === 'deep_scraping' || phase === 'lastname_lookup') && total > 0;

  const recentFound = foundProfessors.slice(-8);

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-[#1a73e8]/20 bg-gradient-to-br from-blue-50/80 to-white dark:from-neutral-900 dark:to-neutral-900 p-5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl ${phaseConfig.color} flex items-center justify-center shadow-md`}>
            <Icon className={`w-5 h-5 text-white ${phase !== 'discovered' ? 'animate-pulse' : ''}`} />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{phaseConfig.label}</p>
            {isEnriching ? (
              <p className="text-xs text-[#1a73e8] font-bold mt-0.5 tabular-nums">
                {progress.label || `${current} / ${total} profiles scraped`}
              </p>
            ) : (
              <p className="text-xs text-gray-500 mt-0.5">{progress.label || (phase === 'discovering' ? 'Finding all emails on the page…' : phaseConfig.label)}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {pct != null && (
            <div className="text-right">
              <p className="text-2xl font-bold text-[#1a73e8] tabular-nums">{pct}%</p>
              <p className="text-[10px] text-muted uppercase tracking-wide">complete</p>
            </div>
          )}
          {onStop && (
            <button onClick={onStop} className="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 flex items-center justify-center transition-colors" title="Stop import">
              <Square className="w-3.5 h-3.5 text-red-500 fill-red-500" />
            </button>
          )}
        </div>
      </div>

      {total > 0 && (
        <div className="relative h-3 bg-gray-200/80 dark:bg-neutral-700 rounded-full overflow-hidden mb-3">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#1a73e8] to-[#4285f4]"
            initial={{ width: 0 }}
            animate={{ width: `${pct || (phase === 'discovering' ? 5 : 0)}%` }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          />
          {isEnriching && (
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
          )}
        </div>
      )}

      {/* Live feed of found professors */}
      {recentFound.length > 0 && (
        <div className="mb-3 max-h-[140px] overflow-y-auto rounded-lg bg-white/60 dark:bg-neutral-800/60 border border-gray-100 dark:border-neutral-700 px-3 py-2">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5 font-semibold">Found ({foundProfessors.length})</p>
          <AnimatePresence initial={false}>
            {recentFound.map((prof, i) => (
              <motion.div
                key={prof.email || i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2 py-0.5 text-[11px]"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span className="text-gray-700 dark:text-gray-300 font-medium truncate">{prof.name || prof.email}</span>
                {prof.name && <span className="text-gray-400 truncate">{prof.email}</span>}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        {progress.email && (
          <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 text-gray-600 dark:text-gray-300 truncate max-w-md">
            <span className="text-gray-400">Now: </span>{progress.name || progress.email}
          </span>
        )}
        {(progress.added > 0 || progress.skipped > 0) && (
          <>
            <span className="flex items-center gap-1 text-emerald-600 font-medium"><CheckCircle2 className="w-3 h-3" />{progress.added || 0} queued</span>
            <span className="flex items-center gap-1 text-gray-500"><SkipForward className="w-3 h-3" />{progress.skipped || 0} skipped</span>
          </>
        )}
        {phase === 'discovering' && !total && (
          <span className="flex items-center gap-1.5 text-gray-500"><Loader2 className="w-3 h-3 animate-spin" />This may take 1–2 min for large pages</span>
        )}
      </div>
    </motion.div>
  );
}
