---
name: custom-html-edit-override
description: Allow users to directly edit rendered HTML content inline (contentEditable div), store the override separately in DB (custom_html column), and make the send function use the override when present — falling back to template substitution when not
source: auto-skill
extracted_at: '2026-06-12T18:31:37.655Z'
---

# Custom HTML Edit Override Pattern

When users need to make custom edits to personalized emails (or any generated HTML content) before sending, you must handle three challenges: letting them edit the rendered HTML directly, storing the edit separately from the template, and ensuring the send function uses the edited version.

## The Pattern

### 1. DB: Separate `custom_html` column (not replacing the template)

```sql
ALTER TABLE queue ADD COLUMN custom_html TEXT;
```

Never overwrite the template. Store the user's edited HTML as a separate override column. This preserves the original template + placeholders for items that aren't manually edited, and lets the override coexist with `subject` and `interest_line`.

**Why separate column, not replacing template?** The template (`{{LAST_NAME}}`, `{{INTEREST_LINE}}` placeholders) must remain intact for other queue items. The override only applies to the specific item the user edited.

### 2. Frontend: contentEditable div for inline editing (not textarea or iframe)

```jsx
// View mode: iframe preview (read-only)
<iframe srcDoc={baseHtml} className="w-full h-[350px]" title="Email preview" sandbox="allow-same-origin" />

// Edit mode: contentEditable div (direct inline editing)
<div
  ref={editableRef}
  contentEditable
  suppressContentEditableWarning
  className="w-full min-h-[350px] p-4 border border-brand-300 rounded-lg focus:ring-2 focus:ring-brand-300"
  style={{ fontFamily: "'Roboto', Arial, sans-serif" }}
/>
```

**Why contentEditable over textarea?** Textarea shows raw HTML source code — users can't see the formatted email. contentEditable renders the HTML and lets users click/edit text directly inside the email, like Gmail compose.

**Why contentEditable over iframe with designMode?** contentEditable on a div is simpler to integrate into the React component tree. iframe designMode requires cross-frame communication which is fragile.

**Why `suppressContentEditableWarning`?** React warns that contentEditable children won't be updated. Since we use a ref to set innerHTML manually (not React state), this warning is irrelevant — suppress it.

### 3. Frontend: Use useRef + innerHTML to capture edits (not React state)

```jsx
const editableRef = useRef(null);

// Set initial HTML when popup opens in edit mode
useEffect(() => {
  if (composeOpen && popupMode === 'edit') {
    const html = (item.custom_html || templateHtml)
      .replace(/\{\{LAST_NAME\}\}/g, greetingName)
      .replace(/\{\{INTEREST_LINE\}\}/g, item.interest_line || '');
    if (editableRef.current) {
      editableRef.current.innerHTML = html;
    }
  }
}, [composeOpen, popupMode]);

// Capture edits from contentEditable on save/send
const handleSave = async () => {
  const html = editableRef.current?.innerHTML || editHtml;
  await onEdit(editSubject, editInterest, editEmail, html);
};
```

**Why ref, not state?** contentEditable manages its own DOM content. React state would conflict with the browser's DOM mutations. Read the innerHTML from the ref when you need the current content (save/send).

### 4. Backend: Edit endpoint accepts `custom_html`

```js
router.put('/queue/:id/edit', (req, res) => {
  const { subject, interest_line, professor_email, custom_html } = req.body;
  const updates = [];
  const vals = [];
  if (subject) { updates.push('subject=?'); vals.push(subject); }
  if (interest_line) { updates.push('interest_line=?'); vals.push(interest_line); }
  if (custom_html) { updates.push('custom_html=?'); vals.push(custom_html); }
  // ... rest of update logic
});
```

### 5. Backend: Send function checks `custom_html` first (override → fallback)

```js
export async function sendEmail(item) {
  let html;
  if (item.custom_html) {
    // User edited the email body directly — use their version
    html = item.custom_html;
  } else {
    // No manual edits — build from template with placeholders
    const tpl = db.prepare('SELECT raw_html FROM template WHERE mode=?').get(item.mode);
    html = tpl.raw_html
      .replace(/\{\{LAST_NAME\}\}/g, formatGreetingLastName(prof.last_name))
      .replace(/\{\{INTEREST_LINE\}\}/g, item.interest_line || '');
    // ... validation checks
  }
  const raw = buildMime(from, to, item.subject, html, resumePath);
}
```

