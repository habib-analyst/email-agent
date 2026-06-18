import React, { useState, useEffect } from 'react';
import { Globe, Check, X, ChevronUp, ChevronDown, Plus } from 'lucide-react';
import { TIMEZONE_COUNTRIES, PK_TZ, getTimeInZone, getUTCOffset, classifyTimeInZone, TIME_CLASS_LABELS } from '../data/timezones.js';
import { useTimezone } from '../context/TimezoneContext.jsx';

const QUICK_PICKS = [
  { ids: ['us-east'], label: '🇺🇸 East' },
  { ids: ['us-west'], label: '🇺🇸 West' },
  { ids: ['china'], label: '🇨🇳 China' },
  { ids: ['uk'], label: '🇬🇧 UK' },
  { ids: ['germany'], label: '🇩🇪 Germany' },
  { ids: ['japan'], label: '🇯🇵 Japan' },
  { ids: ['australia'], label: '🇦🇺 AU' },
];

function ClockChip({ flag, label, tz, onRemove }) {
  const cls = classifyTimeInZone(tz);
  const clsInfo = TIME_CLASS_LABELS[cls];
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/90 dark:bg-neutral-900/90 border border-gray-200 dark:border-neutral-600 shadow-sm shrink-0">
      <span className="text-sm leading-none">{flag}</span>
      <div className="flex flex-col leading-tight min-w-0">
        <span className="text-[10px] font-semibold text-gray-700 dark:text-gray-200 truncate max-w-[6rem] sm:max-w-none">{label}</span>
        <span className="text-[9px] text-muted tabular-nums">{getTimeInZone(tz, 'date')}</span>
        <div className="flex items-center gap-1">
          <span className={`text-xs font-bold tabular-nums ${
            cls === 'business' ? 'text-emerald-700 dark:text-emerald-300' :
            cls === 'off' ? 'text-amber-700 dark:text-amber-300' :
            'text-red-700 dark:text-red-300'
          }`}>{getTimeInZone(tz, 'time')}</span>
          <span className="text-[10px]" title={clsInfo.label}>{clsInfo.icon}</span>
        </div>
      </div>
      {onRemove && (
        <button type="button" onClick={onRemove} className="p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-muted hover:text-red-600" aria-label={`Remove ${label}`}>
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function CountryPickerGrid({ selectedCountries, toggleCountry, setSelectedCountries }) {
  const regions = [
    { label: 'Americas', ids: ['us-east', 'us-central', 'us-west', 'canada'] },
    { label: 'Europe', ids: ['uk', 'germany', 'france', 'netherlands', 'switzerland', 'sweden', 'italy', 'spain', 'austria', 'ireland', 'finland'] },
    { label: 'Asia', ids: ['china', 'japan', 'south-korea', 'singapore', 'malaysia', 'hong-kong', 'taiwan'] },
    { label: 'Oceania', ids: ['australia', 'new-zealand'] },
  ];

  return (
    <div className="w-full max-w-4xl mx-auto rounded-xl border border-sky-200 dark:border-neutral-700 bg-white/95 dark:bg-neutral-900/95 shadow-sm p-3">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Globe className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
          <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">Add professor regions — select as many as you need</span>
        </div>
        {selectedCountries.length > 0 && (
          <button type="button" onClick={() => setSelectedCountries([])} className="text-[10px] font-semibold text-violet-700 dark:text-violet-300 hover:underline">
            Clear all ({selectedCountries.length})
          </button>
        )}
      </div>

      <p className="text-[10px] text-gray-600 dark:text-gray-300 mb-2.5 text-center">
        Tap to add/remove · each selection appears in the clock bar above · ✅ Business 8–5 · ⚠️ Off · ❌ Sleep
      </p>

      {regions.map(region => (
        <div key={region.label} className="mb-2.5 last:mb-0">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1 text-center">{region.label}</div>
          <div className="flex flex-wrap gap-1 justify-center">
            {TIMEZONE_COUNTRIES.filter(c => region.ids.includes(c.id)).map(c => {
              const isSel = selectedCountries.includes(c.id);
              const cls = classifyTimeInZone(c.tz);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCountry(c.id)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium border transition-colors ${
                    isSel
                      ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                      : 'bg-gray-50 dark:bg-neutral-800 border-gray-200 dark:border-neutral-600 text-gray-700 dark:text-gray-200 hover:border-sky-400 dark:hover:border-sky-500'
                  }`}
                  title={c.note}
                >
                  <span>{c.flag}</span>
                  <span>{c.label}</span>
                  <span className={`tabular-nums ${isSel ? 'text-sky-100' : cls === 'business' ? 'text-emerald-700 dark:text-emerald-300' : cls === 'off' ? 'text-amber-700 dark:text-amber-300' : 'text-red-700 dark:text-red-300'}`}>
                    {getTimeInZone(c.tz, 'time')}
                  </span>
                  <span className="opacity-75">{getUTCOffset(c.tz)}</span>
                  {isSel && <Check className="w-2.5 h-2.5" />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TimeManagement() {
  const { selectedCountries, setSelectedCountries } = useTimezone();
  const [expanded, setExpanded] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const toggleCountry = (id) => {
    setSelectedCountries(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  /** Add quick-pick regions without clearing existing selections */
  const addQuickPick = (ids) => {
    setSelectedCountries(prev => [...new Set([...prev, ...ids])]);
  };

  const activeCountries = TIMEZONE_COUNTRIES.filter(c => selectedCountries.includes(c.id));
  const pkCls = classifyTimeInZone(PK_TZ);
  const pkInfo = TIME_CLASS_LABELS[pkCls];

  return (
    <div className="w-full min-w-0 flex flex-col items-center gap-2">
      {/* Live clocks — centered, scroll horizontally when many selected */}
      <div className="header-scroll-x w-full flex justify-center">
        <div className="inline-flex items-center gap-2 min-w-max px-1 pb-0.5">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 shrink-0">
            <span className="text-sm">🇵🇰</span>
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] font-semibold text-emerald-800 dark:text-emerald-200">Pakistan</span>
              <span className="text-[9px] text-emerald-700/80 dark:text-emerald-300/80 tabular-nums">{getTimeInZone(PK_TZ, 'date')}</span>
              <div className="flex items-center gap-1">
                <span className="text-xs font-bold tabular-nums text-emerald-900 dark:text-emerald-100">{getTimeInZone(PK_TZ, 'time')}</span>
                <span className="text-[10px]">{pkInfo.icon}</span>
              </div>
            </div>
          </div>

          {activeCountries.map(c => (
            <ClockChip
              key={c.id}
              flag={c.flag}
              label={c.label}
              tz={c.tz}
              onRemove={() => toggleCountry(c.id)}
            />
          ))}

          {activeCountries.length === 0 && (
            <span className="text-[11px] text-gray-600 dark:text-gray-300 px-2 shrink-0 text-center">
              Select regions below — multiple clocks will appear here
            </span>
          )}

          {activeCountries.length > 0 && (
            <span className="text-[10px] font-semibold text-sky-700 dark:text-sky-300 px-1.5 py-1 rounded-md bg-sky-100/80 dark:bg-neutral-800 shrink-0">
              {activeCountries.length} active
            </span>
          )}
        </div>
      </div>

      {/* Quick picks — centered, additive (keeps existing selections) */}
      <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-4xl mx-auto">
        <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-300 shrink-0 flex items-center gap-0.5">
          <Plus className="w-3 h-3" /> Quick add:
        </span>
        {QUICK_PICKS.map(({ ids, label }) => {
          const allAdded = ids.every(id => selectedCountries.includes(id));
          return (
            <button
              key={label}
              type="button"
              onClick={() => addQuickPick(ids)}
              className={`text-[10px] font-semibold px-2 py-1 rounded-md border transition-colors ${
                allAdded
                  ? 'bg-sky-600 text-white border-sky-600'
                  : 'bg-white/80 dark:bg-neutral-900/80 border-gray-200 dark:border-neutral-600 text-gray-800 dark:text-gray-100 hover:bg-sky-50 dark:hover:bg-neutral-800 hover:border-sky-300 dark:hover:border-sky-600'
              }`}
              title="Adds to your clock bar (keeps existing selections)"
            >
              {label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-2.5 py-1 rounded-md bg-sky-600 hover:bg-sky-700 text-white"
        >
          <Globe className="w-3 h-3" />
          {expanded ? 'Hide all regions' : 'All regions'}
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {expanded && (
        <CountryPickerGrid
          selectedCountries={selectedCountries}
          toggleCountry={toggleCountry}
          setSelectedCountries={setSelectedCountries}
        />
      )}
    </div>
  );
}
