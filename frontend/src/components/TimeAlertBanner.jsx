import React, { useState, useEffect } from 'react';
import { AlertTriangle, Clock, CheckCircle2, Moon } from 'lucide-react';
import { useTimezone } from '../context/TimezoneContext.jsx';
import { TIMEZONE_COUNTRIES, PK_TZ, classifyTimeInZone, TIME_CLASS_LABELS, getHourInZone, getTimeInZone } from '../data/timezones.js';

/**
 * Shows a timing warning banner based on selected timezone countries.
 * Used in both Instant and Scheduled mode import cards.
 * - Green: all selected countries in business hours
 * - Amber: some countries in off hours
 * - Red: any country in sleep hours
 */
export default function TimeAlertBanner() {
  const { selectedCountries } = useTimezone();
  const [tick, setTick] = useState(0);

  // Re-evaluate every 60s
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  if (selectedCountries.length === 0) {
    return (
      <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border bg-blue-50 dark:bg-neutral-800 border-blue-200 dark:border-neutral-700">
        <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
        <div className="text-[11px] text-blue-800 dark:text-blue-200">
          <p className="font-semibold">Tip: set professor timezones</p>
          <p className="mt-0.5 opacity-90">Use the time bar in the header to pick USA, China, UK, etc. You’ll get send-time warnings on this page.</p>
        </div>
      </div>
    );
  }

  const activeCountries = TIMEZONE_COUNTRIES.filter(c => selectedCountries.includes(c.id));
  const classifications = activeCountries.map(c => ({ ...c, cls: classifyTimeInZone(c.tz), hour: getHourInZone(c.tz) }));

  const sleepCountries = classifications.filter(c => c.cls === 'sleep');
  const offCountries = classifications.filter(c => c.cls === 'off');
  const businessCountries = classifications.filter(c => c.cls === 'business');

  // Determine overall severity
  const severity = sleepCountries.length > 0 ? 'sleep' : offCountries.length > 0 ? 'off' : 'business';

  const styles = {
    business: {
      bg: 'bg-emerald-50 dark:bg-neutral-800',
      border: 'border-emerald-200 dark:border-emerald-800',
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />,
      text: 'text-emerald-700 dark:text-emerald-400',
      label: 'All targets in business hours — ideal time to send',
    },
    off: {
      bg: 'bg-amber-50 dark:bg-amber-900/20',
      border: 'border-amber-200 dark:border-amber-800',
      icon: <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
      text: 'text-amber-700 dark:text-amber-400',
      label: 'Some targets in off hours — emails may be seen later',
    },
    sleep: {
      bg: 'bg-red-50 dark:bg-red-900/20',
      border: 'border-red-200 dark:border-red-800',
      icon: <Moon className="w-4 h-4 text-red-600 dark:text-red-400" />,
      text: 'text-red-700 dark:text-red-400',
      label: 'Targets in sleep hours — recommend scheduling for business hours',
    },
  };

  const s = styles[severity];

  return (
    <div className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border ${s.bg} ${s.border}`}>
      <div className="mt-0.5">{s.icon}</div>
      <div className="flex-1 min-w-0">
        <div className={`text-xs font-semibold ${s.text}`}>{s.label}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {sleepCountries.map(c => (
            <span key={c.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-[10px] font-medium">
              {c.flag} {c.label} <span className="tabular-nums">{getTimeInZone(c.tz, 'time')}</span> ❌
            </span>
          ))}
          {offCountries.map(c => (
            <span key={c.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-medium">
              {c.flag} {c.label} <span className="tabular-nums">{getTimeInZone(c.tz, 'time')}</span> ⚠️
            </span>
          ))}
          {businessCountries.map(c => (
            <span key={c.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-neutral-800 text-emerald-700 dark:text-emerald-400 text-[10px] font-medium">
              {c.flag} {c.label} <span className="tabular-nums">{getTimeInZone(c.tz, 'time')}</span> ✅
            </span>
          ))}
        </div>
        {severity === 'sleep' && (
          <div className="mt-1.5 text-[10px] text-red-600 dark:text-red-400">
            💡 Suggested send window: {sleepCountries.map(c => {
              // 8 AM in their timezone → what time in PK?
              const pkHour = getHourInZone(PK_TZ);
              const targetH = getHourInZone(c.tz);
              const diff = pkHour - targetH;
              const pk8am = 8 + diff;  // rough estimate
              const startPK = pk8am > 24 ? pk8am - 24 : pk8am < 0 ? pk8am + 24 : pk8am;
              const endPK = startPK + 9;  // business hours = 8-17 = 9h window
              return `${c.flag} ${startPK % 12 || 12}${startPK >= 12 ? 'PM' : 'AM'}–${endPK % 12 || 12}${endPK >= 12 ? 'PM' : 'AM'} PK`;
            }).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}
