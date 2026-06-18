import React from 'react';
import { Globe, Search, Edit3, ShieldCheck, Calendar, Send } from 'lucide-react';

const STEPS = [
  { key: 'import', label: 'Import', icon: Globe },
  { key: 'researching', label: 'Research', icon: Search },
  { key: 'drafted', label: 'Draft', icon: Edit3 },
  { key: 'review', label: 'Review', icon: ShieldCheck },
  { key: 'scheduled', label: 'Schedule', icon: Calendar },
  { key: 'sending', label: 'Send', icon: Send },
];

const STATUS_TO_STEP = {
  pending: 'import',
  processing: 'researching',
  drafted: 'review',
  scheduled: 'scheduled',
  sending: 'sending',
  completed: 'completed',
};

export default function ScheduledAgentFlowBar({ batch }) {
  const currentKey = STATUS_TO_STEP[batch.status] || 'import';
  const stepIndex = currentKey === 'completed' ? STEPS.length : STEPS.findIndex(s => s.key === currentKey);

  return (
    <div className="flex items-center gap-0.5 mt-2">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const active = i === stepIndex;
        const done = i < stepIndex;
        return (
          <React.Fragment key={step.key}>
            <div className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-all ${active ? 'bg-[#1a73e8]/10 ring-1 ring-[#1a73e8]/30' : done ? 'bg-emerald-50/60 dark:bg-neutral-800' : 'opacity-40'}`}>
              <Icon className={`w-3 h-3 ${active ? 'text-[#1a73e8]' : done ? 'text-emerald-600' : 'text-gray-400'}`} />
              <span className="text-[8px] font-medium">{step.label}</span>
            </div>
            {i < STEPS.length - 1 && <div className={`h-0.5 flex-1 min-w-[6px] rounded ${done ? 'bg-emerald-400' : 'bg-gray-200 dark:bg-neutral-700'}`} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}
