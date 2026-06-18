# Email Agent — Senior Production Spec (Fully Automated 24/7, Zero-Touch)

**MANDATORY:** Read `.md files/CLAUDE.md` first. Then this file. Follow simplicity-first, surgical edits, goal-driven verify steps. This spec lets Claude Opus 4.6 / equivalent build the complete system with minimal tokens.

**Goal:** 5-min setup → agent runs forever, sends exactly as user would, zero manual work. All defaults pre-seeded. Self-improving via replies.

---

## 0. Token-Saving Rules for Implementer (Read Once)

- Implement only what is here. No extra files, no abstractions, no "nice-to-haves".
- Use exact function names, prompts, and schema below.
- Every code block is "COPY THIS" — keep snippets <15 lines.
- Verify each numbered gate in §11 before next.
- Output only production code; no comments unless non-obvious.

---

## 1. Product Requirements (Exact)

**Must-have (user spec + robustness):**
- Gmail OAuth once (scopes: send, readonly, modify).
- One-time template: pick sent email → store raw HTML "Dear..." to signature → auto-detect `{{LAST_NAME}}` + `{{INTEREST_LINE}}` via Gemini → confirm once.
- Input: emails (one/line) OR faculty URL → scrape all profiles + every link inside (Scholar, LinkedIn, lab, papers) → dossier.
- Per professor: research → 3 changes only (subject `[Topic]`, last name, interest line citing real work) → clone HTML byte-for-byte → attach resume (auto-found) → auto-verify → send in recipient business hours + random delay.
- Global dedupe (never re-email).
- Inbox watch every 30 min → classify replies → no follow-up to repliers; optional 1× polite follow-up after 7 days.
- Full log + weekly digest.

**Non-functional:**
- Worker self-heals, resumes from SQLite on crash/reboot.
- One professor at a time (Gmail safety).
- 3× retry + backoff on every external call.
- Tokens encrypted at rest.
- Windows service (NSSM/PM2).
- Structured logs + `/health`.

**Zero manual after setup:** Only 3 initial actions. `needs_review` auto-skips after 1 retry.

---

## 2. Bootstrap (Instant Seeding — No Config)

First start:
1. `.env` missing → copy `.env.example`, ask only for Google keys + Gemini key (all others pre-filled).
2. SQLite + migrations + seed `settings` (15 defaults, see §9).
3. Auto-find resume: `D:\email-agent\Resume\*Habib*.pdf` or newest → store path.
4. Gmail profile fetch → store user name/email.
5. Start worker immediately.
6. 3-screen wizard: Connect → Pick template (placeholders auto-highlighted) → Paste emails/URL → Done.

Result: paste 50 emails, close laptop, agent works 24/7.

---

## 3. Folder & State Machine (Exact)

```
email-agent/
├── backend/src/{config,db,auth,gmail,research,ai,pipeline,learning,routes}/index.js
├── frontend/ (Vite+React+Tailwind, pages: Dashboard,Connect,Template,Professors,Queue,Replies,Logs,Settings)
├── Resume/Habib_Ur_Rehman_Resume.pdf
├── EMAIL_AGENT_PLAN.md, CLAUDE.md, README.md
```

State (queue table): `pending → researching → drafted → verified → scheduled → sent | failed | needs_review | replied`

Atomic transitions. Worker never blocks >5 min per item.

---

## 4. DB Schema (Copy Exact — 1 Migration)

