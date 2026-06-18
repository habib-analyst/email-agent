---
name: incremental-jsx-restructuring
description: Reorganize a flat React page with scattered sections into numbered step-based wrappers — incremental edit approach that handles background agent partial completion and verifies builds at each stage
source: auto-skill
extracted_at: '2026-06-12T23:43:39.818Z'
---

# Incremental JSX Restructuring

When you need to reorganize a React page layout — converting a flat page with scattered sections into organized numbered step wrappers (StepCard, WizardStep, etc.) — use this incremental approach. Background agents often fail on complex restructuring tasks; this method handles partial completion and builds incrementally.

## When to Use

- Converting a flat page with mixed sections into numbered step/wizard cards
- Moving shared components (analytics, live feed, progress bars) from top positions into their respective step containers
- Adding new inline sections between steps
- Wiring computed props (like classification stats) through the component hierarchy

## Procedure

### Step 1 — Plan the new layout before editing

List every section in the current page and decide which step each belongs to. Identify:
- **Header sections** that stay at the top (connection banners, mode toggles, health bars)
- **Per-step content** that moves into numbered step wrappers
- **Cross-step components** (analytics, live feed) that move into specific steps or to the bottom
- **New sections** to add (reply hubs, computed stats)

Assign `active` and `done` states to each step using existing state variables:
```
Step 1 active: importing || scrapeProgress.running
Step 1 done: queue.length > 0
Step 2 active: roster.length > 0 && queue.some(q => ['researching','drafted'].includes(q.state))
Step 3 active: template && !templateSaved
Step 4 active: activeItem || scrapeProgress.running
```

### Step 2 — Assess background agent work before continuing

If a background agent was tasked with restructuring, check what it actually accomplished:
1. Check for new imports added (StepCard, Table2, ReplyHub, etc.)
2. Check for computed props added (replyStats useMemo, etc.)
3. Check for sections removed or partially restructured
4. Check for orphaned closing tags (`</section>` without matching `<section>`)

**Key insight**: Background agents often add imports and remove scattered sections but fail to wrap the remaining JSX in step wrappers. Don't duplicate their work — start from where they left off.

### Step 3 — Remove scattered sections that need to move (one edit)

Remove components that will be re-inserted inside step wrappers later (BatchScrapeProgress, AnalyticsPanel, AgentFlowBar, LiveFeed, Replies). Replace their current block with nothing — they'll be placed inside their respective steps.

```
Old: {scrapeProgress block} {AnalyticsPanel} {AgentFlowBar} {LiveFeed} {Replies}
New: (empty — these go inside StepCards)
```

### Step 4 — Replace section headers with step wrappers (per-step edits)

For each step, replace the old section `<section>` wrapper + step-badge header with the step wrapper component. Do this in order from Step 1 through Step N:

**Old** (flat section):
```jsx
<section ref={sectionImportRef} className="space-y-3 scroll-mt-20">
  <div className="flex items-center gap-2.5 px-1">
    <span className="step-badge">1</span>
    <h3>Import Professors</h3>
    <span className="text-[10px] text-gray-400 ml-auto">subtitle</span>
  </div>
  <div className="card space-y-4">
    ...content...
  </div>
</section>
```

**New** (step wrapper):
```jsx
<StepCard step={1} title="Import Professors" subtitle="..." icon={Globe}
  active={importing || scrapeProgress.running}
  done={queue.length > 0}>
  <BatchScrapeProgress ... />  {/* moved from scattered position */}
  <div className="card space-y-4">
    ...content...
  </div>
</StepCard>
```

### Step 5 — Separate shared sub-components between steps

Some sections contain multiple logical components that belong to different steps. For example, a "Import + Roster" section should be split into:
- Step 1: Import content (tabs, proceed, messages)
- Step 2: RosterPanel

Replace the closing of one step and immediately open the next:
```
Old: ...content...</div><RosterPanel .../></section>
New: ...content...</div></StepCard><StepCard step={2}...><RosterPanel .../></StepCard>
```

### Step 6 — Fix orphaned closing tags

After removing `<section>` wrappers, there may be orphaned `</section>` tags. Remove them since the StepCard component provides its own wrapper. Also remove any grid wrappers (`<div className="grid grid-cols-2">`) if switching from side-by-side to vertical layout.

### Step 7 — Add new sections and computed props

After the numbered steps, add:
- **Inline sections** (ReplyHub, etc.) — not numbered, just a section with its own header
- **Analytics panel** at the bottom — with wired computed props

Add computed props (replyStats, etc.) as useMemo near related state:
```jsx
const replyStats = useMemo(() => {
  if (!replies.length) return null;
  return {
    positive: replies.filter(r => r.classification === 'positive').length,
    negative: replies.filter(r => r.classification === 'negative').length,
    neutral: replies.filter(r => r.classification === 'neutral').length,
    auto_reply: replies.filter(r => r.classification === 'auto_reply').length,
  };
}, [replies]);
```

### Step 8 — Verify build after each major edit phase

Run `npm run build` (from the frontend directory) after completing the restructuring. Don't wait until the end — verify incrementally:
- After removing scattered sections → build still works (unused imports may warn, but no errors)
- After wrapping in step cards → build works (orphaned tags would fail here)
- After adding new components → build works (missing imports would fail here)

## Key Rules

- **Never duplicate background agent work** — check what imports/props/sections were already added before making edits
- **Remove scattered sections in one edit, then place them individually** — this avoids line-number drift from multiple removals
- **CRITICAL: When MOVING a component, remove from old position AND insert at new position** — if you only insert at the new position without removing from the old, the component appears twice on the page. This is the most common restructuring bug. After every move, grep for the component name to confirm only one JSX instance remains (plus the import).
- **Orphaned `</section>` tags cause build failures** — always check for them after removing section wrappers
- **Side-by-side grids become vertical** — when converting to numbered steps, remove `grid-cols-2` wrappers
- **Computed props (replyStats) go near related state** — place useMemo right after the state it depends on
- **StepCard `defaultOpen`** — set true for active steps (import, queue), false for stable steps (template)
- **Verify build after restructuring** — orphaned tags and missing imports are caught by Vite
- **Grep for duplicate JSX after layout moves** — `grep_search` for component names like `AnalyticsPanel`, `LiveFeed`, `StepCard step={N}` to catch duplicates before the user sees them on the page
