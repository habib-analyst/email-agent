# ✅ Excel Sheet-Centric Workflow - Complete Implementation

## Overview

Implemented a complete **Excel-first workflow** where the professor roster sheet is the **single source of truth** for all operations.

---

## Core Principle

```
EVERYTHING FLOWS THROUGH THE EXCEL SHEET
```

1. **Import** → Add emails to sheet
2. **Research** → Fill sheet columns with professor data
3. **Verify** → Check sheet completeness
4. **Generate** → Create emails from sheet data
5. **Send** → Send emails one-by-one with verification

---

## Key Features

### ✅ 1. Fallback Mode Toggle

**Default:** Disabled
**When Enabled:**
- Subject: "Seeking an MS/PhD Position in Your Lab" (no keyword)
- Interest line: Removed
- Used only after user verification if research fails

**When Disabled:**
- Subject: "[Keyword] Seeking an MS/PhD Position in Your Lab"
- Interest line: 20 words max
- Full research required

### ✅ 2. Modern Paste Email Section

**Accepts:**
- Just emails: Agent researches everything
- Emails + names: Agent fills research only
- Emails + names + keywords + interest lines: Agent uses provided data

**Format:**
```json
{
  "emails": ["prof@mit.edu"],
  "fallbackEnabled": false,
  "providedData": {
    "prof@mit.edu": {
      "name": "John Smith",
      "subject_keyword": "Machine Learning",
      "interest_line": "I am interested in your work on neural networks",
      "university": "MIT",
      "department": "Computer Science"
    }
  }
}
```

### ✅ 3. Research with Retry & Verification

- Max 3 attempts per professor
- Agent 1 (Qwen API 1): Web search
- Agent 2 (Qwen API 2): Process data
- Fallback to Gemini only if both fail
- **No fallback emails without user verification**

### ✅ 4. Sheet Validation

Before sending, verifies each row has:
- ✅ Full name (min 3 chars)
- ✅ Valid email
- ✅ Research interest OR department

### ✅ 5. Email Generation with Limits

- Interest line: **Max 20 words**
- Subject keyword: Required (unless fallback mode)
- Last name: Extracted from email
- Verification before send: Optional toggle

### ✅ 6. One-by-One Email Sending

- Each email can be verified before sending
- Tracks sent/failed/awaiting status
- Updates sheet in real-time
- Logs to sent_log table

---

## Excel Sheet Structure

### Columns

| Column | Description | Required |
|--------|-------------|----------|
| `full_name` | Professor's full name | ✅ Yes |
| `email` | Email address | ✅ Yes |
| `university` | University name | No |
| `department` | Department | No |
| `designation` | Title (Professor, etc.) | No |
| `research_interest` | Research areas (comma-separated) | ✅ Yes* |
| `subject_keyword` | Email subject keyword | No |
| `interest_line` | Personalized interest line | No |
| `profile_url` | Faculty page URL | No |
| `email_verified` | yes/no | No |
| `queue_state` | Current state | Auto |
| `research_status` | not_started/complete/failed | Auto |
| `research_attempts` | Attempt count | Auto |
| `fallback_mode` | enabled/disabled | Auto |
| `error_reason` | Last error message | Auto |
| `last_updated` | ISO timestamp | Auto |

*Research interest OR department required

---

## Workflow States

### Queue States

```
pending_research → ready_for_email → awaiting_verification → ready_to_send → sent
                        ↓
              email_generation_failed
                        ↓
                  send_failed
```

### Research Status

```
not_started → complete
            ↓
        incomplete
            ↓
          failed (after 3 attempts)
```

---

## API Endpoints

### Import Emails

**POST** `/api/sheet/import-emails`

```json
{
  "emails": ["prof1@mit.edu", "prof2@stanford.edu"],
  "fallbackEnabled": false,
  "providedData": {
    "prof1@mit.edu": {
      "name": "John Smith",
      "subject_keyword": "Machine Learning",
      "interest_line": "I am interested in your neural network research"
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "added": 2,
  "total": 2,
  "sheetPath": "/path/to/professor-roster.xlsx",
  "message": "Added 2 professors to Excel sheet"
}
```

