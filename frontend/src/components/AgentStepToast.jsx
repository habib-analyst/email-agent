import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Edit3, ShieldCheck, Send, Zap, Activity, AlertTriangle, Cpu } from 'lucide-react';

const STAGE_META = {
  starting: { icon: Zap, color: 'text-violet-600', bg: 'bg-violet-600' },
  researching: { icon: Search, color: 'text-blue-600', bg: 'bg-blue-600' },
  drafted: { icon: Edit3, color: 'text-purple-600', bg: 'bg-purple-600' },
  verified: { icon: ShieldCheck, color: 'text-indigo-600', bg: 'bg-indigo-600' },
  sending: { icon: Send, color: 'text-emerald-600', bg: 'bg-emerald-600' },
  sent: { icon: Send, color: 'text-emerald-600', bg: 'bg-emerald-600' },
  error: { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-600' },
};

function TokenBadge({ tokens }) {
  if (!tokens || typeof tokens !== 'object') return null;
  const total = Object.values(tokens).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
  if (total === 0) return null;
  const display = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : total;
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-neutral-800 text-[9px] font-medium text-muted ml-2">
      <Cpu className="w-3 h-3" /> {display}
    </span>
  );
}

export default function AgentStepToast({ toast }) {
  const meta = STAGE_META[toast?.stage] || { icon: Activity, color: 'text-gray-600', bg: 'bg-[#1a73e8]' };
  const Icon = meta.icon;

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={`${toast.stage}-${toast.professor}-${toast.at}`}
          initial={{ opacity: 0, y: -12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8 }}
          className="fixed top-[72px] left-3 right-3 sm:left-auto sm:right-5 z-50 max-w-[min(100%,24rem)] sm:max-w-sm"
        >
          <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 shadow-xl shadow-black/10">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${meta.bg}`}>
              <Icon className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0 pt-0.5">
              <div className="flex items-center">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{toast.stage === 'error' ? 'Error' : 'Agent step'}</p>
                <TokenBadge tokens={toast.tokens} />
              </div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">{toast.label}</p>
              {toast.professor && (
                <p className="text-[11px] text-muted truncate mt-1">{toast.professor}</p>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
