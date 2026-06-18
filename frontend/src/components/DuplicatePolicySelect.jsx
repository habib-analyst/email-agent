import React from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';

const POLICIES = [
  { id: 'review_always', label: 'Review duplicates', desc: 'Queue for your decision' },
  { id: 'skip_always', label: 'Skip all duplicates', desc: 'Never re-contact' },
  { id: 'skip_within_days', label: 'Skip if sent recently', desc: 'Allow after cooldown' },
  { id: 'allow_after_days', label: 'Allow after cooldown', desc: 'Block only within N days' },
];

export default function DuplicatePolicySelect({ settings, onChange, saving = false, className = '' }) {
  const policy = settings?.duplicate_policy || 'review_always';
  const days = settings?.duplicate_cooldown_days ?? 30;

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Duplicate handling</p>
        {saving ? (
          <span className="text-[10px] text-muted flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</span>
        ) : (
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Active now</span>
        )}
      </div>
      <p className="text-[10px] text-muted">Changes apply immediately to imports and the worker — no Save needed.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {POLICIES.map(p => (
          <button
            key={p.id}
            type="button"
            disabled={saving}
            onClick={() => onChange?.({ duplicate_policy: p.id })}
            className={`text-left p-2 rounded-lg border text-[11px] transition-colors disabled:opacity-60 ${
              policy === p.id
                ? 'border-brand-400 bg-brand-50 dark:bg-brand-900/20'
                : 'border-gray-200 dark:border-neutral-700 hover:bg-gray-50 dark:hover:bg-neutral-800'
            }`}
          >
            <span className="font-semibold block">{p.label}</span>
            <span className="text-gray-500">{p.desc}</span>
          </button>
        ))}
      </div>
      {(policy === 'skip_within_days' || policy === 'allow_after_days') && (
        <label className="flex items-center gap-2 text-xs">
          Cooldown days
          <input
            type="number"
            min={1}
            max={3650}
            value={days}
            disabled={saving}
            onChange={e => onChange?.({ duplicate_cooldown_days: +e.target.value })}
            onBlur={e => onChange?.({ duplicate_cooldown_days: +e.target.value }, { immediate: true })}
            className="input w-20 text-xs py-1"
          />
        </label>
      )}
    </div>
  );
}
