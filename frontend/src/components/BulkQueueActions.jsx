import React, { useState } from 'react';
import { RotateCcw, SkipForward, Play, Loader2 } from 'lucide-react';
import { post } from '../api.js';
import { useToast } from './Toast.jsx';

export default function BulkQueueActions({ mode = 'instant', onRefresh, className = '' }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);

  const act = async (action) => {
    setBusy(action);
    try {
      const res = await post('/queue/bulk', { action, mode });
      toast.success(`${res.affected ?? res.count ?? 0} item(s) updated`);
      onRefresh?.();
    } catch (e) {
      toast.error(e.message || 'Bulk action failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {[
        ['start_all', Play, 'Start all pending', 'emerald'],
        ['retry_failed', RotateCcw, 'Retry failed', 'amber'],
        ['skip_duplicates', SkipForward, 'Skip duplicates', 'gray'],
      ].map(([action, Icon, label, color]) => (
        <button
          key={action}
          type="button"
          disabled={!!busy}
          onClick={() => act(action)}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium border transition-colors
            ${color === 'emerald' ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50' : ''}
            ${color === 'amber' ? 'border-amber-200 text-amber-700 hover:bg-amber-50' : ''}
            ${color === 'gray' ? 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-neutral-700 dark:text-gray-300' : ''}
          `}
        >
          {busy === action ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />}
          {label}
        </button>
      ))}
    </div>
  );
}
