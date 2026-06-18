import React from 'react';

const DEFAULT_SUBJECT = '[Machine Learning] Seeking an MS/PhD Position in Your Lab';
const FIXED_SUBJECT = 'Seeking an MS/PhD Position in Your Lab';
const SEARCH_SAMPLE = '[Keyword] Seeking an MS/PhD Position in Your Lab';

function ToggleRow({ title, description, enabled, saving, onToggle }) {
  return (
    <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-teal-900 dark:text-teal-100">{title}</p>
        <p className="text-[10px] text-teal-700/90 dark:text-teal-300/90 mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        aria-pressed={enabled}
        disabled={saving}
        onClick={onToggle}
        className={`relative w-10 h-5 rounded-full shrink-0 transition-colors disabled:opacity-60 ${enabled ? 'bg-teal-500' : 'bg-gray-300 dark:bg-neutral-600'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  );
}

export default function BasicSubjectOptions({
  defaultSubjectEnabled,
  searchSubjectEnabled,
  saving,
  onToggleDefault,
  onToggleSearch,
  className = '',
}) {
  return (
    <div className={`p-3 rounded-xl bg-teal-50 dark:bg-neutral-800 border border-teal-200 dark:border-teal-800 space-y-3 ${className}`}>
      <ToggleRow
        title="Default subject"
        description={defaultSubjectEnabled ? `On — all emails use: ${DEFAULT_SUBJECT}` : `Off — fixed subject: ${FIXED_SUBJECT}`}
        enabled={defaultSubjectEnabled}
        saving={saving}
        onToggle={onToggleDefault}
      />
      <div className="border-t border-teal-200/80 dark:border-teal-800/80" />
      <ToggleRow
        title="Search subject keyword"
        description={searchSubjectEnabled
          ? `On — agent finds a keyword per professor, e.g. ${SEARCH_SAMPLE}`
          : 'Off — agent does not research a subject keyword'}
        enabled={searchSubjectEnabled}
        saving={saving}
        onToggle={onToggleSearch}
      />
      {defaultSubjectEnabled && searchSubjectEnabled && (
        <p className="text-[10px] text-amber-700 dark:text-amber-400">Only one subject option can be active — turn one off first.</p>
      )}
    </div>
  );
}

export function basicSubjectModeFromSettings(settings) {
  if (settings?.basic_search_subject_keyword) return 'search';
  if (settings?.basic_subject_keyword) return 'default';
  return 'fixed';
}
