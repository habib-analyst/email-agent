import { Bot, ChevronDown, ChevronUp, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useWorkflowLayout } from '../context/WorkflowLayoutContext.jsx';

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

export default function StepCard({
  step,
  title,
  subtitle,
  icon: Icon,
  active,
  done,
  owner = 'agent',
  statusLabel,
  actionRequired = false,
  children,
  defaultOpen = false,
  openSignal = 0,
}) {
  const { layout } = useWorkflowLayout();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);
  useEffect(() => {
    setOpen(layout === 'slider');
  }, [layout]);

  const toggleOpen = () => setOpen(value => !value);
  const resolvedOpen = layout === 'slider' ? true : open;
  const borderColor = active
    ? STEP_BORDER_COLORS[step] || STEP_BORDER_COLORS[1]
    : done
      ? 'border-l-emerald-500 dark:border-l-emerald-400'
      : actionRequired
        ? 'border-l-violet-500 dark:border-l-violet-400'
        : 'border-l-gray-300 dark:border-l-gray-600';
  const OwnerIcon = owner === 'user' ? UserRound : Bot;
  const resolvedStatus = statusLabel || (active ? 'Working now' : done ? 'Complete' : actionRequired ? 'Action needed' : 'Ready');

  return (
    <div
      className={`panel group border-l-[3px] ${borderColor} overflow-hidden transition-all duration-200 ${active ? 'shadow-lg shadow-brand-500/5' : ''}`}
      data-testid={`workflow-step-${step}`}
      data-owner={owner}
      data-status={resolvedStatus}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={resolvedOpen}
        className="relative flex items-center gap-3 cursor-pointer select-none px-4 py-4 bg-gradient-to-r from-[rgb(var(--surface-muted))]/70 via-[rgb(var(--surface-card))] to-[rgb(var(--surface-card))] border-b border-[rgb(var(--border-subtle))] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        onClick={toggleOpen}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleOpen();
          }
        }}
      >
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${STEP_COLORS[step] || STEP_COLORS[1]} flex items-center justify-center text-white text-sm font-black shadow-md`}>
          {done ? '✓' : step}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-sm text-[rgb(var(--text-primary))]">{title}</h3>
            <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${
              owner === 'user'
                ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300'
                : 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
            }`}>
              <OwnerIcon className="w-3 h-3" /> {owner === 'user' ? 'Your step' : 'Agent step'}
            </span>
          </div>
          {subtitle && <p className="text-[11px] text-muted mt-1">{subtitle}</p>}
        </div>
        <span className={`hidden sm:inline-flex text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
          actionRequired
            ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
            : active
              ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300'
              : done
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                : 'bg-gray-500/10 text-muted'
        }`}>{resolvedStatus}</span>
        {Icon && <Icon className="w-5 h-5 text-muted group-hover:text-brand-500 transition-colors" />}
        <span className="p-1 pointer-events-none" aria-hidden="true">
          {resolvedOpen ? <ChevronUp className="w-4 h-4 text-muted" /> : <ChevronDown className="w-4 h-4 text-muted" />}
        </span>
      </div>
      {resolvedOpen && <div className="px-4 pb-4 pt-4 space-y-4 bg-[rgb(var(--surface-card))]">{children}</div>}
    </div>
  );
}
