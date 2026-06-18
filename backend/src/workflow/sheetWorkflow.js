// Excel-Centric Workflow Manager
// Single source of truth: Excel roster sheet controls everything

import db from '../db/index.js';
import { readRosterExcel, writeRosterExcel, getRosterExcelPath } from '../learning/rosterExcel.js';
import { enrichProfessorFromEmailImport, extractKeywordsForDossier } from '../research/profileResearch.js';
import { generateEmail } from '../ai/index.js';
import { sendEmail } from '../gmail/index.js';
import { eventBus } from '../core/EventBus.js';
import { lastNameFromEmail, fullNameFromEmail } from '../utils/professor.js';
import { normalizeInterestLineKeywords } from '../utils/interestLine.js';

/**
 * Excel Sheet Workflow:
 * 1. Read/Import emails to sheet
 * 2. Research each professor → Fill sheet columns
 * 3. Verify each row is complete
 * 4. Generate emails from sheet data
 * 5. Send emails one by one with verification
 */

// ═══════════════════════════════════════════════════════════════════
// STEP 1: Import emails to sheet
// ═══════════════════════════════════════════════════════════════════

export async function importEmailsToSheet(emails, options = {}) {
  const {
    fallbackEnabled = false,
    providedData = {}  // { email: { name, subject_keyword, interest_line } }
  } = options;

  console.log(`[SheetWorkflow] Importing ${emails.length} emails to sheet`);

  const sheet = readRosterExcel();
  const existingEmails = new Set(sheet.map(r => r.email));

  const newRows = [];

  for (const email of emails) {
    if (existingEmails.has(email)) {
      console.log(`[SheetWorkflow] Skip existing: ${email}`);
      continue;
    }

    const provided = providedData[email] || {};

    const row = {
      email,
      full_name: provided.name || fullNameFromEmail(email),
      university: provided.university || email.split('@')[1]?.replace('.edu', '') || '',
      department: provided.department || '',
      designation: provided.designation || '',
      research_interest: provided.research_interest || '',
      subject_keyword: provided.subject_keyword || '',
      interest_line: provided.interest_line ? normalizeInterestLineKeywords(provided.interest_line) : '',
      profile_url: provided.profile_url || '',
      email_verified: 'no',
      queue_state: 'pending_research',
      research_status: 'not_started',
      research_attempts: 0,
      fallback_mode: fallbackEnabled ? 'enabled' : 'disabled',
      error_reason: '',
      last_updated: new Date().toISOString()
    };

    newRows.push(row);
    existingEmails.add(email);
  }

  if (newRows.length > 0) {
    const updatedSheet = [...sheet, ...newRows];
    writeRosterExcel(updatedSheet);
    console.log(`[SheetWorkflow] ✓ Added ${newRows.length} rows to sheet`);
  }

  return {
    added: newRows.length,
    total: emails.length,
    sheetPath: getRosterExcelPath()
  };
}

// ═══════════════════════════════════════════════════════════════════
// STEP 2: Research professors and fill sheet
// ═══════════════════════════════════════════════════════════════════

