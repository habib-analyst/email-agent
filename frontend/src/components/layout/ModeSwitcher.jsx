import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Zap, Minimize2, Clock } from 'lucide-react';

const MODES = [
  {
    id: 'instant',
    path: '/instant',
    label: 'Instant',
    short: 'Full',
    icon: Zap,
    desc: 'Research + personalize',
  },
  {
    id: 'basic_instant',
    path: '/basic-instant',
    label: 'Basic',
    short: 'Basic',
    icon: Minimize2,
    desc: 'Fast, last-name only',
  },
  {
    id: 'scheduled',
    path: '/scheduled',
    label: 'Scheduled',
    short: 'Plan',
    icon: Clock,
    desc: 'Queue for later',
  },
];

export default function ModeSwitcher({ className = '' }) {
  const location = useLocation();
  const navigate = useNavigate();

  const current =
    location.pathname === '/scheduled' ? 'scheduled'
      : location.pathname === '/basic-instant' ? 'basic_instant'
        : location.pathname === '/instant' ? 'instant'
          : null;

  return (
    <nav
      className={`inline-flex p-1 rounded-xl bg-[rgb(var(--surface-muted))] border border-[rgb(var(--border-subtle))] shadow-inner ${className}`}
      aria-label="Outreach mode"
    >
      {MODES.map(({ id, path, label, short, icon: Icon }) => {
        const active = current === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => navigate(path)}
            className={`relative flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              active
                ? 'bg-[rgb(var(--surface-card))] text-[rgb(var(--text-primary))] shadow-sm ring-1 ring-[rgb(var(--border-default))]'
                : 'text-muted hover:text-[rgb(var(--text-primary))]'
            }`}
          >
            <Icon className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-brand-500' : ''}`} />
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{short}</span>
            {active && (
              <span className="absolute -bottom-px left-3 right-3 h-0.5 rounded-full bg-brand-500" aria-hidden />
            )}
          </button>
        );
      })}
    </nav>
  );
}