```sql
CREATE TABLE professors (id INTEGER PRIMARY KEY, email TEXT UNIQUE, last_name TEXT, university TEXT, research_areas TEXT, dossier TEXT, source_url TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE queue (id INTEGER PRIMARY KEY, professor_id INTEGER, state TEXT DEFAULT 'pending', subject TEXT, interest_line TEXT, verification_result TEXT, scheduled_for DATETIME, sent_at DATETIME, error TEXT, retry_count INTEGER DEFAULT 0);
CREATE TABLE sent_log (id INTEGER PRIMARY KEY, professor_email TEXT, subject TEXT, message_id TEXT, sent_at DATETIME, follow_up_sent BOOLEAN DEFAULT 0);
CREATE TABLE replies (id INTEGER PRIMARY KEY, thread_id TEXT, professor_email TEXT, classification TEXT, summary TEXT, received_at DATETIME);
CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), resume_path TEXT, daily_cap INTEGER DEFAULT 25, min_delay_min INTEGER DEFAULT 3, max_delay_min INTEGER DEFAULT 10, send_window TEXT DEFAULT '09:00-17:00', followup_days INTEGER DEFAULT 7, auto_send BOOLEAN DEFAULT 1, last_digest_sent DATE);
CREATE TABLE learning_stats (topic TEXT PRIMARY KEY, sends INTEGER DEFAULT 0, replies INTEGER DEFAULT 0, positive_replies INTEGER DEFAULT 0, last_used DATETIME);
CREATE TABLE template (id INTEGER PRIMARY KEY CHECK(id=1), raw_html TEXT, last_name_placeholder TEXT, interest_line_placeholder TEXT);
```
Indexes: email, state, scheduled_for. Use prepared statements only.

---

## 5. Gemini Prompts (Exact — Copy)

Model: `gemini-1.5-flash`, temp 0.2, JSON mode.

**generateTopicAndInterest(dossier, resume, topTopics)**
```
System: "Expert academic outreach writer. JSON only."
User: `Dossier: ${dossier}\nResume: ${resume}\nTop topics: ${topTopics}\n→ {"topic":"Human-Centered AI","interestLine":"I am particularly interested in your work on ..."}`
```

**verifyDraft(subject, lastName, interest, dossier, email)**
→ `{"pass":bool,"reasons":[]}`

**classifyReply(body)** → `{"classification":"positive|negative|auto_reply|other","summary":"..."}`

**detectPlaceholders(html)** → `{"lastName":"X","interestLine":"Y"}`

---

## 6. Core Automation Logic (Exact Snippets — Implement These)

### 6.1 Worker Loop (pipeline/worker.js — Heart of 24/7)
```js
import cron from 'node-cron';
import { getNext, updateState, delay } from './queue.js';
import { research } from '../research/index.js';
import { generate, verify } from '../ai/index.js';
import { send } from '../gmail/index.js';
import { classifyReplies } from '../gmail/replies.js';

cron.schedule('*/30 * * * *', classifyReplies); // replies
cron.schedule('0 0 * * *', weeklyDigest);

async function runWorker() {
  while (true) {
    const item = await getNext(); // pending + scheduled_for <= now + within window
    if (!item) { await delay(60000); continue; }
    try {
      await updateState(item.id, 'researching');
      const dossier = await research(item.email); // scrape + follow links
      const { topic, interestLine, lastName } = await generate(dossier);
      const subject = `[${topic}] Seeking an MS/PhD Position in Your Lab`;
      await updateState(item.id, 'drafted', { subject, interestLine });
      const v = await verify(subject, lastName, interestLine, dossier, item.email);
      if (!v.pass) { await autoFixOrSkip(item, v); continue; }
      await updateState(item.id, 'verified');
      const sendAt = scheduleInWindow(item); // recipient tz
      await updateState(item.id, 'scheduled', { scheduled_for: sendAt });
      await delay(random(3*60*1000, 10*60*1000));
      await send(item); // clone template HTML, replace 2 placeholders, attach resume
      await updateState(item.id, 'sent');
      await logSent(item);
    } catch (e) { await handleError(item, e); }
  }
}
runWorker(); // starts on boot
```

### 6.2 HTML Template Clone (No Style Loss — Critical)
```js
// gmail/send.js
import { google } from 'googleapis';
async function send(item) {
  const tpl = db.prepare('SELECT raw_html FROM template').get().raw_html;
  let html = tpl
    .replace(/\{\{LAST_NAME\}\}/g, item.lastName)
    .replace(/\{\{INTEREST_LINE\}\}/g, item.interestLine);
  // exact string replace on raw HTML — fonts, colors, spacing unchanged
  const mime = buildMimeWithPdf(html, resumePath, item.email, item.subject);
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: mime } });
}
```

