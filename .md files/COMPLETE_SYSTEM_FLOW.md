# COMPLETE SYSTEM FLOW - Deep Technical Analysis

## 🔍 THREE-AGENT RESEARCH SYSTEM (Core Intelligence)

### Agent Architecture
```
┌──────────────────────────────────────────────────────────────┐
│  AGENT 1: deepseek-v3.2 @ Qwen API 1 (15M tokens)          │
│  Role: Primary web search via tool calling                  │
│  Cost: ~800 tokens per professor (~10x cheaper than Gemini) │
└──────────────────────────────────────────────────────────────┘
                           ↓ (if fails)
┌──────────────────────────────────────────────────────────────┐
│  AGENT 1 FALLBACK: Gemini                                   │
│  Role: Backup web search (only if deepseek fails)          │
│  Cost: ~1000 tokens per professor                           │
└──────────────────────────────────────────────────────────────┘
                           ↓ (search results)
┌──────────────────────────────────────────────────────────────┐
│  AGENT 2: Qwen 3.7 models @ Qwen API 2 (83M tokens)        │
│  Role: Data processing, scraping, generation                │
│  Cost: ~1200 tokens per professor (~5x cheaper than Gemini) │
└──────────────────────────────────────────────────────────────┘
```

### Research Output (Dossier Structure)
```javascript
{
  email: "prof@university.edu",
  name: "Full Name",
  last_name: "LastName",
  university: "Institution",
  department: "Computer Science",
  title: "Associate Professor",
  research_areas: ["AI", "Machine Learning"],  // Max 3
  papers: [
    { title: "Paper Name", year: 2024 }
  ],
  profile_url: "https://...",
  email_verified: true/false,
  verified: true/false,  // Quality gate
  
  // Agent tracking
  research_source: "three_agent",
  search_model: "deepseek-v3.2",
  search_api: "qwen1",
  processing_model: "qwen3.7",
  processing_api: "qwen2",
  
  data_quality: "excellent/good/fair/poor"
}
```

---

## 📊 INSTANT MODE - Real-Time Flow

### 1. SINGLE EMAIL IMPORT (Paste 1 email)

**Step-by-Step Execution:**

```
User pastes: professor@mit.edu
      ↓
[Frontend] emailInput state updated
      ↓
[Frontend] onClick importEmails()
      ↓
[Backend] POST /professors { emails: "professor@mit.edu" }
      ↓
┌─────────────────────────────────────────────────────┐
│ PARALLEL RESEARCH (3-Agent System)                  │
│                                                      │
│ 1. Agent 1 (deepseek @ Qwen1) → Web search         │
│    - Searches: "Professor MIT professor@mit.edu"   │
│    - Returns: name, research_areas, papers          │
│    - Time: ~2-3 seconds                            │
│                                                      │
│ 2. Agent 2 (Qwen3.7 @ Qwen2) → Data processing    │
│    - Cleans search results                         │
│    - Verifies email domain matches university      │
│    - Categorizes research areas (top 3)            │
│    - Assesses data quality                         │
│    - Time: ~2-3 seconds                            │
│                                                      │
│ Total: ~5 seconds per professor                     │
└─────────────────────────────────────────────────────┘
      ↓
[Database] INSERT INTO professors (with dossier)
      ↓
[Database] INSERT INTO queue (state='awaiting_proceed')
      ↓
[SSE Event] import_research_progress → Frontend
      ↓
[Frontend] Shows "Proceed Now" button
      ↓
[User clicks] "Proceed Now"
      ↓
[Backend] UPDATE queue SET state='pending'
      ↓
[Worker] Picks up queue item (processQueueItem)
      ↓
┌─────────────────────────────────────────────────────┐
│ QUEUE PROCESSING PIPELINE                           │
│                                                      │
│ State: researching → drafted → verified → sent     │
│                                                      │
│ 1. Researching (Skip if dossier exists)            │
│    - Dossier already verified from import          │
│    - Publishes: "Skipped research"                 │
│                                                      │
│ 2. Drafting (Email Generation)                     │
│    - Uses template + professor dossier             │
│    - Generates subject keywords                    │
│    - Creates interest_line (max 20 words)          │
│    - Self-check: pass=true, personalization>20 chars│
│    - Time: ~3-4 seconds                            │
│                                                      │
│ 3. Verified                                         │
│    - Ready to send                                 │
│    - Updates queue state='verified'                │
│                                                      │
│ 4. Sending                                          │
│    - Replaces {{LAST_NAME}} with actual name       │
│    - Replaces {{INTEREST_LINE}} with generated line│
│    - Gmail API: sendMessage()                      │
│    - Time: ~1-2 seconds                            │
│                                                      │
│ 5. Sent                                             │
│    - INSERT INTO sent_log                          │
│    - Updates analytics                             │
│    - Publishes success event                       │
└─────────────────────────────────────────────────────┘
```

