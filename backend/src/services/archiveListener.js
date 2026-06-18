import { ArchiveService } from './ArchiveService.js';
import { eventBus } from '../core/EventBus.js';

const AGENT_EVENT_TYPES = new Set([
  'agent_step',
  'progress',
  'scheduled_batch_progress',
  'scheduled_draft_ready',
  'scheduled_batch_processing_started',
  'scheduled_batch_verified',
  'scheduled_batch_error',
  'duplicate_review',
  'scrape_progress',
  'scrape_skipped',
]);

export function startArchiveListener() {
  eventBus.on((data) => {
    if (!data?.type) return;

    if (AGENT_EVENT_TYPES.has(data.type)) {
      ArchiveService.logAgentEvent({
        professor_email: data.professor || data.email || data.professorEmail,
        mode: data.mode,
        batch_id: data.batchId,
        queue_id: data.id,
        draft_id: data.draftId,
        event_type: data.type,
        label: data.label || data.phase || data.stage || data.type,
        detail: {
          subject: data.subject,
          error: data.error,
          phase: data.phase,
          current: data.current,
          total: data.total,
        },
        tokens: data.tokens,
      });
    }

    if (data.type === 'duplicate_review') {
      ArchiveService.recordOutreach({
        professor_email: data.professor,
        mode: data.mode || 'instant',
        status: 'duplicate_review',
        subject: data.previous_subject,
        agent_summary: `Awaiting user decision — previously sent ${data.previous_sent_at || ''}`,
        queue_id: data.id,
      });
    }

    if (data.type === 'skipped' && data.error === 'duplicate_skipped') {
      ArchiveService.recordOutreach({
        professor_email: data.professor || data.email,
        mode: data.mode,
        status: 'duplicate_blocked',
        agent_summary: 'Skipped as duplicate during import/scrape',
        queue_id: data.id,
      });
    }
  });

  console.log('[Archive] Event listener active — permanent log recording enabled');
}
