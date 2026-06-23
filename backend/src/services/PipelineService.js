import cron from 'node-cron';
import { startWorkers, stopWorker, getWorkerStatus, prioritizeQueue } from '../pipeline/index.js';
import { stopScheduler } from '../pipeline/scheduler.js';
import { GmailService } from './GmailService.js';
import { runWeeklyDigest } from '../learning/index.js';
import { eventBus } from '../core/EventBus.js';
import db, { currentTenantKey } from '../db/index.js';

const runtimeStates = new Map();

function runtimeState() {
  const tenant = currentTenantKey() || 'anonymous';
  if (!runtimeStates.has(tenant)) runtimeStates.set(tenant, { cronJobs: [], replyCheckRunning: false });
  return runtimeStates.get(tenant);
}

function startReplyCheck() {
  const state = runtimeState();
  const job = cron.schedule('* * * * *', async () => {
    if (state.replyCheckRunning) return;
    state.replyCheckRunning = true;
    try { await GmailService.classifyInboxReplies(); }
    catch (e) { console.error('[Cron] classifyReplies error:', e.message); }
    finally { state.replyCheckRunning = false; }
  });
  state.cronJobs.push(job);
}

function startWeeklyDigest() {
  const state = runtimeState();
  const job = cron.schedule('0 9 * * 1', async () => {
    try {
      const digest = runWeeklyDigest(eventBus.publish.bind(eventBus));
      console.log('[Digest]', JSON.stringify(digest));
    } catch (e) { console.error('[Cron] digest error:', e.message); }
  });
  state.cronJobs.push(job);
}

export const PipelineService = {
  async start() {
    startWorkers();
  },

  startCronJobs() {
    const state = runtimeState();
    if (state.cronJobs.length) return;
    startReplyCheck();
    startWeeklyDigest();
    console.log('[PipelineService] Cron jobs started');
  },

  stop() {
    const state = runtimeState();
    stopWorker();
    stopScheduler();
    for (const job of state.cronJobs) job.stop();
    state.cronJobs = [];
  },

  status() {
    const state = runtimeState();
    return {
      ...getWorkerStatus(),
      cronJobs: state.cronJobs.length,
    };
  },

  proceed(id) {
    const row = db.prepare(`
      SELECT q.id, q.state, q.error, p.email as professor_email
      FROM queue q JOIN professors p ON q.professor_id=p.id WHERE q.id=?
    `).get(id);

    // Block proceeding items that are duplicates (already sent to this professor)
    if (row?.error === 'duplicate_skipped') return false;

    // Block proceeding items that are already sent
    if (row?.state === 'sent') return false;

    const result = db.prepare(
      "UPDATE queue SET state='pending', retry_count=0, retry_after=NULL, error=NULL, fast_track=1 WHERE id=? AND state IN ('awaiting_proceed', 'pending', 'failed', 'needs_review', 'skipped')"
    ).run(id);
    if (result.changes > 0) {
      prioritizeQueue(id);
      eventBus.publish({
        type: 'agent_step',
        stage: 'starting',
        id: Number(id),
        professor: row?.professor_email,
        label: 'Agent picked up your professor — starting now',
      });
    }
    return result.changes > 0;
  },
};
