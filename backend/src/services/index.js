/**
 * Service registry — internal microservice-style modules.
 *
 * FLOW (each service knows its upstream/downstream):
 *
 *   AuthService ──► GmailService (requires connected account)
 *        │
 *        ├──► PipelineWorker ──► GmailService.send()
 *        ├──► ScrapeJob ──► GmailService.tryAutoLoadTemplate()
 *        └──► Template routes ──► GmailService.loadLatestAsTemplate()
 *
 *   EventBus ◄── all services publish real-time events
 *        └──► SSE /api/queue/stream ──► Frontend EventStream
 *
 *   SessionEpoch ◄── ResetService invalidates in-flight jobs
 */

export { AuthService, GmailNotConnectedError } from './AuthService.js';
export { GmailService } from './GmailService.js';
export { eventBus } from '../core/EventBus.js';

export const SERVICE_FLOW = {
  auth: ['gmail', 'pipeline', 'scrape', 'template'],
  gmail: ['pipeline.send', 'template.load', 'replies.classify'],
  scrape: ['research', 'queue', 'gmail.tryAutoLoadTemplate', 'eventBus'],
  pipeline: ['research', 'ai', 'gmail.send', 'eventBus'],
  reset: ['sessionEpoch', 'scrape.cancel', 'eventBus', 'gmail.clearCache'],
};