### 6.3 Scheduler + Window Logic
```js
function scheduleInWindow(item) {
  const tz = getTzFromUniversity(item.university); // simple map
  const now = new Date();
  const window = settings.send_window.split('-'); // '09:00-17:00'
  // compute next business hour in tz, add random minutes
  return nextSlot;
}
```

### 6.4 Retry Wrapper (Every External Call)
```js
async function withRetry(fn, max=3) {
  for (let i=0; i<max; i++) {
    try { return await fn(); } catch(e) { if (i===max-1) throw e; await delay(1000*2**i); }
  }
}
```

### 6.5 State Transition + Dedupe
```js
function updateState(id, state, data={}) {
  db.prepare('UPDATE queue SET state=?, ... WHERE id=?').run(state, ...data, id);
  if (state==='sent') db.prepare('INSERT INTO sent_log ...').run(...);
}
```
Dedupe check: `SELECT 1 FROM sent_log WHERE professor_email=?` before research.

### 6.6 Reply Watcher + Learning
Every 30 min: list threads since last check → match to sent_log → Gemini classify → INSERT replies → UPDATE learning_stats (topic, positive_replies++).

Weekly: compute best topics → store in learning_stats for next generate prompt.

---

## 7. Research Logic (research/index.js)
- If faculty URL: cheerio scrape all `<a>` to professor profiles.
- Per profile: follow every link (Scholar, LinkedIn, lab, papers) with axios/Playwright fallback.
- Build dossier JSON: {name, email, university, papers:[{title,year}], scholar_url, linkedin, research_areas}.
- Use withRetry on every fetch.

---

## 8. Frontend (Minimal Pages — Tailwind Cards)
Dashboard (SSE live queue + stats), Connect (OAuth button), Template (list sent → iframe preview → confirm), Professors (paste + extract), Queue (dossier + preview + verify result), Replies (classified list), Logs, Settings (pre-filled defaults).

SSE: `/queue/stream` pushes state changes.

---

## 9. Defaults (Pre-Seeded on First Run)
settings row: resume_path=auto, daily_cap=25, min/max_delay=3/10, send_window=09:00-17:00, followup_days=7, auto_send=1, last_digest_sent=today-7.

---

## 10. Automation Flow (Numbered — Follow Exactly)

1. Bootstrap seeds everything, starts worker.
2. User pastes emails/URLs → INSERT professors + queue (pending).
3. Worker pops pending → research (scrape + links) → dossier.
4. Gemini → topic + interestLine + lastName.
5. Build subject, clone HTML (exact replace), attach resume.
6. Verify (programmatic + Gemini) → pass or 1× auto-fix → still fail = needs_review (skip).
7. Schedule in recipient window + random delay.
8. Send → log → update learning.
9. Every 30 min: watch replies → classify → never follow-up repliers.
10. If no reply + 7 days + setting ON → 1× follow-up in thread.
11. Weekly: digest + best-topic injection into prompts.

---

## 11. Verification Gates (Goal-Driven — Pass Before Next)

1. DB + seed → verify: 15 defaults, indexes.
2. OAuth + raw HTML send to self with PDF → verify: received HTML identical except placeholders.
3. Template capture + detect → verify: stored HTML byte-match, placeholders correct.
4. Research on real faculty URL → verify: ≥5 profs, ≥3 links each, structured dossier.
5. End-to-end 2 test emails (own addresses) → verify: research→draft→verify→send→reply classified→stats updated, no dupes.
6. Scheduler/delay/cap → verify with 3 test sends.
7. Frontend + SSE → verify pages render live data.
8. Service + reboot → verify: worker resumes queue.

**Done when all 8 pass on clean Windows machine.**

---

## 12. Deliverables

- Full backend + frontend implementing exactly §3-8.
- README: 5-min setup, Google/Gemini keys, NSSM service commands, log monitoring.
- No unused code. Every line traceable to this spec.

This is the complete, low-token contract. Build it once, verify gates, ship a system that runs 24/7 forever.