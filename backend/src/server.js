import express from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import router from './routes/index.js';
import scheduledRouter from './routes/scheduled.js';
import { PipelineService } from './services/PipelineService.js';
import { startScheduler, stopScheduler } from './pipeline/scheduler.js';
import db from './db/index.js';
import { seedBothModes } from './gmail/templateSeeder.js';
import { startArchiveListener } from './services/archiveListener.js';
import { applyUserApiKeysFromDb } from './services/userApiKeys.js';
import { repairBasicInstantTemplate } from './db/templateStore.js';
import { securityHeaders } from './middleware/security.js';
import { requireActiveTenant, requireFeature } from './middleware/tenantAccess.js';
process.on('uncaughtException', (e) => console.error('[FATAL] Uncaught exception:', e));
process.on('unhandledRejection', (e) => console.error('[FATAL] Unhandled rejection:', e));

const app = express();
const allowedOrigins = new Set([
  config.frontendUrl.replace(/\/$/, ''),
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
]);
app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    callback(new Error('Origin not allowed'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false,
}));
app.use(securityHeaders);
app.use(express.json({ limit: '10mb' }));
app.use('/api', router);
app.use('/api/scheduled', requireActiveTenant, requireFeature('scheduled'), scheduledRouter);

app.use((err, req, res, next) => {
  console.error(`[API] Unhandled ${req.method} ${req.originalUrl}:`, err?.message || err);
  if (!res.headersSent) {
    res.status(err?.message === 'Origin not allowed' ? 403 : 500).json({
      error: err?.message === 'Origin not allowed' ? 'Origin not allowed' : 'Internal server error',
    });
  }
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Server] ${signal} received — shutting down gracefully`);

  PipelineService.stop();
  stopScheduler();

  // Wait up to 30s for in-flight work to finish
  const start = Date.now();
  while (Date.now() - start < 30000) {
    const pending = db.prepare("SELECT COUNT(*) as c FROM queue WHERE state IN ('researching','drafted','verified')").get().c;
    if (pending === 0) break;
    await new Promise(r => setTimeout(r, 1000));
  }

  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
  try { db.close(); } catch {}
  console.log('[Server] Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

app.listen(config.port, () => {
  console.log(`Backend running on port ${config.port}`);
  // Defer heavy startup work so the first /api/health responds quickly
  setImmediate(() => {
    applyUserApiKeysFromDb();
    repairBasicInstantTemplate();
    seedBothModes();
    startArchiveListener();
    PipelineService.startCronJobs();
    PipelineService.start();
    startScheduler();
  });
});
