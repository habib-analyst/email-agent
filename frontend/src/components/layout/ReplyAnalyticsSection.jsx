import React, { useEffect, useState } from 'react';
import { Loader2, MessageSquare, RefreshCw } from 'lucide-react';
import ReplyHub from '../ReplyHub.jsx';
import SectionShell from './SectionShell.jsx';
import { post } from '../../api.js';
import { useToast } from '../Toast.jsx';
import { useEventStream } from '../../core/EventStreamProvider.jsx';

export default function ReplyAnalyticsSection({ replies, onRefresh, className = '', filter = 'all', onClearFilter, openSignal = 0 }) {
  const count = replies?.length ?? 0;
  const [scanning, setScanning] = useState(false);
  const toast = useToast();
  const { subscribe } = useEventStream();

  useEffect(() => subscribe(event => {
    if (['reply_updated', 'reply_scan_complete', 'reply_scenarios_updated'].includes(event.type)) {
      onRefresh?.();
    }
  }), [onRefresh, subscribe]);

  const scanReplies = async () => {
    setScanning(true);
    try {
      const result = await post('/replies/scan', { maxResults: 500 }, { timeout: 180000 });
      toast.success(result.imported
        ? `${result.imported} new ${result.imported === 1 ? 'reply' : 'replies'} scanned, saved, and analyzed`
        : 'Inbox scan complete - no new replies');
      await onRefresh?.();
    } catch (error) {
      toast.error(error.message || 'Could not scan Gmail replies');
    } finally {
      setScanning(false);
    }
  };

  return (
    <SectionShell
      className={className}
      icon={MessageSquare}
      title="Reply analytics"
      subtitle="Classification, follow-ups, and reply performance"
      badge={count > 0 ? (
        <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-brand-500/15 text-brand-700 dark:text-brand-300">
          {count} replies
        </span>
      ) : null}
      actions={(
        <button
          type="button"
          onClick={scanReplies}
          disabled={scanning}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[rgb(var(--border-subtle))] text-[11px] font-semibold text-[rgb(var(--text-primary))] hover:bg-[rgb(var(--surface-muted))] disabled:opacity-50"
        >
          {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Scan Gmail
        </button>
      )}
      bodyClassName="p-0"
      noPadding
      collapsible
      defaultOpen
      openSignal={openSignal}
    >
      <ReplyHub replies={replies} onRefresh={onRefresh} embedded filter={filter} onClearFilter={onClearFilter} />
    </SectionShell>
  );
}
