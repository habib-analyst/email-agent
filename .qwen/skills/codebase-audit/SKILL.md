---
name: codebase-audit
description: Comprehensive codebase audit for improvement opportunities — read specs, explore in parallel, categorize findings by severity with file/line references
source: auto-skill
extracted_at: '2026-06-10T20:07:38.862Z'
---

# Codebase Improvement Audit

Use this method when the user asks "what can we improve", "analyze this project", or "find issues" — a comprehensive audit producing categorized, actionable findings.

## Method

### Step 1 — Read the specs first
Before touching code, read any plan/spec/README docs from the `.md files/` folder (e.g., `*_PLAN.md`, `CLAUDE.md`, `AGENT_FLOW.md` — all located at `D:\email-agent\.md files/`). This tells you what the system *should* be so you can spot intent-vs-implementation gaps.

### Step 2 — Parallel exploration
Launch two sub-agents simultaneously:
- **Backend agent**: read every module (server, routes, pipeline, DB, AI, auth, gmail, research, config, utils, middleware, services). Look for error handling, security, race conditions, missing implementations vs spec, hardcoded values.
- **Frontend agent**: read all pages, components, API layer, hooks, context. Look for missing error/loading/empty states, missing features vs spec, hardcoded values.

Give each agent a *detailed* prompt specifying exactly what to look for (not a vague "explore the codebase"). Request file paths and line references.

### Step 3 — Fall back to direct reads on failure
If a sub-agent fails (token errors, timeouts, auth issues), switch to reading files directly yourself — in parallel batches of 5-8 files. Start with the most critical modules (server, pipeline, AI, gmail, routes) then fan out to utilities and services.

### Step 4 — Categorize findings
Organize into severity tiers with emoji markers:

| Tier | Icon | What goes here |
|------|------|----------------|
| Security | 🔴 | Data leaks, exposed secrets, encryption weaknesses, hardcoded credentials |
| Reliability | 🟠 | Race conditions, crash resilience, tight loops, missing graceful shutdown |
| Architecture | 🟡 | Design flaws, naming conflicts, missing abstractions, tech debt |
| Feature Gaps | 🟢 | Spec says X but code doesn't have it |
| Quick Wins | 🔵 | Low-effort/high-impact fixes (gitignore, logging, timeouts) |

Each finding must include:
- Specific file path and line/function reference
- Why it matters (impact if not fixed)
- What the fix looks like

### Step 5 — Prioritize
End with a ranked priority list. Put data leaks and crash risks at the top, feature gaps and quick wins at the bottom.

## Key Files to Always Check

For a Node.js/Express backend: `server.js`, `config/`, `db/`, routes, pipeline/worker, AI module, auth, external API calls, `.gitignore`.

For a React frontend: `App.jsx`, `api.js`, pages, context providers, SSE/event handling.

## Anti-patterns to Avoid

- Don't just list what files exist — that's a directory tree, not an audit
- Don't comment on code style or formatting unless it causes bugs
- Don't suggest "rewrite in X" — focus on surgical fixes
- Don't recommend adding features the user didn't ask for