**Real-Time Updates via SSE:**
```javascript
// Frontend listens to:
{
  type: 'import_research_progress',
  email: 'professor@mit.edu',
  phase: 'researching',  // → complete
  searchModel: 'deepseek-v3.2',
  verified: true
}

{
  type: 'progress',
  stage: 'researching',  // → drafted → verified → sending → sent
  professor: 'professor@mit.edu'
}

{
  type: 'queue_update',
  items: [...updated queue items]
}
```

---

### 2. MULTIPLE EMAILS IMPORT (Paste 5 emails)

**Differences from Single:**

```
User pastes 5 emails
      ↓
[Backend] Batch research (10 emails at a time in parallel)
      ↓
┌─────────────────────────────────────────────────────┐
│ PARALLEL BATCH PROCESSING                           │
│                                                      │
│ Promise.allSettled([                                │
│   threeAgentResearch(email1),  ← 3 agents           │
│   threeAgentResearch(email2),  ← 3 agents           │
│   threeAgentResearch(email3),  ← 3 agents           │
│   threeAgentResearch(email4),  ← 3 agents           │
│   threeAgentResearch(email5),  ← 3 agents           │
│ ])                                                   │
│                                                      │
│ All 5 professors researched in parallel            │
│ Wall-clock time: ~5 seconds (not 25 seconds!)      │
└─────────────────────────────────────────────────────┘
      ↓
[Database] INSERT INTO queue (state='pending') ← All start immediately
      ↓
[Worker] Auto-starts if template exists
      ↓
[Pipeline] Processes queue items sequentially
      - Email 1: research → draft → verify → send
      - Email 2: research → draft → verify → send
      - ...
```

**Key Difference:**
- **Single email**: `state='awaiting_proceed'` (waits for user)
- **Multiple emails**: `state='pending'` (auto-start)

---

### 3. URL SCRAPING (Faculty page)

```
User inputs: https://cs.stanford.edu/people/faculty
      ↓
[Backend] startFacultyImport(url)
      ↓
[Scraper] scrapeFacultyPage(url)
      ↓
┌─────────────────────────────────────────────────────┐
│ URL SCRAPING FLOW                                    │
│                                                      │
│ 1. Fetch page HTML                                  │
│    - Puppeteer (headless browser)                   │
│    - Handles JavaScript-rendered content            │
│                                                      │
│ 2. Extract emails + profile URLs                    │
│    - Finds: professor@stanford.edu                  │
│    - Finds: https://cs.stanford.edu/~professor     │
│                                                      │
│ 3. For EACH professor found:                        │
│    a. buildProfessorDossier() is called            │
│       - Uses three-agent research system            │
│       - deepseek search → Qwen processing           │
│                                                      │
│    b. INSERT INTO professors (with full dossier)    │
│                                                      │
│    c. INSERT INTO queue (state='pending')           │
│                                                      │
│    d. upsertRosterRow() → Excel tracking           │
│                                                      │
│ Progress published every professor:                  │
│   { phase: 'template', current: 5, total: 20 }     │
└─────────────────────────────────────────────────────┘
      ↓
[Worker] Auto-starts processing all professors
```

**SSE Progress Events:**
```javascript
{ type: 'scrape_progress', phase: 'discovering', current: 0, total: 0 }
{ type: 'scrape_progress', phase: 'template', current: 1, total: 20, currentEmail: 'prof1@...' }
{ type: 'scrape_progress', phase: 'template', current: 2, total: 20, currentEmail: 'prof2@...' }
...
{ type: 'scrape_progress', phase: 'complete', added: 20, skipped: 0 }
```

