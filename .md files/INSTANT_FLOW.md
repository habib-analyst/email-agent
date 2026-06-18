# Complete Instant Page Flow — All Modes, Import, Cards

## 🏗️ Component Hierarchy

```
App.jsx
  SessionProvider (global state: stats, queue, template, settings, auth)
    EventStreamProvider (SSE hub via EventSource → /api/queue/stream)
      Instant.jsx (main page, 1168 lines)
        ├── Import Section (url / paste / file tabs)
        ├── AgentFlowBar (5-step pipeline visualizer)
        ├── Queue Table (cards for each professor)
        ├── ApprovalCard (manual mode only)
        ├── GmailComposeChrome (live email preview/edit)
        ├── BatchScrapeProgress (import progress bar)
        ├── LiveFeed (SSE event stream)
        ├── AnalyticsPanel (KPI cards)
        └── RosterPanel (professor data table)
```

---

## 🔄 State Lifecycle (Every Professor/Card)

Each queue item flows through these states:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    INSTANT MODE — AUTO SEND                         │
│                                                                     │
│  pending ──→ researching ──→ drafted ──→ verified ──→ sending ──→ sent │
│                                                                     │
│                    INSTANT MODE — MANUAL APPROVAL                   │
│                                                                     │
│  pending ──→ researching ──→ drafted ──→ verified                  │
│       ──→ awaiting_proceed ──→ [user approves] ──→ pending         │
│       ──→ sending ──→ sent                                          │
│                                                                     │
│                    FAILURE PATHS                                     │
│                                                                     │
│  any ──→ failed (AI error / Gmail error / exhausted retries)        │
│  any ──→ skipped (duplicate email / user rejected)                  │
│  any ──→ needs_review ──→ pending (auto-retry)                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Card colors by state:**

| State | Color | Meaning |
|-------|-------|---------|
| `pending` | amber | Queued, waiting for agent |
| `awaiting_proceed` | violet | Paused for user approval |
| `researching` | blue | Agent scraping profile |
| `drafted` | purple | AI drafted email |
| `verified` | indigo | Email verified & ready |
| `sent` | emerald | Successfully sent |
| `failed` | red | Error (can retry) |
| `skipped` | slate | Duplicate / rejected |
| `needs_review` | orange | Needs retry |

---

## 📥 Import Flow — 3 Tabs

### **URL Tab** (Faculty Page Scrape)

```
User enters URL ──→ POST /api/professors {url, mode:'instant'}
  │
  ├── Backend: scrapeFacultyPage(url)
  │     ├── Fetch HTML (static → Puppeteer fallback)
  │     ├── Extract emails + names via Cheerio
  │     ├── Pagination crawl (if pages found)
  │     ├── Profile link matching
  │     └─→ SSE: scrape_progress events
  │
  ├── For each professor:
  │     ├── extractProfessorContext($, email) → name + lastName + department
  │     ├── parseFullName(name, emailLocal) → robust name parsing
  │     ├── verifyNameWithEmail() → confirm name matches email
  │     └─→ INSERT professors + queue (state='pending', fast_track=1)
  │
  ├── SSE: scrape_complete → frontend loadSession()
  │
  └─→ Worker auto-starts: picks pending items → researching
        │
        ├── threeAgentResearch(email, sourceUrl, profileUrl)
        │     ├── Attempt 1: scrape profile + AI enrichment
        │     ├── Attempt 2: re-scrape source page for links
        │     ├── Attempt 3: AI-only fallback
        │     └─→ Returns: dossier {name, last_name, research_areas, papers}
        │
        ├── generateEmail(dossier, instructions, ...)
        │     ├── If has ≥3 papers + research_areas → extractAccurateKeywords
        │     │     ├── AI attempt 1: constrained prompt
        │     │     ├── Validate keywords against source text
        │     │     ├── AI attempt 2: tighter constraints
        │     │     └─→ Fallback: local TF-IDF bigram/trigram extraction
        │     ├── Else → generateFromInstructions (standard AI prompt)
        │     └─→ Returns: {topic, interestLine, pass}
        │
        ├── Subject = [topic] Seeking MS/PhD Position
        ├── Preview HTML: template + {{LAST_NAME}} + {{INTEREST_LINE}}
        │
        └─→ SSE: compose_update → GmailComposeChrome shows live preview
              SSE: state_change → queue card updates color/state
              SSE: progress → AgentFlowBar highlights current step
              SSE: sent → card turns emerald, analytics update
```

