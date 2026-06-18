import React from 'react';
import { Archive, Info } from 'lucide-react';

/** Explains reset vs permanent archive — show near reset buttons. */
export default function ResetNotice({ scope = 'this mode', className = '' }) {
  return (
    <p className={`flex items-start gap-1.5 text-[10px] text-muted ${className}`}>
      <Info className="w-3 h-3 shrink-0 mt-0.5" />
      <span>
        <strong>Start new task</strong> clears queue, roster, and templates for {scope} only.
        Analytics (send stats, replies, topics) and
        <Archive className="w-3 h-3 inline mx-0.5 align-text-bottom" />
        permanent archive are kept — duplicates still detected after reset.
      </span>
    </p>
  );
}