---

### 4. FILE UPLOAD (.xlsx, .csv)

```
User uploads: professors.xlsx
      ↓
[Frontend] onFileChange() → parses file
      ↓
[Frontend] Shows preview: "Found 15 emails"
      ↓
[User clicks] "Import 15 Emails"
      ↓
[Backend] POST /professors { emails: "email1,email2,..." }
      ↓
Same flow as "Multiple Emails Import" (see section 2)
```

**Supported Formats:**
- `.xlsx` (Excel)
- `.csv` (Comma-separated)
- `.txt` (Line-separated emails)

**File Parsing:**
- Client-side with `xlsx` library
- Extracts emails from first column
- Validates email format (`includes('@')`)

---

## 📅 SCHEDULED MODE - Batch Flow

### 1. CREATE SCHEDULED BATCH (Single/Multiple/URL)

```
User in Scheduled page:
  - Sets date: 2026-06-15
  - Sets time: 09:00
  - Pastes emails OR inputs URL
      ↓
[Frontend] onClick scheduleImport()
      ↓
[Backend] POST /scheduled/batch
  {
    scheduled_at: "2026-06-15T09:00:00",
    emails: "prof1@...,prof2@...",  // OR url: "https://..."
  }
      ↓
[Database] INSERT INTO scheduled_batches
  - id: 1
  - scheduled_at: "2026-06-15T09:00:00"
  - status: 'pending'
      ↓
[Backend] startScheduledBatchProcessing(batchId)
      ↓
┌─────────────────────────────────────────────────────┐
│ SCHEDULED BATCH PROCESSING (Background)             │
│                                                      │
│ Phase 1: Import & Research                          │
│   - If URL: scrape faculty page                     │
│   - If emails: parse list                           │
│   - For each professor:                             │
│     * threeAgentResearch() (3-agent system)        │
│     * INSERT INTO professors (with dossier)         │
│                                                      │
│ Phase 2: Draft Generation                           │
│   - For each professor:                             │
│     * generateEmail() with template                │
│     * INSERT INTO scheduled_drafts                  │
│       - batch_id: 1                                 │
│       - professor_id: X                             │
│       - subject: "Generated subject"                │
│       - interest_line: "Personalized line"          │
│       - html_preview: Rendered email HTML           │
│       - status: 'draft'                             │
│                                                      │
│ Phase 3: Wait for User Approval                     │
│   - Drafts shown in Scheduled Drafts table         │
│   - User can:                                       │
│     * View draft preview                            │
│     * Edit subject/interest_line                   │
│     * Approve individual drafts                     │
│     * Approve all drafts                            │
│     * Delete drafts                                 │
│                                                      │
│ Phase 4: Scheduled Send (At scheduled_at time)      │
│   - Scheduler checks every 30 seconds:             │
│     SELECT * FROM scheduled_batches                │
│     WHERE scheduled_at <= NOW()                    │
│       AND status = 'pending'                       │
│                                                      │
│   - For each batch:                                 │
│     * Find approved drafts                          │
│     * For each approved draft:                      │
│       - Replace placeholders                        │
│       - Send via Gmail API                          │
│       - UPDATE status='sent'                        │
│       - INSERT INTO sent_log                        │
└─────────────────────────────────────────────────────┘
```

### 2. DRAFT APPROVAL FLOW

**View Drafts:**
```
[Frontend] Click "View" on batch #1
      ↓
[Backend] GET /scheduled/batch/1/drafts
      ↓
Returns:
[
  {
    id: 1,
    batch_id: 1,
    professor_email: "prof@mit.edu",
    last_name: "Smith",
    subject: "Collaboration on AI Research",
    interest_line: "Your work on neural networks...",
    status: "draft",
    html_preview: "<html>..."
  },
  ...
]
```

**Approve Single Draft:**
```
[Frontend] Click "Approve" on draft #1
      ↓
[Backend] POST /scheduled/draft/1/approve
      ↓
[Database] UPDATE scheduled_drafts 
  SET status='approved' 
  WHERE id=1
```