### **Paste Tab** (Direct Emails)

```
User pastes emails ──→ POST /api/professors {emails, mode:'instant'}
  │
  ├── SINGLE EMAIL:
  │     ├── Inline research → threeAgentResearch
  │     ├── generateEmail → draft email
  │     ├── State = awaiting_proceed
  │     └─→ Frontend: "Proceed Now" button appears
  │         └─→ POST /api/queue/:id/proceed → fast_track=1 → pending → auto-send
  │
  ├── MULTIPLE EMAILS:
  │     ├── Batch inline research
  │     ├── All items = pending + fast_track=1
  │     └─→ Worker auto-starts, processes all
```

### **File Tab** (Upload)

```
User uploads file ──→ POST /api/upload/preview
  │
  ├── Parse Excel/CSV/PDF/Word/TXT → extract emails
  ├── Frontend: FilePreview shows table/text preview
  │
  └─→ POST /api/upload/confirm {emails, mode:'instant'}
      │
      ├── Same flow as Paste tab (single vs batch)
      └─→ SSE: scrape_complete / batch_auto_start
```

---

## 🎯 Approval Modes

### **Auto Send** (default)

```
Queue item: pending → researching → drafted → verified → sending → sent
  No user intervention. Agent handles everything.
  GmailComposeChrome shows live preview during drafting.
```

### **Manual Review**

```
Queue item: pending → researching → drafted → verified → awaiting_proceed
  │
  ├── Frontend: ApprovalCard appears
  │     ├── View button → popup in VIEW mode (iframe, read-only)
  │     ├── Edit button → popup in EDIT mode (contentEditable div, identical styling)
  │     ├── Approve & Send → POST /api/queue/:id/approve → pending + fast_track
  │     └── Reject → POST /api/queue/:id/reject → skipped
  │
  └─→ After approval: pending → sending → sent
```

---

## 📊 Card Actions (Queue Table)

Each queue row has hover-revealed actions:

| Action | Button | API Call | When Visible |
|--------|--------|----------|-------------|
| **Proceed** | Zap icon | `POST /queue/:id/proceed` | `awaiting_proceed` items |
| **Send Now** | Send icon | `POST /queue/:id/send` | `verified` items |
| **Retry** | Refresh icon | `POST /queue/:id/retry` | `failed` / `skipped` items |
| **Delete** | Trash icon | `DELETE /queue/:id` | Non-`sent` items |
| **Edit** | Edit on card | `PUT /queue/:id/edit` | `verified` / `awaiting_proceed` / `drafted` |

---

## 🔄 SSE Event → Frontend Update Map

| SSE Event | Frontend Effect |
|-----------|----------------|
| `scrape_progress` | BatchScrapeProgress bar updates |
| `scrape_complete` | loadSession(), clear scrapeProgress, show roster |
| `agent_step` | AgentStepToast appears, AgentFlowBar highlights step |
| `state_change` | Queue card re-patches (color, state badge) |
| `compose_update` | GmailComposeChrome live preview updates |
| `progress` | Queue card patches, toast, scheduleRefresh |
| `sent` | Card → emerald, analytics refresh, roster sync |
| `skipped` | Card → slate |
| `reset` | Full state wipe, epoch bump |
| `gmail_connected` | loadSession() (auth status refresh) |

---

## ⚡ Worker Polling & Self-Heal

```
Worker loop (pipeline/index.js):
  ┌─ Poll every 500ms (active) / 3000ms (idle)
  │
  ├── getNext() → atomic claim (SELECT+UPDATE in transaction)
  │     Priority: preferredQueueId > fast_track > regular (by id)
  │
  ├── processQueueItem():
  │     ├── Daily cap check (local timezone)
  │     ├── Duplicate check (sent_log)
  │     ├── Fast-track shortcut (custom_html → skip research)
  │     ├── Template validation ({{LAST_NAME}}, {{INTEREST_LINE}})
  │     ├── Research → threeAgentResearch / researchProfessorForced
  │     ├── Generate → generateEmail → extractAccurateKeywords or generateFromInstructions
  │     ├── Approval gate → auto_send vs manual
  │     └─→ Send → Gmail API → sent_log → learning_stats → roster sync
  │
  ├── healStuckItems() every 30s:
  │     ├── Items stuck >30min → reset to pending (max 3 heals)
  │     └─→ retry_count ≥ 3 → mark failed
  │
  └─→ Loop continues until running=false or POST /api/agent/stop
```