export async function researchAndFillSheet(options = {}) {
  const {
    maxAttempts = 3,
    batchSize = 10,
    onProgress = null
  } = options;

  console.log('[SheetWorkflow] Starting research phase');

  const sheet = readRosterExcel();
  const toResearch = sheet.filter(r =>
    r.research_status !== 'complete' &&
    r.queue_state === 'pending_research'
  );

  if (toResearch.length === 0) {
    console.log('[SheetWorkflow] No professors need research');
    return { processed: 0, success: 0, failed: 0 };
  }

  console.log(`[SheetWorkflow] Researching ${toResearch.length} professors`);

  let success = 0;
  let failed = 0;

  // Process in batches
  for (let b = 0; b < toResearch.length; b += batchSize) {
    const batch = toResearch.slice(b, b + batchSize);

    const results = await Promise.allSettled(
      batch.map(async (row, localIdx) => {
        const globalIdx = b + localIdx;

        if (onProgress) {
          onProgress({
            type: 'research_progress',
            current: globalIdx + 1,
            total: toResearch.length,
            email: row.email,
            phase: 'researching'
          });
        }

        try {
          console.log(`[SheetWorkflow] Profile research for ${row.email} (attempt ${(row.research_attempts || 0) + 1})`);

          const enriched = await enrichProfessorFromEmailImport({
            prof: {
              email: row.email,
              last_name: row.last_name || '',
              university: row.university || '',
              profile_url: row.profile_url || '',
            },
            mode: 'instant',
          });
          const dossier = enriched.dossier || {};

          if (enriched.queueState === 'needs_web_research') {
            row.research_status = 'needs_web';
            row.queue_state = 'needs_web_research';
            row.research_attempts = (row.research_attempts || 0) + 1;
            row.error_reason = 'No profile data — use Web Search API before sheet email generation';
            row.last_updated = new Date().toISOString();
            return { success: false, email: row.email, needsWeb: true };
          }

          const keywords = await extractKeywordsForDossier(dossier);
          row.full_name = dossier.name || row.full_name;
          row.university = dossier.university || row.university;
          row.department = dossier.department || row.department;
          row.designation = dossier.title || row.designation;
          row.research_interest = (dossier.research_areas || []).join(', ') || row.research_interest;
          row.subject_keyword = keywords.subject_keyword || row.subject_keyword;
          row.interest_line = keywords.interest_line || row.interest_line;
          row.profile_url = dossier.profile_url || row.profile_url;
          row.email_verified = dossier.email_verified ? 'yes' : 'no';
          row.research_status = hasCompleteData(row) ? 'complete' : 'incomplete';
          row.research_attempts = (row.research_attempts || 0) + 1;
          row.queue_state = hasCompleteData(row) ? 'ready_for_email' : 'pending_research';
          row.error_reason = '';
          row.last_updated = new Date().toISOString();

          console.log(`[SheetWorkflow] ✓ Profile research for ${row.email}: ${row.research_status}`);
          return { success: true, email: row.email };
        } catch (e) {
          console.error(`[SheetWorkflow] Research failed for ${row.email}:`, e.message);

          row.research_attempts = (row.research_attempts || 0) + 1;
          row.error_reason = e.message;
          row.last_updated = new Date().toISOString();

          // Check if should give up
          if (row.research_attempts >= maxAttempts) {
            row.research_status = 'failed';
            row.queue_state = 'research_failed';
          }

          return { success: false, email: row.email, error: e.message };
        }
      })
    );

    // Count results
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.success) success++;
      else failed++;
    }
  }

  // Write updated sheet
  writeRosterExcel(sheet);

  console.log(`[SheetWorkflow] ✓ Research phase complete: ${success} success, ${failed} failed`);

  return {
    processed: toResearch.length,
    success,
    failed,
    sheetPath: getRosterExcelPath()
  };
}

// ═══════════════════════════════════════════════════════════════════
// STEP 3: Verify sheet is complete
// ═══════════════════════════════════════════════════════════════════

function hasCompleteData(row) {
  // Must have: name, email, research_interest OR department
  if (!row.full_name || row.full_name.length < 3) return false;
  if (!row.email || !row.email.includes('@')) return false;

  const hasResearch = row.research_interest && row.research_interest.length > 5;
  const hasDept = row.department && row.department.length > 3;

  return hasResearch || hasDept;
}

export function verifySheetComplete() {
  const sheet = readRosterExcel();

  const stats = {
    total: sheet.length,
    complete: 0,
    incomplete: 0,
    failed: 0,
    ready: 0
  };

  const issues = [];

  for (const row of sheet) {
    if (row.research_status === 'complete') stats.complete++;
    else if (row.research_status === 'failed') stats.failed++;
    else stats.incomplete++;

    if (row.queue_state === 'ready_for_email') stats.ready++;

    if (!hasCompleteData(row)) {
      issues.push({
        email: row.email,
        missing: getMissingFields(row)
      });
    }
  }

  return {
    ...stats,
    allComplete: stats.incomplete === 0 && stats.failed === 0,
    issues
  };
}

function getMissingFields(row) {
  const missing = [];
  if (!row.full_name || row.full_name.length < 3) missing.push('full_name');
  if (!row.research_interest && !row.department) missing.push('research_interest or department');
  return missing;
}

// ═══════════════════════════════════════════════════════════════════
// STEP 4: Generate emails from sheet
// ═══════════════════════════════════════════════════════════════════

