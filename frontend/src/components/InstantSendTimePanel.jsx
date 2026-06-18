import React, { useEffect, useState } from 'react';
import { Clock, Globe } from 'lucide-react';
import ScheduleTimezonePanel from './ScheduleTimezonePanel.jsx';
import TimeAlertBanner from './TimeAlertBanner.jsx';
import SectionShell from './layout/SectionShell.jsx';
import { PK_TZ, getTimeInZone, classifyTimeInZone, TIME_CLASS_LABELS } from '../data/timezones.js';
import { suggestNextBusinessSendUtc } from '../utils/scheduleTime.js';
import { useTimezone } from '../context/TimezoneContext.jsx';

function formatPkWhen(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString('en-PK', {
    timeZone: PK_TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export default function InstantSendTimePanel({ className = '', embedded = false }) {
  const { selectedCountries } = useTimezone();
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const pkCls = classifyTimeInZone(PK_TZ);
  const pkMeta = TIME_CLASS_LABELS[pkCls];
  const nextGood = selectedCountries.length > 0 ? suggestNextBusinessSendUtc(selectedCountries) : null;
  const nextGoodLabel = formatPkWhen(nextGood?.toISOString?.());

  const pkBadge = (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 shrink-0">
      <span className="text-base leading-none">🇵🇰</span>
      <div>
        <div className="text-[10px] font-medium text-emerald-700/80 dark:text-emerald-400/80">Your time (PK)</div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold tabular-nums text-emerald-800 dark:text-emerald-300">{getTimeInZone(PK_TZ, 'time')}</span>
          <span className="text-[10px]">{pkMeta.icon}</span>
          <span className={`text-[10px] font-medium ${pkMeta.textClass}`}>{pkMeta.label}</span>
        </div>
      </div>
    </div>
  );

  const body = (
    <div className="space-y-3">
      <ScheduleTimezonePanel variant="instant" />
      <TimeAlertBanner />
      {selectedCountries.length > 0 && nextGoodLabel && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[rgb(var(--surface-muted))]/50 border border-[rgb(var(--border-subtle))]">
          <Clock className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 mt-0.5 shrink-0" />
          <p className="text-[10px] text-sky-800 dark:text-sky-200">
            If you wait for business hours everywhere: next 9 AM window in your timezone is{' '}
            <span className="font-semibold tabular-nums">{nextGoodLabel}</span>.
            Switch to Scheduled mode to queue sends for that time.
          </p>
        </div>
      )}
    </div>
  );

  if (embedded) {
    return (
      <SectionShell
        className={className}
        icon={Globe}
        title="Send time advisor"
        subtitle="Check professor time zones before you import or send"
        actions={pkBadge}
        collapsible
        defaultOpen
        bodyClassName="p-4"
      >
        {body}
      </SectionShell>
    );
  }

  return (
    <SectionShell
      className={className}
      icon={Globe}
      title="Send time advisor"
      subtitle="Check professor time zones before you import or send — green means now is a good time"
      actions={pkBadge}
      collapsible
      defaultOpen
      bodyClassName="p-4"
    >
      {body}
    </SectionShell>
  );
}
