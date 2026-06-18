import React from 'react';
import { UserX } from 'lucide-react';

export const SKIP_DESIGNATION_OPTIONS = [
  { id: 'lecturer', label: 'Lecturer' },
  { id: 'instructor', label: 'Instructor' },
  { id: 'adjunct', label: 'Adjunct' },
  { id: 'administration', label: 'Administration' },
  { id: 'coordinator', label: 'Coordinator' },
  { id: 'advisor', label: 'Advisor' },
  { id: 'staff', label: 'Staff (non-faculty)' },
  { id: 'emeritus', label: 'Emeritus / Emerita' },
  { id: 'visiting', label: 'Visiting' },
];

export default function DesignationSkipFilter({ value = [], onChange, className = '' }) {
  const toggle = (id) => {
    if (value.includes(id)) onChange(value.filter(x => x !== id));
    else onChange([...value, id]);
  };

  return (
    <div className={`rounded-xl border border-gray-200 dark:border-neutral-700 bg-gray-50/80 dark:bg-neutral-800/40 p-3 ${className}`}>
      <div className="flex items-center gap-2 mb-2">
        <UserX className="w-4 h-4 text-muted shrink-0" />
        <div>
          <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">Skip designations</p>
          <p className="text-[10px] text-muted">Multi-select roles to exclude from URL import (e.g. Lecturer, Administration)</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SKIP_DESIGNATION_OPTIONS.map(opt => {
          const on = value.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => toggle(opt.id)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium border transition-colors ${
                on
                  ? 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200'
                  : 'bg-white dark:bg-neutral-900 border-gray-200 dark:border-neutral-600 text-muted hover:border-gray-300'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