---

## 🆕 Instant vs Scheduled — Key Differences

| Aspect | Instant | Scheduled |
|--------|---------|-----------|
| **Processing** | Continuous worker loop | Batch background processing |
| **Queue** | `queue` table (one per prof) | `scheduled_batches` + `scheduled_drafts` |
| **Research** | One-by-one in worker | 10 parallel per batch |
| **Approval** | `awaiting_proceed` gate | Explicit draft approval flow |
| **Send timing** | Immediate | Based on `scheduled_at` datetime |
| **Template** | `template WHERE mode='instant'` | `template WHERE mode='scheduled'` |
| **Edit** | Edit subject/interest/custom_html on queue item | Edit subject/interest on draft → auto-rebuild HTML |

---

## 🔗 API Endpoints (Instant Mode)

### Template
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/template/raw` | Save raw HTML / instructions / sample_subject |
| `POST` | `/api/template/detect` | AI-detect placeholders, wrap with `{{MARKERS}}` |
| `POST` | `/api/template/load-latest` | Load template from `Email_Template.txt` on disk |
| `POST` | `/api/template/load-by-recipient` | Search Gmail for sent email, extract HTML |
| `POST` | `/api/template` | Load template from Gmail message ID |
| `GET` | `/api/template` | Get current template (by mode) |
| `PUT` | `/api/template/instructions` | Update instructions and sample_subject |

### Gmail
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/gmail/sent` | List last 20 sent emails |
| `GET` | `/api/gmail/sent/latest` | Get HTML of latest sent email |

### Professors / Import
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/professors` | Import professors (URL scrape or emails). Single = awaiting_proceed; batch = pending + auto-start |
| `GET` | `/api/professors` | List professors (paginated, mode-filtered) |
| `DELETE` | `/api/professors/:id` | Delete professor + queue entries |

### Scrape
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/scrape/status` | Current scrape job status |
| `POST` | `/api/scrape/cancel` | Cancel active scrape job |

### Queue
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/queue` | List queue items (paginated, joins professor data) |
| `POST` | `/api/queue/clear-completed` | Remove sent/skipped items |
| `POST` | `/api/queue/:id/retry` | Reset failed item to pending |
| `POST` | `/api/queue/:id/send` | Move verified item to pending for immediate send |
| `POST` | `/api/queue/:id/approve` | Move to pending + fast_track=1 |
| `POST` | `/api/queue/:id/reject` | Move to skipped |
| `PUT` | `/api/queue/:id/edit` | Edit subject/interest_line/custom_html |
| `DELETE` | `/api/queue/:id` | Delete queue item (blocks if sent) |
| `POST` | `/api/queue/:id/proceed` | Resume awaiting_proceed item (fast_track + auto_send) |
| `GET` | `/api/queue/stream` | SSE endpoint for real-time state changes |

### Agent
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agent/stop` | Stop scrape job + worker loop |

### Stats / Monitoring
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/stats` | Queue state counts, reply count, today's sent |
| `GET` | `/api/api-usage` | AI token usage, call counts per model |
| `GET` | `/api/replies` | Classified Gmail replies |
| `GET` | `/api/health` | DB, worker, Gmail auth, AI fallback status |
| `GET` | `/api/bootstrap` | Full initial load (stats + queue + template + settings + auth + health + analytics + session) |
| `GET` | `/api/analytics` | Learning analytics |
| `GET` | `/api/session` | Session epoch + counts |

### Settings
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings` | Get settings (daily_cap, delays, auto_send, approval_mode) |
| `PUT` | `/api/settings` | Update settings |

### Roster
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/roster` | JSON roster rows |
| `GET` | `/api/roster.csv` | CSV download |
| `GET` | `/api/roster.xlsx` | Excel download (cached 30s) |
| `GET` | `/api/roster/sheet` | Read roster Excel data or build from DB |
| `POST` | `/api/roster/clear` | Clear roster Excel cache |

### Reset
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/reset` | Reset DB state by mode (or 'all' for full wipe). Bumps session epoch |

### Digest
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/digest` | Get weekly digest |
| `POST` | `/api/digest/run` | Run weekly digest computation |
