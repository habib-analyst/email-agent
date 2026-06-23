import React from 'react';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import useGmailAuth from '../hooks/useGmailAuth.js';

/**
 * First-run checklist — Gmail → import → template → send.
 */
export default function OnboardingChecklist({
  hasQueue = false,
  hasTemplate = false,
  hasSent = false,
  modeLabel = 'Instant',
  className = '',
  actions = {},
}) {
  const { isConnected } = useGmailAuth();

  const steps = [
    { id: 'gmail', label: 'Connect Gmail', done: isConnected },
    { id: 'import', label: `Import professors (${modeLabel})`, done: hasQueue },
    { id: 'template', label: 'Review email template', done: hasTemplate },
    { id: 'send', label: 'Send first email', done: hasSent },
  ];

  const doneCount = steps.filter(s => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <div className={`rounded-2xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4 border-l-[3px] border-l-brand-500 dark:border-l-brand-400 shadow-sm ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-xs font-semibold text-gray-900 dark:text-neutral-100">Getting started</p>
        <span className="text-[10px] text-muted tabular-nums">{doneCount}/{steps.length}</span>
      </div>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2.5 text-xs">
            {s.done ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : i === doneCount ? (
              <Loader2 className="w-4 h-4 text-brand-500 animate-spin shrink-0" />
            ) : (
              <Circle className="w-4 h-4 text-gray-300 dark:text-neutral-600 shrink-0" />
            )}
            <button
              type="button"
              onClick={actions[s.id]}
              disabled={!actions[s.id]}
              className={`${s.done ? 'text-muted line-through' : 'text-gray-800 dark:text-neutral-200 font-medium'} text-left disabled:cursor-default ${actions[s.id] ? 'hover:text-brand-600' : ''}`}
            >
              {s.label}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
