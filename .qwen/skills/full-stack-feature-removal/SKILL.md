---
name: full-stack-feature-removal
description: Systematically remove a feature across the full stack — pipeline logic, DB schema, routes, frontend, docs — without leaving orphaned references
source: auto-skill
extracted_at: '2026-06-11T13:27:51.197Z'
---

# Full-Stack Feature Removal

Use this method when the user says "remove X feature" or "get rid of X" where X spans backend + frontend + DB. The goal is zero remnants — no orphan code, no dead imports, no DB columns that crash queries.

## Procedure

### Step 1 — Find every reference
Search the entire project source (backend + frontend) for the feature name and all related terms. Use grep with variations (snake_case, camelCase, kebab-case, abbreviations). Also search `.md` docs.

### Step 2 — Remove in dependency order (bottom-up)
Remove references from the **most-dependent** layer first so the build never breaks mid-process:

1. **Frontend UI** — remove the component/section/field from JSX. Remove the import if the component becomes dead. Delete the orphan component file.
2. **Frontend state/API** — remove any API calls, state variables, or context fields that fetch/set the removed feature.
3. **Backend routes** — remove the field from request handlers and response objects. Remove any dedicated endpoints if the entire feature's API is gone.
4. **Pipeline/business logic** — remove conditionals, checks, and function calls that depend on the feature. Remove helper functions that only serve the feature.
5. **DB schema** — remove from CREATE TABLE (for fresh installs). Add `ALTER TABLE ... DROP COLUMN` migration for existing databases (wrap in try/catch since column may not exist on fresh DB). Remove from seed/INSERT statements. Remove from any UPDATE statements that set the column.
6. **Docs** — update documentation in the `.md files/` folder (e.g., `AGENT_FLOW.md` at `D:\email-agent\.md files\AGENT_FLOW.md`) that references the feature.

### Step 3 — Add a migration for existing DBs
SQLite doesn't auto-remove columns from existing databases. Add:
```js
try { db.exec('ALTER TABLE <table> DROP COLUMN <column>'); } catch {}
```
This must run **after** the CREATE TABLE block so new installs have the clean schema, and existing installs get the column dropped.

### Step 4 — Verify
- Run `vite build` (frontend) — must pass with no errors
- Check backend health endpoint — must return OK with no column-related errors
- Check settings/response endpoint — removed field must not appear in JSON output
- Grep the entire project source again for the feature name — only the intentional migration line should remain

## Key Rules

- **Never leave dead imports** — if removing a component, also remove its import line and delete the `.jsx` file if nothing else imports it
- **Never leave dead state variables** — if removing a frontend field, also remove the useState/useCallback that managed it
- **DB migrations must be try/catch** — DROP COLUMN on a fresh database (where the column never existed) throws. Swallow that error silently but log other failures
- **Don't remove the migration line** — even though it references the feature name, it's intentionally there for existing databases
- **Test the settings/response endpoint** — this is the fastest way to confirm the column is truly gone from runtime data