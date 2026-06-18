---
name: db-seed-id-mismatch
description: When DB seed/migration code uses WHERE id=X but the actual row has a different id (migration artifact), the seed silently fails — COALESCE never fills null columns. Always update ALL rows or use no WHERE clause.
source: auto-skill
extracted_at: '2026-06-14T22:49:52.320Z'
---

# DB Seed ID Mismatch — Silent Failure Pattern

When a DB seed or migration UPDATE uses `WHERE id=1` but the actual row exists at `id=2` (or any different id), the seed **silently does nothing** — `COALESCE(raw_html, DEFAULT)` never fills the null column because the WHERE clause doesn't match any row. The column stays null forever, and downstream checks like `if (!tpl?.raw_html)` fail, causing "No template configured" or similar errors.

## How It Happens

1. Initial migration creates a row at `id=1`
2. A later migration (copy, backfill, or table rename) creates a row at `id=2`
3. The original `id=1` row gets dropped or doesn't exist anymore
4. Seed code still uses `WHERE id=1` — matches nothing, silently skips
5. The app queries `SELECT * FROM table` (no WHERE) — gets `id=2` with `raw_html: null`
6. Downstream: `if (!tpl?.raw_html)` → "No template configured" → batch fails immediately

## The Fix

**Never hardcode `WHERE id=1` in seed/migration UPDATE statements for single-row config tables.** Either:

1. **Remove the WHERE clause entirely** (updates all rows — safe for config tables that should have 1-2 rows):
```js
db.prepare("UPDATE scheduled_template SET raw_html=COALESCE(raw_html,?), ...").run(DEFAULT_HTML, ...);
// No WHERE — hits id=2 as well as id=1
```

2. **Or use a WHERE clause that matches the actual data** (query first, then update by actual id):
```js
const row = db.prepare("SELECT id FROM scheduled_template").get();
if (row) {
  db.prepare("UPDATE scheduled_template SET raw_html=? WHERE id=?").run(DEFAULT_HTML, row.id);
}
```

3. **Or use INSERT OR REPLACE / UPSERT pattern** that doesn't depend on specific ids:
```js
db.prepare("INSERT OR REPLACE INTO scheduled_template (id, raw_html, ...) VALUES (1, ?, ...)").run(DEFAULT_HTML, ...);
```

## Detection

If a single-row config table has a null column that should have been seeded, check:
1. What ids actually exist: `SELECT id FROM table`
2. What the seed code targets: `WHERE id=?`
3. If they don't match → the seed never ran on that row

The symptom is usually an immediate failure with a message like "No X configured" when trying to use the null column, while the rest of the row (instructions, sample_subject) is populated because they were set by a different code path that didn't use WHERE id.

## Also Applies to: Template Seeder Functions

When a seeder function like `seedBothModes()` updates two separate tables (e.g. `template` and `scheduled_template`), make sure it actually writes to **both** tables. A common mistake is calling `loadTemplateFromFile('scheduled')` which updates the shared `template WHERE mode='scheduled'` table — but the scheduled template lives in a **separate** `scheduled_template` table that has no `mode` column. The seeder must explicitly update the separate table too:

```js
export function seedBothModes() {
  loadTemplateFromFile('instant');  // Updates template table

  const schedResult = loadTemplateFromFile('scheduled');
  if (schedResult.success && schedResult.rawHtml) {
    // Must ALSO update the separate scheduled_template table
    db.prepare("UPDATE scheduled_template SET raw_html=COALESCE(raw_html,?), ...").run(schedResult.rawHtml, ...);
  }
}
```

## Validation

After fixing, verify:
1. `SELECT id, raw_html FROM table` — shows the row with populated `raw_html`
2. The app's config check (`tpl?.raw_html`) passes
3. The feature that depends on this column works (batch processing, template rendering, etc.)