---

### Research Professors

**POST** `/api/sheet/research`

Starts research in background, fills sheet with data.

```json
{
  "maxAttempts": 3,
  "batchSize": 10
}
```

**Response:**
```json
{
  "success": true,
  "message": "Research started in background"
}
```

**Progress Events:** `sheet_research_progress`, `sheet_research_complete`

---

### Verify Sheet

**GET** `/api/sheet/verify`

Check if sheet is complete.

**Response:**
```json
{
  "total": 10,
  "complete": 8,
  "incomplete": 1,
  "failed": 1,
  "ready": 8,
  "allComplete": false,
  "issues": [
    {
      "email": "prof@mit.edu",
      "missing": ["research_interest or department"]
    }
  ]
}
```

---

### Generate Emails

**POST** `/api/sheet/generate-emails`

Generate emails from sheet data.

```json
{
  "verifyBeforeSend": true,
  "maxInterestWords": 20
}
```

**Response:**
```json
{
  "success": true,
  "generated": 8,
  "verified": 0,
  "failed": 0,
  "sheetPath": "/path/to/professor-roster.xlsx",
  "message": "Generated 8 emails"
}
```

---

### Send Emails

**POST** `/api/sheet/send-emails`

Send emails one-by-one.

```json
{
  "verifyEach": true
}
```

**Response:**
```json
{
  "success": true,
  "sent": 5,
  "failed": 0,
  "awaitingVerification": 3,
  "sheetPath": "/path/to/professor-roster.xlsx",
  "message": "Sent 5 emails"
}
```

---

### Get Sheet Status

**GET** `/api/sheet/status`

Get current sheet statistics.

**Response:**
```json
{
  "success": true,
  "sheetPath": "/path/to/professor-roster.xlsx",
  "stats": {
    "total": 10,
    "byStatus": {
      "complete": 8,
      "incomplete": 1,
      "failed": 1
    },
    "byState": {
      "ready_for_email": 8,
      "pending_research": 1,
      "research_failed": 1
    },
    "fallbackEnabled": 2,
    "awaitingVerification": 3,
    "readyToSend": 5
  },
  "recentRows": [...]
}
```

---

### Get Sheet Data

**GET** `/api/sheet/data`

Get all sheet rows.

**Response:**
```json
{
  "success": true,
  "rows": [...],
  "count": 10,
  "sheetPath": "/path/to/professor-roster.xlsx"
}
```

---

### Complete Workflow

**POST** `/api/sheet/workflow/complete`

Run all steps: import → research → generate → (send)

```json
{
  "emails": ["prof1@mit.edu", "prof2@stanford.edu"],
  "fallbackEnabled": false,
  "providedData": {},
  "verifyBeforeSend": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "Complete workflow started in background"
}
```

**Progress Events:**
- `sheet_workflow_progress` (phase: imported/researched/verified/generated/sent)
- `sheet_workflow_complete`
- `sheet_workflow_error`

---

## Usage Examples

### Example 1: Simple Email Import

```bash
curl -X POST http://localhost:3001/api/sheet/import-emails \
  -H "Content-Type: application/json" \
  -d '{
    "emails": ["prof1@mit.edu", "prof2@stanford.edu"],
    "fallbackEnabled": false
  }'
```

Agent will:
1. Add emails to sheet
2. Research each professor (3 agents)
3. Fill sheet with complete data

---

### Example 2: Import with Provided Data

```bash
curl -X POST http://localhost:3001/api/sheet/import-emails \
  -H "Content-Type: application/json" \
  -d '{
    "emails": ["prof@mit.edu"],
    "fallbackEnabled": false,
    "providedData": {
      "prof@mit.edu": {
        "name": "John Smith",
        "subject_keyword": "Machine Learning",
        "interest_line": "I am interested in your neural network research",
        "university": "MIT",
        "department": "Computer Science"
      }
    }
  }'
```

Agent will:
1. Add to sheet with provided data
2. Skip research (data already provided)
3. Mark as ready_for_email

