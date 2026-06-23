import React from 'react';
import { Activity } from 'lucide-react';
import LiveFeed from '../LiveFeed.jsx';
import SectionShell from './SectionShell.jsx';

export default function LiveActivitySection({ events, connected, className = '', openSignal = 0 }) {
  return (
    <SectionShell
      className={className}
      icon={Activity}
      title="Live activity"
      subtitle="Real-time event stream from the agent"
      badge={
        <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
          connected
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
            : 'bg-red-500/15 text-red-600 dark:text-red-400'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
          {connected ? 'Live' : 'Offline'}
        </span>
      }
      bodyClassName="p-0"
      noPadding
      collapsible
      defaultOpen
      openSignal={openSignal}
    >
      <LiveFeed events={events} connected={connected} embedded />
    </SectionShell>
  );
}