**Approve All Drafts:**
```
[Frontend] Click "Approve All" on batch #1
      ↓
[Backend] POST /scheduled/batch/1/approve-all
      ↓
[Database] UPDATE scheduled_drafts 
  SET status='approved' 
  WHERE batch_id=1 AND status='draft'
```

**Edit Draft:**
```
[Frontend] Edit subject or interest_line
      ↓
[Backend] PUT /scheduled/draft/1
  {
    subject: "New subject",
    interest_line: "New personalized line"
  }
      ↓
[Database] UPDATE scheduled_drafts
  - Rebuilds html_preview with new values
  - Sets edited_by_user=1
```

### 3. SCHEDULED SEND EXECUTION

```
[Scheduler] Runs every 30 seconds
      ↓
Check current time: 2026-06-15 09:00:00
      ↓
Query: SELECT * FROM scheduled_batches
       WHERE scheduled_at <= NOW()
         AND status = 'pending'
      ↓
Found batch #1 (scheduled for 09:00)
      ↓
[Scheduler] UPDATE status='processing'
      ↓
Query: SELECT * FROM scheduled_drafts
       WHERE batch_id=1 AND status='approved'
      ↓
Found 5 approved drafts
      ↓
For each draft (sequential):
  1. Get template HTML
  2. Replace {{LAST_NAME}} → actual name
  3. Replace {{INTEREST_LINE}} → actual line
  4. Send via Gmail API
  5. UPDATE draft status='sent'
  6. INSERT INTO sent_log
      ↓
All sent → UPDATE batch status='completed'
```

**Error Handling:**
```
If Gmail send fails for draft:
  - UPDATE draft status='failed'
  - Continue with next draft
  - Batch status remains 'processing'
  
If all drafts fail:
  - UPDATE batch status='failed'
```

---

## 🔄 REAL-TIME ANALYTICS (Both Modes)

### Analytics Calculation

**Frontend State (SessionContext):**
```javascript
stats: {
  total: 10,        // Total professors in queue
  sent: 5,          // Successfully sent
  failed: 1,        // Failed
  researching: 2,   // Currently researching
  drafted: 1,       // Email drafted
  scraping: 0,      // URL scrape in progress
  todaySent: 5,     // Sent today (from sent_log)
  weekSent: 15,     // Sent this week
}
```

**Backend Query (Real-time):**
```sql
-- Total queue items by state
SELECT state, COUNT(*) as count 
FROM queue 
GROUP BY state

-- Today's sent count
SELECT COUNT(*) 
FROM sent_log 
WHERE DATE(sent_at) = DATE('now')

-- Week's sent count
SELECT COUNT(*) 
FROM sent_log 
WHERE sent_at >= datetime('now', '-7 days')
```

**Update Triggers:**
1. **Queue state change** → `queue_update` event → Frontend updates
2. **Email sent** → `sent` event → Increment `todaySent`
3. **New professor imported** → `import_complete` → Increment `total`

### Dashboard Analytics (/)

**Live Metrics:**
```javascript
loadStats() → GET /stats
{
  todaySent: 5,
  weekSent: 15,
  totalSent: 150,
  queueSize: 3,
  scheduledBatches: 2  // From scheduled_batches table
}
```

**Update Frequency:**
- Real-time via SSE events
- Fallback: Poll every 10 seconds

---

## 🔴 RESET BUTTON - Deep Dive

### Reset Flow (Both Instant & Scheduled)