export async function generateEmailsFromSheet(options = {}) {
  const {
    verifyBeforeSend = true,
    maxInterestWords = 20,
    onProgress = null
  } = options;

  console.log('[SheetWorkflow] Generating emails from sheet');

  const sheet = readRosterExcel();
  const tpl = db.prepare("SELECT raw_html, instructions, sample_subject FROM template WHERE mode='instant'").get();

  const readyRows = sheet.filter(r => r.queue_state === 'ready_for_email');

  if (readyRows.length === 0) {
    console.log('[SheetWorkflow] No rows ready for email generation');
    return { generated: 0, verified: 0, failed: 0 };
  }

  console.log(`[SheetWorkflow] Generating emails for ${readyRows.length} professors`);

  let generated = 0;
  let verified = 0;
  let failed = 0;

  for (let i = 0; i < readyRows.length; i++) {
    const row = readyRows[i];

    if (onProgress) {
      onProgress({
        type: 'email_generation',
        current: i + 1,
        total: readyRows.length,
        email: row.email,
        phase: 'generating'
      });
    }

    try {
      // If user provided subject_keyword and interest_line, use them
      let subject, interestLine, topic;

      if (row.subject_keyword && row.interest_line) {
        // User provided data - use directly
        console.log(`[SheetWorkflow] Using provided data for ${row.email}`);
        topic = row.subject_keyword;
        interestLine = row.interest_line;
        subject = row.fallback_mode === 'enabled'
          ? `Seeking an MS/PhD Position in Your Lab`
          : `[${topic}] Seeking an MS/PhD Position in Your Lab`;
      } else {
        // Generate from research data
        console.log(`[SheetWorkflow] Generating email for ${row.email}`);

        const dossier = {
          email: row.email,
          name: row.full_name,
          last_name: lastNameFromEmail(row.email),
          university: row.university,
          department: row.department,
          title: row.designation,
          research_areas: row.research_interest ? row.research_interest.split(',').map(s => s.trim()) : [],
          profile_url: row.profile_url,
          email_verified: row.email_verified === 'yes'
        };

        const result = await generateEmail(
          dossier,
          tpl?.instructions || '',
          tpl?.sample_subject || '',
          '',
          lastNameFromEmail(row.email)
        );

        if (!result.pass || !result.interestLine || result.interestLine.split(' ').length < 10) {
          throw new Error('Email generation failed self-check');
        }

        topic = result.topic;
        interestLine = result.interestLine;

        // Trim interest line to max words
        const words = interestLine.split(' ');
        if (words.length > maxInterestWords) {
          interestLine = words.slice(0, maxInterestWords).join(' ') + '...';
        }

        subject = row.fallback_mode === 'enabled'
          ? `Seeking an MS/PhD Position in Your Lab`
          : `[${topic}] Seeking an MS/PhD Position in Your Lab`;
      }

      // Update row with generated email
      row.subject_keyword = topic;
      row.interest_line = interestLine;
      row.queue_state = verifyBeforeSend ? 'awaiting_verification' : 'ready_to_send';
      row.last_updated = new Date().toISOString();

      generated++;

      if (!verifyBeforeSend) {
        verified++;
      }

      console.log(`[SheetWorkflow] ✓ Email generated for ${row.email}`);
    } catch (e) {
      console.error(`[SheetWorkflow] Email generation failed for ${row.email}:`, e.message);
      row.queue_state = 'email_generation_failed';
      row.error_reason = e.message;
      row.last_updated = new Date().toISOString();
      failed++;
    }
  }

  // Write updated sheet
  writeRosterExcel(sheet);

  console.log(`[SheetWorkflow] ✓ Email generation complete: ${generated} generated, ${verified} auto-verified`);

  return {
    generated,
    verified,
    failed,
    sheetPath: getRosterExcelPath()
  };
}

// ═══════════════════════════════════════════════════════════════════
// STEP 5: Send emails with verification
// ═══════════════════════════════════════════════════════════════════

