---
name: reset-auto-reseed
description: After clearing DB state on reset or DB corruption, immediately re-seed from the canonical source file so the system returns to a working default — never leave blank/null state. Also covers 0-byte DB recovery.
source: auto-skill
extracted_at: '2026-06-14T23:00:14.218Z'
---

# Reset Auto-Reseed Pattern

When a system has a "reset" or "clear session" feature that wipes DB rows (setting fields to NULL), the system must immediately **re-seed** from its canonical source so it returns to a usable default state — not a blank one. Also applies when the DB file itself is corrupted (0 bytes).

## The Problem

In this project, resetting the session set `template.raw_html = NULL`. The template only got re-populated at server startup via `seedBothModes()`. After an in-session reset, the template was blank until the next server restart. The instant mode had no auto-load trigger during workflow either — only the scheduled mode was reliably seeded.

This pattern applies to any system where:
- A canonical source file (e.g., `Email_Template.txt`) defines the default state
- Reset operations clear DB fields to NULL
- Auto-load/auto-seed triggers only run at startup or for one mode/path
- Users expect the system to work immediately after reset, not after a restart

## Critical Variant: 0-byte DB File (Complete Corruption)

When `SqliteError: no such column X` crashes the server repeatedly, and `ALTER TABLE ADD COLUMN` migrations are already in the code but still failing — **check the DB file size first**. If `data.db` is 0 bytes with no WAL/SHM files, the entire DB is lost. Migrations can't add columns to an empty file because the table itself doesn't exist.

**How this happens**: Server crash without WAL checkpoint, or the DB file being overwritten/truncated. `CREATE TABLE IF NOT EXISTS` in `db/index.js` won't modify an existing (even 0-byte) table, and the ALTER TABLE migrations target tables that don't exist yet.

**Fix**: Delete the 0-byte `data.db`, then restart the server. The `CREATE TABLE IF NOT EXISTS` statements create all tables fresh (since the file no longer exists), and the seed code populates defaults. All columns are correct from the start — no ALTER TABLE needed.

**Diagnostic checklist when "no such column" errors appear**:
1. `dir data.db*` — check file size (0 bytes = complete loss)
2. If 0 bytes + no WAL/SHM: delete `data.db` and restart server
3. If normal size: the ALTER TABLE migration code should handle it (check `alterTableSilent` function)
4. If migrations are present but columns still missing: verify `alterTableSilent` function is hoisted (must be a `function` declaration, not `const fn =` arrow)

## The Fix (3 parts)

### 1. Re-seed after every reset operation

```js
export function resetSessionData(db) {
  const wipe = db.transaction(() => {
    // ... clear all tables ...
    db.prepare(`UPDATE template SET raw_html=NULL, ... WHERE mode='instant'`).run(...);
    db.prepare(`UPDATE template SET raw_html=NULL, ... WHERE mode='scheduled'`).run(...);
  });
  wipe();

  // Immediately re-seed from canonical source — system is usable right away
  for (const mode of ['instant', 'scheduled']) {
    loadTemplateFromFile(mode);
  }
}
```

Same for mode-specific resets (`resetByMode`): re-seed the cleared mode only.

### 2. Auto-load seeds ALL modes, not just one

Previously `tryAutoLoadTemplate(source, mode = 'instant')` only seeded the requested mode. Change it to seed both modes when they're empty:

```js
async tryAutoLoadTemplate(source, mode = 'instant') {
  for (const m of ['instant', 'scheduled']) {
    const existing = db.prepare('SELECT raw_html FROM template WHERE mode=?').get(m);
    if (existing?.raw_html) continue; // already set
    loadTemplateFromFile(m);
  }
}
```

### 3. Remove template presence from "is cleared" checks

After re-seeding, `raw_html` will NOT be NULL, so `isSessionCleared()` can't check `!templateHtml`. The "cleared" check should only verify operational tables (queue, professors, sent_log, replies) are empty — the template being present is the desired default, not a sign of uncleared state.

## Verification Checklist

After implementing, verify:
1. **Reset → template present**: `POST /reset` then `GET /template?mode=instant` returns HTML with placeholders, not null
2. **Both modes identical**: `GET /template?mode=instant` and `GET /template?mode=scheduled` return the same `raw_html`
3. **Startup seeds**: Server restart also seeds both modes (existing `seedBothModes()` in server.js)
4. **Auto-load seeds both**: Any workflow trigger (proceed, batch import) seeds both modes, not just instant

## General Principle

**A reset should return the system to its default working state, not to a blank state.** If there's a canonical source that defines the default (a config file, a template file, seed data), use it immediately after clearing. Never force the user to manually reload or wait for a server restart.

## Counter Pattern (Don't Do This)

```js
// Reset clears to NULL and stops — system unusable until manual action or restart
db.prepare('UPDATE template SET raw_html=NULL WHERE mode=?').run(mode);
// User sees blank template, has to click "Load template" button manually
```