```
[Frontend] User clicks "New Task" button
      ↓
[Frontend] Confirmation: "Clear all sections?"
      ↓
[Frontend] User clicks "Reset"
      ↓
[Frontend] setResetting(true) → Shows loading state
      ↓
[Backend] POST /agent/reset
      ↓
┌─────────────────────────────────────────────────────┐
│ RESET OPERATIONS (Transaction)                      │
│                                                      │
│ 1. Cancel active scrape job                         │
│    - activeJob.cancelled = true                     │
│                                                      │
│ 2. Increment session epoch                          │
│    - session_epoch++ in session_state table        │
│    - All in-progress workers abort                  │
│                                                      │
│ 3. Clear queue                                      │
│    DELETE FROM queue;                               │
│                                                      │
│ 4. Clear professors                                 │
│    DELETE FROM professors;                          │
│                                                      │
│ 5. Clear roster Excel                               │
│    - clearRosterExcel() → Empties all rows         │
│                                                      │
│ 6. Reset template (OPTIONAL - not done)             │
│    - Template is preserved across resets            │
│                                                      │
│ 7. Clear agent toast state                          │
│    - Removes any pending notifications             │
└─────────────────────────────────────────────────────┘
      ↓
[SSE Event] { type: 'reset', epoch: NEW_EPOCH }
      ↓
[Frontend] applyReset(newEpoch)
  - Clears queue state
  - Clears roster
  - Clears import inputs
  - Shows success toast: "Dashboard cleared"
      ↓
[Frontend] Ready for new task
```

**What is NOT Reset:**
- ✅ Template (preserved)
- ✅ Sent log (history preserved)
- ✅ Scheduled batches (independent system)
- ✅ Gmail connection
- ✅ Analytics history

**Session Epoch Mechanism:**
```javascript
// Before any long operation:
const loopEpoch = getSessionEpoch(db);  // e.g., 5

// During operation:
if (!isSessionEpoch(db, loopEpoch)) {
  // Epoch changed (reset happened) → Abort
  return;
}

// After reset: epoch = 6
// Old workers check: isSessionEpoch(db, 5) → false → Stop
```

---

## ✅ VERIFICATION BEFORE SEND

### 1. Data Quality Verification (During Research)

```javascript
function hasUsefulData(dossier) {
  if (!dossier) return false;
  
  return dossier.email_verified && (
    dossier.papers?.length > 0 ||       // Has publications
    dossier.research_areas?.length > 0 ||  // Has research areas
    !!dossier.department                // Has department
  );
}

// If not useful:
if (!hasUsefulData(dossier)) {
  updateState(item.id, 'failed', { 
    error: 'Research failed - no verified professor data found' 
  });
  return;  // STOP - Email NOT sent
}
```

### 2. Email Generation Verification

```javascript
// After generateEmail():
if (!email.pass || !email.interestLine || email.interestLine.length < 20) {
  updateState(item.id, 'failed', { 
    error: 'Email generation failed self-check - weak personalization' 
  });
  return;  // STOP - Email NOT sent
}

// email.pass is set by AI based on:
// - Interest line is specific and personalized
// - Not generic or template-like
// - Properly references professor's work
```

### 3. Template Placeholder Verification

```javascript
// Backend checks before drafting:
const tplRow = db.prepare(
  'SELECT raw_html, instructions FROM template WHERE id=1'
).get();

if (!tplRow?.raw_html) {
  updateState(item.id, 'failed', { 
    error: 'No email template configured' 
  });
  return;
}

// Frontend validation when saving template:
function detectPlaceholders() {
  const html = templateRef.current.innerHTML;
  const hasLastName = html.includes('{{LAST_NAME}}');
  const hasInterest = html.includes('{{INTEREST_LINE}}');
  
  if (!hasLastName || !hasInterest) {
    setError('Template must contain {{LAST_NAME}} and {{INTEREST_LINE}}');
    return false;
  }
  return true;
}
```

### 4. Duplicate Prevention

```javascript
// Before queuing:
const alreadySent = db.prepare(
  'SELECT 1 FROM sent_log WHERE professor_email=?'
).get(email);

if (alreadySent) {
  skipped++;  // Don't queue
  continue;
}

// Check if already in queue:
const queued = db.prepare(
  'SELECT state FROM queue WHERE professor_id=?'
).get(profId);

if (queued.state === 'sent' || queued.state === 'skipped') {
  skipped++;  // Don't re-queue
  continue;
}
```

### 5. Gmail Connection Verification

```javascript
// Before sending:
const isConnected = await gmailService.isConnected();

if (!isConnected) {
  updateState(item.id, 'needs_review', { 
    error: 'Gmail not connected' 
  });
  return;  // STOP - Email NOT sent
}
```

