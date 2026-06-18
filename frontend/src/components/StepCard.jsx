import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

const STEP_COLORS = {
  1: 'from-blue-500 to-blue-600',
  2: 'from-emerald-500 to-emerald-600',
  3: 'from-violet-500 to-violet-600',
  4: 'from-orange-500 to-orange-600',
  5: 'from-teal-500 to-teal-600',
};

const STEP_BORDER_COLORS = {
  1: 'border-l-blue-500 dark:border-l-blue-400',
  2: 'border-l-emerald-500 dark:border-l-emerald-400',
  3: 'border-l-violet-500 dark:border-l-violet-400',
  4: 'border-l-orange-500 dark:border-l-orange-400',
  5: 'border-l-teal-500 dark:border-l-teal-400',
};

export default function StepCard({ step, title, subtitle, icon: Icon, active, done, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  const toggleOpen = () => setOpen(v => !v);
  const onHeaderKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleOpen();
    }
  };

  const borderColor = active
    ? STEP_BORDER_COLORS[step] || STEP_BORDER_COLORS[1]
    : done
      ? 'border-l-emerald-500 dark:border-l-emerald-400'
      : 'border-l-gray-300 dark:border-l-gray-600';

  return (
    <div className={`panel border-l-[3px] ${borderColor} overflow-hidden`}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        className="flex items-center gap-3 cursor-pointer select-none px-4 py-3.5 bg-[rgb(var(--surface-muted))]/40 border-b border-[rgb(var(--border-subtle))] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        onClick={toggleOpen}
        onKeyDown={onHeaderKeyDown}
      >
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${STEP_COLORS[step] || STEP_COLORS[1]} flex items-center justify-center text-white text-sm font-bold shadow-sm`}>
          {done ? '✓' : step}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm text-[rgb(var(--text-primary))] flex items-center gap-2">
            {title}
            {active && <span className="text-[10px] font-semibold bg-brand-500/15 text-brand-700 dark:text-brand-300 px-1.5 py-0.5 rounded-md">Active</span>}
            {done && <span className="text-[10px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded-md">Done</span>}
          </h3>
          {subtitle && <p className="text-[11px] text-muted mt-0.5">{subtitle}</p>}
        </div>
        {Icon && <Icon className="w-5 h-5 text-muted" />}
        <span className="p-1 pointer-events-none" aria-hidden="true">
          {open ? <ChevronUp className="w-4 h-4 text-muted" /> : <ChevronDown className="w-4 h-4 text-muted" />}
        </span>
      </div>
      {open && <div className="px-4 pb-4 pt-4 space-y-4 bg-[rgb(var(--surface-card))]">{children}</div>}
    </div>
  );
}