export async function sendEmailsFromSheet(options = {}) {
  const {
    verifyEach = true,
    onVerificationNeeded = null,
    onProgress = null
  } = options;

  console.log('[SheetWorkflow] Sending emails from sheet');

  const sheet = readRosterExcel();
  const tpl = db.prepare("SELECT raw_html FROM template WHERE mode='instant'").get();

  const toSend = sheet.filter(r =>
    r.queue_state === 'ready_to_send' ||
    (r.queue_state === 'awaiting_verification' && !verifyEach)
  );

  if (toSend.length === 0) {
    console.log('[SheetWorkflow] No emails ready to send');
    return { sent: 0, failed: 0, awaitingVerification: 0 };
  }

  console.log(`[SheetWorkflow] Sending ${toSend.length} emails`);

  let sent = 0;
  let failed = 0;
  let awaitingVerification = 0;

  for (let i = 0; i < toSend.length; i++) {
    const row = toSend[i];

    if (onProgress) {
      onProgress({
        type: 'email_sending',
        current: i + 1,
        total: toSend.length,
        email: row.email,
        phase: 'sending'
      });
    }

    // Check if verification needed
    if (verifyEach && row.queue_state === 'awaiting_verification') {
      if (onVerificationNeeded) {
        const approved = await onVerificationNeeded(row);
        if (!approved) {
          console.log(`[SheetWorkflow] Email to ${row.email} not approved`);
          awaitingVerification++;
          continue;
        }
      } else {
        console.log(`[SheetWorkflow] Email to ${row.email} awaiting verification`);
        awaitingVerification++;
        continue;
      }
    }

    try {
      // Get professor from database
      const prof = db.prepare('SELECT id FROM professors WHERE email=?').get(row.email);
      if (!prof) {
        // Insert professor
        db.prepare('INSERT INTO professors (email, last_name, university, research_areas, dossier) VALUES (?,?,?,?,?)').run(
          row.email,
          lastNameFromEmail(row.email),
          row.university,
          row.research_interest,
          JSON.stringify({
            email: row.email,
            name: row.full_name,
            university: row.university,
            department: row.department,
            research_areas: row.research_interest.split(',').map(s => s.trim())
          })
        );
        const newProf = db.prepare('SELECT id FROM professors WHERE email=?').get(row.email);
        prof.id = newProf.id;
      }

      // Send email
      console.log(`[SheetWorkflow] Sending email to ${row.email}`);

      const result = await sendEmail({
        professor_id: prof.id,
        subject: row.subject_keyword ? `[${row.subject_keyword}] Seeking an MS/PhD Position in Your Lab` : 'Seeking an MS/PhD Position in Your Lab',
        interest_line: row.interest_line
      });

      // Update row
      row.queue_state = 'sent';
      row.last_updated = new Date().toISOString();

      // Log to sent_log
      db.prepare("INSERT INTO sent_log (professor_email, subject, topic, message_id, sent_at, mode) VALUES (?,?,?,?,datetime('now'),'instant')")
        .run(row.email, row.subject_keyword || 'General', row.subject_keyword || '', result.id || null);

      sent++;
      console.log(`[SheetWorkflow] ✓ Email sent to ${row.email}`);
    } catch (e) {
      console.error(`[SheetWorkflow] Send failed for ${row.email}:`, e.message);
      row.queue_state = 'send_failed';
      row.error_reason = e.message;
      row.last_updated = new Date().toISOString();
      failed++;
    }
  }

  // Write updated sheet
  writeRosterExcel(sheet);

  console.log(`[SheetWorkflow] ✓ Sending complete: ${sent} sent, ${failed} failed, ${awaitingVerification} awaiting`);

  return {
    sent,
    failed,
    awaitingVerification,
    sheetPath: getRosterExcelPath()
  };
}

// ═══════════════════════════════════════════════════════════════════
// Complete workflow orchestration
// ═══════════════════════════════════════════════════════════════════

export async function runCompleteWorkflow(emails, options = {}) {
  const {
    fallbackEnabled = false,
    providedData = {},
    verifyBeforeSend = true,
    onProgress = null
  } = options;

  console.log(`[SheetWorkflow] Starting complete workflow for ${emails.length} emails`);

  try {
    // Step 1: Import to sheet
    console.log('[SheetWorkflow] Step 1/5: Import emails to sheet');
    const importResult = await importEmailsToSheet(emails, { fallbackEnabled, providedData });

    if (onProgress) onProgress({ phase: 'imported', result: importResult });

    // Step 2: Research and fill sheet
    console.log('[SheetWorkflow] Step 2/5: Research professors');
    const researchResult = await researchAndFillSheet({
      maxAttempts: 3,
      batchSize: 10,
      onProgress: (p) => onProgress && onProgress({ phase: 'research', ...p })
    });

    if (onProgress) onProgress({ phase: 'researched', result: researchResult });

    // Step 3: Verify sheet
    console.log('[SheetWorkflow] Step 3/5: Verify sheet completeness');
    const verification = verifySheetComplete();

    if (onProgress) onProgress({ phase: 'verified', result: verification });

    // Step 4: Generate emails
    console.log('[SheetWorkflow] Step 4/5: Generate emails from sheet');
    const genResult = await generateEmailsFromSheet({
      verifyBeforeSend,
      maxInterestWords: 20,
      onProgress: (p) => onProgress && onProgress({ phase: 'email_gen', ...p })
    });

    if (onProgress) onProgress({ phase: 'generated', result: genResult });

    // Step 5: Send emails (if auto-send enabled)
    if (!verifyBeforeSend) {
      console.log('[SheetWorkflow] Step 5/5: Send emails');
      const sendResult = await sendEmailsFromSheet({
        verifyEach: false,
        onProgress: (p) => onProgress && onProgress({ phase: 'sending', ...p })
      });

      if (onProgress) onProgress({ phase: 'sent', result: sendResult });
    }

    console.log('[SheetWorkflow] ✓ Complete workflow finished');

    return {
      success: true,
      sheetPath: getRosterExcelPath(),
      stats: {
        imported: importResult.added,
        researched: researchResult.success,
        generated: genResult.generated,
        verification
      }
    };
  } catch (e) {
    console.error('[SheetWorkflow] Workflow failed:', e.message);
    throw e;
  }
}
