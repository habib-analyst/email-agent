// Excel Sheet-Centric Workflow Routes
import { Router } from 'express';
import {
  importEmailsToSheet,
  researchAndFillSheet,
  verifySheetComplete,
  generateEmailsFromSheet,
  sendEmailsFromSheet,
  runCompleteWorkflow
} from '../workflow/sheetWorkflow.js';
import { readRosterExcel, getRosterExcelPath } from '../learning/rosterExcel.js';
import { eventBus } from '../core/EventBus.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════════
// Modern Paste Email Section with Fallback Toggle
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /api/sheet/import-emails
 *
 * Import emails with optional provided data
 *
 * Body:
 * {
 *   emails: ["prof1@mit.edu", "prof2@stanford.edu"],
 *   fallbackEnabled: false,
 *   providedData: {
 *     "prof1@mit.edu": {
 *       name: "John Smith",
 *       subject_keyword: "Machine Learning",
 *       interest_line: "I am interested in your work on neural networks",
 *       university: "MIT",
 *       department: "Computer Science"
 *     }
 *   }
 * }
 */
router.post('/import-emails', async (req, res) => {
  try {
    const { emails, fallbackEnabled = false, providedData = {} } = req.body;

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'Emails array required' });
    }

    // Clean emails
    const cleanedEmails = emails
      .map(e => e.trim().toLowerCase())
      .filter(e => e.includes('@'));

    if (cleanedEmails.length === 0) {
      return res.status(400).json({ error: 'No valid emails found' });
    }

    const result = await importEmailsToSheet(cleanedEmails, {
      fallbackEnabled,
      providedData
    });

    eventBus.publish({
      type: 'sheet_import',
      count: result.added,
      fallbackEnabled,
      sheetPath: result.sheetPath
    });

    res.json({
      success: true,
      ...result,
      message: `Added ${result.added} professors to Excel sheet`
    });
  } catch (e) {
    console.error('[SheetRoutes] Import failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Research and Fill Sheet
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /api/sheet/research
 *
 * Research professors and fill sheet with data
 */
router.post('/research', async (req, res) => {
  try {
    const { maxAttempts = 3, batchSize = 10 } = req.body;

    // Start research in background
    (async () => {
      try {
        const result = await researchAndFillSheet({
          maxAttempts,
          batchSize,
          onProgress: (progress) => {
            eventBus.publish({
              type: 'sheet_research_progress',
              ...progress
            });
          }
        });

        eventBus.publish({
          type: 'sheet_research_complete',
          ...result
        });
      } catch (e) {
        eventBus.publish({
          type: 'sheet_research_error',
          error: e.message
        });
      }
    })();

    res.json({
      success: true,
      message: 'Research started in background'
    });
  } catch (e) {
    console.error('[SheetRoutes] Research failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Verify Sheet Completeness
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/sheet/verify
 *
 * Check if sheet is complete and ready
 */
router.get('/verify', (req, res) => {
  try {
    const result = verifySheetComplete();
    res.json(result);
  } catch (e) {
    console.error('[SheetRoutes] Verify failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Generate Emails from Sheet
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /api/sheet/generate-emails
 *
 * Generate emails from sheet data
 */
router.post('/generate-emails', async (req, res) => {
  try {
    const { verifyBeforeSend = true, maxInterestWords = 20 } = req.body;

    const result = await generateEmailsFromSheet({
      verifyBeforeSend,
      maxInterestWords,
      onProgress: (progress) => {
        eventBus.publish({
          type: 'sheet_email_gen_progress',
          ...progress
        });
      }
    });

    eventBus.publish({
      type: 'sheet_email_gen_complete',
      ...result
    });

    res.json({
      success: true,
      ...result,
      message: `Generated ${result.generated} emails`
    });
  } catch (e) {
    console.error('[SheetRoutes] Generate failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Send Emails from Sheet
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /api/sheet/send-emails
 *
 * Send emails from sheet (one by one with verification if enabled)
 */
router.post('/send-emails', async (req, res) => {
  try {
    const { verifyEach = true } = req.body;

    const result = await sendEmailsFromSheet({
      verifyEach,
      onProgress: (progress) => {
        eventBus.publish({
          type: 'sheet_send_progress',
          ...progress
        });
      }
    });

    eventBus.publish({
      type: 'sheet_send_complete',
      ...result
    });

    res.json({
      success: true,
      ...result,
      message: `Sent ${result.sent} emails`
    });
  } catch (e) {
    console.error('[SheetRoutes] Send failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Get Sheet Status
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/sheet/status
 *
 * Get current sheet status and statistics
 */
router.get('/status', (req, res) => {
  try {
    const sheet = readRosterExcel();

    const stats = {
      total: sheet.length,
      byStatus: {},
      byState: {},
      fallbackEnabled: 0,
      awaitingVerification: 0,
      readyToSend: 0
    };

    for (const row of sheet) {
      // Count by research status
      stats.byStatus[row.research_status] = (stats.byStatus[row.research_status] || 0) + 1;

      // Count by queue state
      stats.byState[row.queue_state] = (stats.byState[row.queue_state] || 0) + 1;

      // Count fallback enabled
      if (row.fallback_mode === 'enabled') stats.fallbackEnabled++;

      // Count awaiting verification
      if (row.queue_state === 'awaiting_verification') stats.awaitingVerification++;

      // Count ready to send
      if (row.queue_state === 'ready_to_send') stats.readyToSend++;
    }

    res.json({
      success: true,
      sheetPath: getRosterExcelPath(),
      stats,
      recentRows: sheet.slice(-10)  // Last 10 rows
    });
  } catch (e) {
    console.error('[SheetRoutes] Status failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Get Full Sheet Data
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/sheet/data
 *
 * Get all sheet rows
 */
router.get('/data', (req, res) => {
  try {
    const sheet = readRosterExcel();
    res.json({
      success: true,
      rows: sheet,
      count: sheet.length,
      sheetPath: getRosterExcelPath()
    });
  } catch (e) {
    console.error('[SheetRoutes] Get data failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Complete Workflow (All steps)
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /api/sheet/workflow/complete
 *
 * Run complete workflow: import → research → generate → send
 */
router.post('/workflow/complete', async (req, res) => {
  try {
    const {
      emails,
      fallbackEnabled = false,
      providedData = {},
      verifyBeforeSend = true
    } = req.body;

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'Emails array required' });
    }

    // Start workflow in background
    (async () => {
      try {
        const result = await runCompleteWorkflow(emails, {
          fallbackEnabled,
          providedData,
          verifyBeforeSend,
          onProgress: (progress) => {
            eventBus.publish({
              type: 'sheet_workflow_progress',
              ...progress
            });
          }
        });

        eventBus.publish({
          type: 'sheet_workflow_complete',
          ...result
        });
      } catch (e) {
        eventBus.publish({
          type: 'sheet_workflow_error',
          error: e.message
        });
      }
    })();

    res.json({
      success: true,
      message: 'Complete workflow started in background'
    });
  } catch (e) {
    console.error('[SheetRoutes] Workflow failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
