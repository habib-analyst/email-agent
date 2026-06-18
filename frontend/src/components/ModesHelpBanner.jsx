import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';

const MODES = [
  {
    id: 'instant',
    title: 'Instant (Normal)',
    color: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    body: 'Full personalization: research → last name, subject [Keyword], and 3 interest keywords. Sends immediately.',
  },
  {
    id: 'basic_instant',
    title: 'Basic Instant',
    color: 'text-teal-700 bg-teal-50 border-teal-200',
    body: 'Last name only (+ optional subject keyword). No interest line. Separate queue and template.',
  },
  {
    id: 'scheduled',
    title: 'Scheduled (Normal)',
    color: 'text-violet-700 bg-violet-50 border-violet-200',
    body: 'Same as Instant but drafts wait until your scheduled time. Pre-send verification before Gmail send.',
  },
  {
    id: 'basic_scheduled',
    title: 'Basic Scheduled',
    color: 'text-indigo-700 bg-indigo-50 border-indigo-200',
    body: 'Basic rules + scheduling. Last name mandatory; optional keyword; no interest line. Separate template DB.',
  },
];

export default function ModesHelpBanner({ highlight, className = '' }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`rounded-xl border border-gray-200 dark:border-neutral-700 overflow-hidden ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-neutral-800/50 hover:bg-gray-100 dark:hover:bg-neutral-800 text-left transition-colors"
      >
        <Info className="w-4 h-4 text-brand-500 shrink-0" />
        <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex-1">Which mode should I use?</span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && (
        <div className="p-3 space-y-2 bg-white dark:bg-neutral-900 border-t border-gray-100 dark:border-neutral-800">
          {MODES.map(m => (
            <div
              key={m.id}
              className={`p-2.5 rounded-lg border text-[11px] ${m.color} dark:bg-opacity-10 ${
                highlight === m.id ? 'ring-2 ring-brand-400' : ''
              }`}
            >
              <p className="font-semibold">{m.title}{highlight === m.id ? ' (current)' : ''}</p>
              <p className="mt-0.5 opacity-90">{m.body}</p>
            </div>
          ))}
          <p className="text-[10px] text-gray-500 pt-1 border-t border-gray-100 dark:border-neutral-800">
            Permanent archive (Settings) remembers all sends across resets — used for duplicate detection.
          </p>
        </div>
      )}
    </div>
  );
}