**Key**: When `custom_html` exists, skip ALL template validation (placeholder checks, subject prefix checks). The user may have intentionally changed those things. Only validate the template-built path.

### 6. Frontend: Approval workflow lifecycle

```
Edit mode (contentEditable) → Save Edits (popup stays, "Saved" badge) → Send (popup closes)
→ Edit button disabled for sent items → "All sent" banner with reset button
```

- **Save keeps popup open**: user can review before sending
- **After sent**: Edit button grayed out (`isDisabled = sent || item.state === 'sent'`)
- **All sent banner**: when no `awaiting_proceed` items remain, show completion banner with session reset

### 7. Frontend: useEffect syncs local state from props (real-time)

```jsx
useEffect(() => {
  setEditSubject(item.subject || '');
  setEditInterest(item.interest_line || '');
  setEditEmail(item.professor_email || '');
}, [item.subject, item.interest_line, item.professor_email]);
```

When SSE events or `loadSession` update the item, the local edit state must re-sync. Without this, the popup shows stale values after save.

### 8. Pipeline: Skip re-processing when custom_html exists (critical!)

When the user clicks "Send This Email", the approve endpoint sets `fast_track=1` and `state='pending'`, causing the pipeline to pick up the item. **If the pipeline runs the normal research→draft→verify→send cycle, it will OVERWRITE the user's custom edits** (subject, interest_line, custom_html) with new AI-generated content. The user's edits are lost.

The fix: in `processQueueItem`, detect `fast_track + custom_html` and send directly, skipping all research/draft/verify steps:

```js
async function processQueueItem(item, loopEpoch) {
  // Fast-track with custom_html: user already edited the email — send directly
  if (item.fast_track && item.custom_html) {
    const prof = db.prepare('SELECT * FROM professors WHERE id=?').get(item.professor_id);
    if (!prof) { updateState(item.id, 'failed', { error: 'Professor not found' }); return; }
    publishStep('sending', item);
    try {
      const sendResult = await withRetry(() => sendEmail({ ...item, professor_id: prof.id }));
      updateState(item.id, 'sent', { sent_at: new Date().toISOString() });
      // ... log to sent_log, upsertRosterRow, publishStep('sent'), etc.
    } catch (e) {
      updateState(item.id, 'failed', { error: e.message });
      publishStep('failed', item, { label: `Send failed: ${e.message}`, error: true });
    }
    return; // EXIT — don't fall through to normal research/draft cycle
  }
  // ... normal pipeline continues here
}
```

**Why this matters:** Without this bypass, every "Send This Email" click triggers full re-processing. The AI re-generates subject/interest_line, the `updateState('drafted', { subject, interest_line })` call replaces the user's saved edits, and `sendEmail({ ...item, subject, interest_line })` uses the AI's values. The user sees their edits disappear and a different email get sent. This is the most critical bug in the approval→send flow.

**Note:** The pipeline's `baseSql` uses `q.*` which includes `custom_html`, `subject`, and `interest_line` — no SQL changes needed. The `...item` spread passes `custom_html` to `sendEmail`, which checks it first.

### 9. Frontend: Edit mode must look identical to view mode

The contentEditable div in edit mode must use the **exact same CSS styling** as the iframe in view mode — white background, same font, same borders, same paragraph margins. No colored backgrounds, no blue borders, no visual indicators that make edit mode look different. The only difference is that text is editable.

```jsx
// Both use identical container styling:
className="w-full min-h-[350px] bg-white rounded-lg border border-gray-200 dark:border-gray-700"
style={{ fontFamily: "'Roboto', Arial, sans-serif", fontSize: '14px', lineHeight: '1.6', color: '#222', padding: '16px 20px' }}

// Edit mode: contentEditable div (same styling, just editable)
<div ref={editableRef} contentEditable suppressContentEditableWarning ... />

// View mode: iframe (same styling, read-only)
<iframe srcDoc={baseHtml} ... />
```

