import React from 'react';
import { Globe } from 'lucide-react';
import ScheduleTimezonePanel from './ScheduleTimezonePanel.jsx';
import TimeAlertBanner from './TimeAlertBanner.jsx';
import SectionShell from './layout/SectionShell.jsx';

export default function ScheduledSendTimePanel({ onSuggestTime, className = '', embedded = false }) {
  const body = (
    <div className="space-y-3">
      <ScheduleTimezonePanel onSuggestTime={onSuggestTime} />
      <TimeAlertBanner />
    </div>
  );

  return (
    <SectionShell
      className={className}
      icon={Globe}
      title="Send time advisor"
      subtitle="Professor time zones and smart send-time suggestions for scheduled batches"
      collapsible
      defaultOpen={false}
      bodyClassName="p-4"
    >
      {body}
    </SectionShell>
  );
}
