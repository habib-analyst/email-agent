import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Unified section panel — consistent header + body for workflow pages.
 */
export default function SectionShell({
  icon: Icon,
  title,
  subtitle,
  badge,
  actions,
  children,
  className = '',
  bodyClassName = 'p-4',
  noPadding = false,
  collapsible = false,
  defaultOpen = true,
  openSignal = 0,
}) {
  const [open, setOpen] = useState(defaultOpen);
  React.useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);

  const toggle = () => {
    if (collapsible) setOpen(v => !v);
  };

  return (
    <section className={`panel overflow-hidden transition-shadow duration-200 hover:shadow-md ${className}`}>
      {(title || subtitle) && (
        <div
          className={`panel-header bg-gradient-to-r from-[rgb(var(--surface-muted))]/55 via-[rgb(var(--surface-card))] to-[rgb(var(--surface-card))] ${collapsible ? 'cursor-pointer select-none hover:bg-[rgb(var(--surface-muted))]/60 transition-colors' : ''}`}
          onClick={collapsible ? toggle : undefined}
          onKeyDown={collapsible ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          } : undefined}
          role={collapsible ? 'button' : undefined}
          tabIndex={collapsible ? 0 : undefined}
          aria-expanded={collapsible ? open : undefined}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {Icon && (
              <div className="w-8 h-8 rounded-lg bg-brand-500/12 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-brand-500" />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-[rgb(var(--text-primary))]">{title}</h2>
                {badge}
              </div>
              {subtitle && <p className="text-[11px] text-muted mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0" onClick={e => collapsible && e.stopPropagation()}>
            {actions}
            {collapsible && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted px-2 py-1 rounded-lg border border-[rgb(var(--border-subtle))]">
                {open ? 'Collapse' : 'Expand'}
                {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </span>
            )}
          </div>
        </div>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className={noPadding ? '' : bodyClassName}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
