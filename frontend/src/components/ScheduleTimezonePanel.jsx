import React, { useEffect, useState } from 'react';
import { Clock, Globe, Sparkles } from 'lucide-react';
import { useTimezone } from '../context/TimezoneContext.jsx';
import {
  TIMEZONE_COUNTRIES, classifyTimeInZone, TIME_CLASS_LABELS, getTimeInZone, getUTCOffset,
} from '../data/timezones.js';
import { suggestNextBusinessSendUtc } from '../utils/scheduleTime.js';

export default function ScheduleTimezonePanel({ onSuggestTime, variant = 'scheduled' }) {
  const isInstant = variant === 'instant';
  const { selectedCountries, toggleCountry, setSelectedCountries } = useTimezone();
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const quickPick = (ids) => setSelectedCountries(ids);

  const handleSuggest = () => {
    const when = suggestNextBusinessSendUtc(selectedCountries);
    if (when) onSuggestTime?.(when);
  };

  return (
    <div className="space-y-3 p-3 rounded-xl bg-sky-50 dark:bg-neutral-900 border border-sky-200 dark:border-neutral-700">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          <span className="text-xs font-semibold text-sky-900 dark:text-sky-100">
            {isInstant ? 'Send time check — professor time zones' : 'Professor time zones'}
          </span>
        </div>
        <div className="flex gap-1 flex-wrap">
          {[['us-east', 'us-west'], ['china'], ['us-east', 'china'], ['uk', 'germany']].map(([a, b]) => {
            const ids = b ? [a, b] : [a];
            const label = ids.map(id => TIMEZONE_COUNTRIES.find(c => c.id === id)?.flag).join('');
            return (
              <button key={ids.join('-')} type="button" onClick={() => quickPick(ids)}
                className="text-[10px] px-2 py-0.5 rounded-md bg-white dark:bg-neutral-800 border border-sky-200 dark:border-neutral-700 text-sky-800 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-neutral-700">
                {label} Quick
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-[10px] text-sky-800/80 dark:text-sky-300/80">
        {isInstant
          ? 'Pick where your professors are. Live clocks and the verdict below tell you if now is a good time to send (8 AM–5 PM their time).'
          : 'Select countries where your professors are — live local times help you pick a good send window (8 AM–5 PM their time).'}
      </p>

      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
        {TIMEZONE_COUNTRIES.map(c => {
          const on = selectedCountries.includes(c.id);
          const cls = classifyTimeInZone(c.tz);
          const meta = TIME_CLASS_LABELS[cls];
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggleCountry(c.id)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium border transition-colors ${on ? 'bg-sky-600 text-white border-sky-600' : 'bg-white dark:bg-neutral-800 border-gray-200 dark:border-neutral-700 text-gray-700 dark:text-gray-300 hover:border-sky-400'}`}
              title={c.note}
            >
              <span>{c.flag}</span>
              <span>{c.label}</span>
              <span className={`tabular-nums ${on ? 'text-sky-100' : meta.textClass}`}>{getTimeInZone(c.tz, 'time')}</span>
              <span className="opacity-70">{getUTCOffset(c.tz)}</span>
            </button>
          );
        })}
      </div>

      {selectedCountries.length > 0 && (
        <div className="flex items-center justify-between gap-2 flex-wrap pt-1 border-t border-sky-200/60 dark:border-neutral-700/60">
          <span className="text-[10px] text-sky-700 dark:text-sky-300 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {selectedCountries.length} region{selectedCountries.length !== 1 ? 's' : ''} selected
          </span>
          {!isInstant && (
            <button type="button" onClick={handleSuggest}
              className="flex items-center gap-1 text-[10px] font-semibold px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white">
              <Sparkles className="w-3 h-3" /> Suggest 9 AM send time
            </button>
          )}
        </div>
      )}
    </div>
  );
}
