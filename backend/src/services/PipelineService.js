import cron from 'node-cron';
import { startWorkers, stopWorker, getWorkerStatus, prioritizeQueue } from '../pipeline/index.js';
import { stopScheduler } from '../pipeline/scheduler.js';
import { GmailService } from './GmailService.js';
import { runWeeklyDigest } from '../learning/index.js';
import { eventBus } from '../core/EventBus.js';
import db from '../db/index.js';

let cronJobs = [];
let replyCheckRunning = false;

function startReplyCheck() {
  const job = cron.schedule('* * * * *', async () => {
    if (replyCheckRunning) return;
    replyCheckRunning = true;
    try { await GmailService.classifyInboxReplies(); }
    catch (e) { console.error('[Cron] classifyReplies error:', e.message); }
    finally { replyCheckRunning = false; }
  });
  cronJobs.push(job);
}

function startWeeklyDigest() {
  const job = cron.schedule('0 9 * * 1', async () => {
    try {
      const digest = runWeeklyDigest(eventBus.publish.bind(eventBus));
      console.log('[Digest]', JSON.stringify(digest));
    } catch (e) { console.error('[Cron] digest error:', e.message); }
  });
  cronJobs.push(job);
}

export const PipelineService = {
  async start() {
    startWorkers();
  },

  startCronJobs() {
    startReplyCheck();
    startWeeklyDigest();
    console.log('[PipelineService] Cron jobs started');
  },

  stop() {
    stopWorker();
    stopScheduler();
    for (const job of cronJobs) job.stop();
    cronJobs = [];
  },

  status() {
    return {
      ...getWorkerStatus(),
      cronJobs: cronJobs.length,
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