---

### Example 3: Fallback Mode Enabled

```bash
curl -X POST http://localhost:3001/api/sheet/import-emails \
  -H "Content-Type: application/json" \
  -d '{
    "emails": ["prof@mit.edu"],
    "fallbackEnabled": true
  }'
```

If research fails after 3 attempts:
- Subject: "Seeking an MS/PhD Position in Your Lab"
- No keyword
- No interest line
- **Requires user verification before sending**

---

### Example 4: Complete Workflow

```bash
curl -X POST http://localhost:3001/api/sheet/workflow/complete \
  -H "Content-Type: application/json" \
  -d '{
    "emails": ["prof1@mit.edu", "prof2@stanford.edu"],
    "fallbackEnabled": false,
    "verifyBeforeSend": true
  }'
```

Runs all steps automatically:
1. Import to sheet
2. Research all professors
3. Verify sheet completeness
4. Generate emails
5. Wait for user verification (verifyBeforeSend: true)

---

## Verification Flow

### Research Verification

After 3 failed attempts:
1. Mark as `research_failed`
2. Set `fallback_mode: 'enabled'` (if toggled)
3. **Wait for user verification**
4. Do NOT auto-send fallback emails

### Email Verification

Before sending each email:
1. Check `verifyBeforeSend` setting
2. If true, mark as `awaiting_verification`
3. Wait for user approval
4. Only send after explicit approval

### No Auto-Fallback Rule

```
CRITICAL: Never send fallback emails without user verification
```

Even if fallback mode is enabled:
- Research must fail 3 times
- User must explicitly approve
- No automatic fallback sends

---

## Error Handling

### Research Errors

**Attempt 1-2:** Retry automatically
**Attempt 3:** Mark as failed, require user decision

```json
{
  "research_status": "failed",
  "research_attempts": 3,
  "error_reason": "All research methods exhausted",
  "queue_state": "research_failed"
}
```

### Email Generation Errors

Mark as `email_generation_failed`, log error:

```json
{
  "queue_state": "email_generation_failed",
  "error_reason": "Weak personalization - no research data"
}
```

### Send Errors

Mark as `send_failed`, log error:

```json
{
  "queue_state": "send_failed",
  "error_reason": "Gmail API rate limit exceeded"
}
```

---

## Sheet Monitoring

### Watch Sheet Updates

```bash
# Get current status
curl http://localhost:3001/api/sheet/status

# Get full data
curl http://localhost:3001/api/sheet/data

# Verify completeness
curl http://localhost:3001/api/sheet/verify
```

### Real-Time Events

Subscribe to SSE events:
- `sheet_import` - Emails added to sheet
- `sheet_research_progress` - Research in progress
- `sheet_research_complete` - Research finished
- `sheet_email_gen_progress` - Generating emails
- `sheet_email_gen_complete` - Generation finished
- `sheet_send_progress` - Sending emails
- `sheet_send_complete` - Sending finished

---

## Summary

### ✅ Implemented Features

1. ✅ Excel sheet as single source of truth
2. ✅ Import with fallback toggle (default: disabled)
3. ✅ Modern paste section (emails + optional data)
4. ✅ Three-agent research (Qwen1 → Qwen2 → Gemini)
5. ✅ Research retry (max 3 attempts)
6. ✅ Sheet validation before email generation
7. ✅ Interest line limit (20 words max)
8. ✅ Email verification before sending
9. ✅ One-by-one email sending
10. ✅ No auto-fallback without user verification
11. ✅ Complete workflow orchestration
12. ✅ Real-time progress events
13. ✅ Comprehensive error handling
14. ✅ Sheet status monitoring

### Workflow Guarantees

- ✅ All operations flow through Excel sheet
- ✅ Sheet is always up-to-date
- ✅ Each row tracked from import → sent
- ✅ No emails sent without verification
- ✅ Fallback only with user approval
- ✅ Research errors logged and retried
- ✅ Complete audit trail in sheet

**The Excel sheet controls everything. The agent strictly fills the sheet, verifies it, and only sends after confirmation.** ✅
