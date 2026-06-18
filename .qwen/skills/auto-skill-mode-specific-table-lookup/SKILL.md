---
name: mode-specific-table-lookup
description: When multi-mode systems use separate DB tables per mode, all FK lookups and template queries must use the mode-specific table — wrong table = wrong recipient data sent
source: auto-skill
extracted_at: '2026-06-13T23:46:18.911Z'
---

# Mode-Specific Table Lookup for Multi-Mode Systems

When a system has separate operational modes (instant vs scheduled) with **separate database tables per mode**, every FK resolution and data lookup must use the **mode-specific table**. Using the wrong table sends data (emails, names, content) to the wrong person.

## The Bug (Critical — emails sent to wrong recipients)

`sendEmail()` always looked up `professor_id` in the `professors` table (instant mode), regardless of the calling mode. When `sendScheduledBatch` passed `professor_id` from `scheduled_professors`, the IDs matched completely different people in the instant-mode table.

Example: `scheduled_professors.id=5` = "dong@wayne.edu" (Wayne State), but `professors.id=5` = "chjwang@nju.eu.cn" (Chinese university). Email content about Wayne State professors was sent to Chinese university addresses.

## The Fix

### 1. Professor Lookup — use mode-specific table

```js
// BEFORE (broken — always uses instant table):
const prof = db.prepare('SELECT email, last_name FROM professors WHERE id=?').get(item.professor_id);

// AFTER (correct — mode-aware):
let prof;
if (itemMode === 'scheduled') {
  prof = db.prepare('SELECT email, last_name FROM scheduled_professors WHERE id=?').get(item.professor_id);
} else {
  prof = db.prepare('SELECT email, last_name FROM professors WHERE id=?').get(item.professor_id);
}
```

### 2. Template Lookup — use mode-specific table

```js
// BEFORE (broken — queries shared template table):
const tpl = db.prepare('SELECT raw_html FROM template WHERE mode=?').get(itemMode);

// AFTER (correct — mode-aware):
let tpl;
if (itemMode === 'scheduled') {
  tpl = db.prepare('SELECT raw_html FROM scheduled_template').get();
} else {
  tpl = db.prepare('SELECT raw_html FROM template WHERE mode=?').get(itemMode);
}
```

### 3. Caller must pass `mode` explicitly

```js
// BEFORE (broken — no mode passed, defaults to 'instant'):
sendEmail({ professor_id: draft.prof_id, subject, interest_line, custom_html });

// AFTER (correct — mode explicitly passed):
sendEmail({ professor_id: draft.prof_id, subject, interest_line, custom_html: draft.html_preview, mode: 'scheduled' });
```

### 4. Pass draft HTML directly (safest)

When a draft has already been built with the correct names/placeholders replaced, pass `custom_html: draft.html_preview` so `sendEmail` uses the pre-built content directly instead of rebuilding from template + wrong-table professor data.

## Table Mapping Reference

| Mode | Professors Table | Sent Log Table | Template Table |
|------|-----------------|---------------|---------------|
| instant | `professors` | `sent_log` | `template WHERE mode='instant'` |
| scheduled | `scheduled_professors` | `scheduled_sent_log` | `scheduled_template` |

## Diagnostic Signals

- Emails sent to wrong recipients but subjects/interest_lines match the draft → professor_id FK resolved against wrong table
- Template content correct in preview but wrong last_name in sent email → template lookup used wrong table
- `professor_id` works in one mode but maps to different person in another → IDs overlap across separate tables (autoincrement)

## When to Apply

Any system with:
- Multiple operational modes using separate DB tables
- FK relationships that resolve IDs to person/entity data
- A shared `sendEmail` or `processItem` function called from both modes
- Autoincrement IDs that overlap across separate tables (id=5 in table A ≠ id=5 in table B)