Subject and To fields in edit mode use `bg-transparent` with `focus:outline-none` — they look like static text but are actually editable `<input>` elements. No colored borders or backgrounds.

The `baseHtml` for the iframe must include full CSS styles (paragraph margins, line-height, font):
```js
const baseHtml = `<!DOCTYPE html><html><head><style>
  body{margin:0;padding:16px 20px;font-family:'Roboto',Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;}
  p{margin:0 0 1em 0} ul,ol{margin:0.5em 0;padding-left:2em} li{margin:0.25em 0}
</style></head><body>${substituted}</body></html>`;
```

### 10. Backend: SSE event includes all edited fields + frontend patches professor_email

```js
// Backend: routes/index.js edit endpoint
const finalEmail = professor_email || (db.prepare('SELECT p.email FROM professors p WHERE p.id=?').get(item.professor_id)?.email);
eventBus.publish({
  type: 'compose_update',
  id: Number(req.params.id),
  subject: finalSubject,
  interest_line: finalInterest,
  professor_email: finalEmail,
  // custom_html is NOT sent via SSE — it's large and fetched on next loadSession
});
```

`custom_html` can be large (full email HTML). Don't push it through SSE. It's already in the DB and fetched by `loadSession` on the next queue refresh.

```js
// Frontend: patchQueueFromEvent must update professor_email too
const patchQueueFromEvent = useCallback((data) => {
  setQueue(prev => prev.map(q => (
    q.id === data.id
      ? { ...q,
          state: data.state ?? q.state,
          subject: data.subject ?? q.subject,
          interest_line: data.interest_line ?? q.interest_line,
          professor_email: data.professor_email ?? q.professor_email,
          error: data.error ?? q.error }
      : q
  )));
}, [setQueue]);
```

Without `professor_email` in `patchQueueFromEvent`, SSE pushes from edit saves don't update the displayed professor email until a full `loadSession` refresh.

### 11. Runtime interest-line stripping at substitution (defense-in-depth)

Existing DB entries may have `interest_line` stored as the full sentence ("I am particularly interested in your work in X, Y, Z") instead of just keywords ("X, Y, Z"). When the template already contains the sentence wrapper, this causes duplication. Strip the wrapper at both backend (send) and frontend (preview/edit) substitution:

```js
// Backend: gmail/index.js sendEmail()
let interestLine = item.interest_line || '';
interestLine = interestLine.replace(/I am (?:particularly )?interested in your work (?:on|in) ?/gi, '').trim();

// Frontend: Instant.jsx ApprovalCard
const cleanInterestLine = (line) => (line || '').replace(/I am (?:particularly )?interested in your work (?:on|in) ?/gi, '').trim();
```

This is a defense-in-depth measure: fixing the AI prompts prevents future bad data, but the stripping regex handles legacy entries already in the DB. The regex is harmless — if the interestLine is already just keywords, it doesn't match anything.

## When to Use

Any system where:
- Users need to review and manually edit generated content before it's sent/published
- The content is HTML that needs to be edited visually (not as source code)
- The system has a template-based generation pipeline but needs per-item overrides
- Approval workflows require: edit → save → send → disable edit → completion

## Counter Patterns

```js
// DON'T: Store edited HTML in the template column
// → Overwrites the template, breaks all other items that use it

// DON'T: Use textarea with raw HTML for editing
// → Users see HTML tags, can't see the formatted email

// DON'T: Use React state to track contentEditable content
// → React state conflicts with browser DOM mutations in contentEditable

// DON'T: Validate template placeholders when custom_html is present
// → The user may have intentionally removed/changed placeholders

// DON'T: Push custom_html through SSE events
// → Large payload, already in DB, fetched by loadSession anyway

// DON'T: Let the pipeline re-process (research→draft→verify→send) a fast_track item with custom_html
// → The AI re-generates subject/interest_line, overwrites the user's edits, and sends a different email
// → This is the most critical bug — fast_track + custom_html must bypass the pipeline and send directly

// DON'T: Use colored/brand styling for edit mode that differs from view mode
// → User wants seamless transition — both modes should look identical, only text is editable
```