### 6. Scheduled Draft Approval (Additional Layer)

```
For Scheduled Mode ONLY:
  
  1. Draft created → status='draft'
  2. User reviews draft preview
  3. User approves → status='approved'
  4. Only 'approved' drafts are sent at scheduled time
  
  ❌ Draft drafts are NEVER sent
  ❌ Cancelled drafts are NEVER sent
```

---

## 🎯 KEY DIFFERENCES SUMMARY

| Feature | Instant Mode | Scheduled Mode |
|---------|--------------|----------------|
| **Research timing** | Immediate during import | Background after batch creation |
| **Send timing** | Immediate after drafting | At scheduled date/time |
| **User approval** | Optional ("Proceed Now" for single) | Required (must approve drafts) |
| **Queue state** | pending → researching → drafted → verified → sent | Not used (uses scheduled_drafts table) |
| **Email preview** | No preview before send | Full HTML preview before approval |
| **Edit capability** | Cannot edit generated email | Can edit subject & interest_line |
| **Batch management** | No batches (individual queue items) | Multiple batches with tracking |
| **Storage** | queue + professors tables | scheduled_batches + scheduled_drafts tables |

---

## 📈 TOKEN USAGE & COST

### Per Professor Cost

**Instant Mode (3-Agent System):**
```
Agent 1 (deepseek @ Qwen1): ~800 tokens
Agent 2 (Qwen3.7 @ Qwen2): ~1200 tokens
Email Generation: ~300 tokens
─────────────────────────────────────
Total: ~2300 tokens per professor
Cost: ~75% cheaper than old Gemini-only system
```

**Scheduled Mode (Same research + Draft storage):**
```
Research: ~2000 tokens (same as Instant)
Draft generation: ~300 tokens
Draft stored in DB (not regenerated)
─────────────────────────────────────
Total: ~2300 tokens per professor
+ Storage overhead: Draft HTML in database
```

### Token Pool

- **Qwen API 1**: 15M tokens (deepseek search)
- **Qwen API 2**: 83M tokens (Qwen processing)
- **Total**: 98M tokens
- **Capacity**: ~42,600 professors

---

## 🛡️ ERROR HANDLING & RECOVERY

### Self-Healing Queue
```
Every 30 seconds:
  - Find items stuck in 'researching/drafted/verified' > 5 minutes
  - Reset to 'pending'
  - Increment heal_count
  - If heal_count >= 3 → Mark as 'failed'
```

### Retry Logic
```
Email generation failed → retry_count++
If retry_count < 3:
  - Wait exponentially (2^retry_count seconds)
  - Retry
Else:
  - Mark as 'failed'
```

### Network Failures
```
AI API timeout → Try next model in rotation
Gmail API failure → Mark as 'needs_review'
Scraper blocked → Skip professor, continue with others
```

---

## 🔍 VERIFICATION SUMMARY

**5 Verification Gates Before Send:**

1. ✅ **Research Quality**: `hasUsefulData(dossier)` - Must have papers/research_areas/department
2. ✅ **Email Generation**: `email.pass === true` - AI self-check for personalization
3. ✅ **Interest Line**: `interest_line.length >= 20` - Minimum quality threshold
4. ✅ **Template Valid**: Contains `{{LAST_NAME}}` and `{{INTEREST_LINE}}`
5. ✅ **Duplicate Check**: Not in `sent_log`, not already 'sent' in queue

**Scheduled Mode: +1 Extra Gate**
6. ✅ **User Approval**: Draft status must be 'approved' (manual review)

---

## 💾 DATABASE STATES

### Queue State Machine (Instant)
```
awaiting_proceed → pending → researching → drafted → verified → sending → sent
                      ↓                                               ↓
                   failed ← ─────────────────────────────────── needs_review
                      ↓
                   skipped (if duplicate)
```

### Scheduled Draft State Machine
```
draft → approved → sent
  ↓        ↓
cancelled ←┘
  ↓
failed
```

### Batch State Machine
```
pending → processing → completed
  ↓           ↓
cancelled    failed
```

---

This is the **COMPLETE, TRUE, VERIFIED** flow of both Instant and Scheduled modes based on actual source code analysis.
