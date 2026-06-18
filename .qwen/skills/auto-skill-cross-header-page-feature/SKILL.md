---
name: cross-header-page-feature
description: Build a feature that lives in the header navbar and impacts both instant and scheduled mode pages — shared context, data module, header dropdown, page-aware banners, localStorage persistence, mode toggle, and prevent auth flash
source: auto-skill
extracted_at: '2026-06-14T22:38:11.839Z'
---

# Cross-Header-Page Feature Pattern

Use this when building a feature that has a control UI in the header (dropdown, toggle, selector) and needs to affect the content in both Instant and Scheduled mode pages. This project has a dual-mode architecture where header state must flow down to both pages independently.

## Architecture

```
data/ module (constants + utilities)
  → context/ (shared state: selected items, settings)
    → header component (control: dropdown, checkbox list, toggle)
    → page component (impact: warning banner, suggestion, constraint)
```

### 1. Data module — `src/data/<feature>.js`

Put constants and pure utility functions in a separate `.js` file (not `.jsx` — no JSX in data files). This keeps the component files clean and allows utilities to be imported by both the header component and page-aware components.

```js
// src/data/timezones.js
export const ITEMS = [
  { id: 'us-east', label: 'USA (Eastern)', tz: 'America/New_York', note: 'NY, MIT' },
  ...
];

export function getClassification(tz) { ... }
export const CLASS_LABELS = {
  business: { label: 'Business Hours', textClass: 'text-emerald-600 dark:text-emerald-400' },
  ...
};
```

**⚠️ No single quotes or apostrophes in string literals** — e.g. `Nat'l` breaks JS parsing. Use `Natl` instead.

### 2. Shared context — `src/context/<Feature>Context.jsx`

Create a React context so the header's selections are visible to both Instant and Scheduled pages. The context sits in the provider chain between `ToastProvider` and `SessionProvider`.

```jsx
// src/context/TimezoneContext.jsx
import { createContext, useContext, useState } from 'react';
const Context = createContext({ selectedItems: [], setSelectedItems: () => {} });

export function FeatureProvider({ children }) {
  const [selectedItems, setSelectedItems] = useState([]);
  return <Context.Provider value={{ selectedItems, setSelectedItems }}>{children}</Context.Provider>;
}

export function useFeature() { return useContext(Context); }
```

Add it to `App.jsx` provider chain:
```jsx
<ToastProvider>
  <FeatureProvider>     ← new
    <SessionProvider>
      <BrowserRouter>
        <EventStreamProvider>
          <AppShell />
```

### 3. Header component — `src/components/<Feature>.jsx`

A dropdown button in the header that shows the primary value (e.g. 🇵🇰 PK time) and a badge count of selected items. Opens to a full panel with:
- **Primary section** (always shown — e.g. user's home timezone)
- **Selected items live view** (shows active selections with live-updating data)
- **Checkbox list** grouped by category (countries by region, options by type)
- **Footer** with legend + "Clear All" button

Use `useFeature()` context for `selectedItems` and `setSelectedItems`.

### 4. Page-aware component — `src/components/<FeatureAlert>.jsx`

A conditional banner/panel that renders inside the import card (`StepCard 1`) of both Instant.jsx and Scheduled.jsx. It appears only when `selectedItems.length > 0` and shows context-sensitive warnings (e.g. timing classification, compliance alerts).

```jsx
export default function TimeAlertBanner() {
  const { selectedItems } = useFeature();
  if (selectedItems.length === 0) return null;
  // ... compute severity, render colored banner
}
```

Add it in both pages after the Max Professors input and before the import tabs.

### 5. Import changes

Add imports to both page files:
```js
import TimeAlertBanner from '../components/TimeAlertBanner.jsx';
```

Add to `App.jsx`:
```js
import TimeManagement from './components/TimeManagement.jsx';
import { FeatureProvider } from './context/FeatureContext.jsx';
```

Replace old header element with `<TimeManagement />`.

## Critical Pitfalls

### ⚠️ Tailwind JIT: NEVER use dynamic class construction

Template literals with variable parts like `text-${color}-600` or `bg-${status}-500` **will not compile** with Tailwind's JIT engine. The scanner only picks up complete, literal class strings.

**Wrong:**
```jsx
<span className={`text-${TIME_CLASS_LABELS[cls].color}-600`}>
```

**Right — store full class strings in data:**
```js
export const CLASS_LABELS = {
  business: { textClass: 'text-emerald-600 dark:text-emerald-400' },
  off:      { textClass: 'text-amber-600 dark:text-amber-400' },
  sleep:    { textClass: 'text-red-600 dark:text-red-400' },
};
```
```jsx
<span className={CLASS_LABELS[cls].textClass}>
```

Or use conditional expressions with all branches explicitly written:
```jsx
className={cls === 'business' ? 'text-emerald-600' : cls === 'off' ? 'text-amber-600' : 'text-red-600'}
```

### ⚠️ Closing tag mismatch in JSX

When nesting `<span>` inside `<div>` inside `<div>`, it's easy to close a `<span>` with `</div>`. Always verify JSX nesting after writing — esbuild will fail on mismatched tags.

### ⚠️ String escaping in .js data files

Characters like apostrophes inside single-quoted strings (e.g. `'KAIST, Seoul Nat'l, Yonsei'`) will break parsing. Use backtick strings or avoid apostrophes entirely.

### ⚠️ Data files must be .js (not .jsx)

Vite's `build-import-analysis` plugin will reject `.js` files containing JSX syntax. Since data modules contain no JSX, keep them `.js`. But if you accidentally put JSX in a `.js` file, rename it to `.jsx`.

### ⚠️ Live clock updates

Use `setInterval(() => setClock(new Date()), 1000)` for live-updating time displays. Clean up with `return () => clearInterval(id)` in the effect. For the alert banner, 60-second updates are sufficient (`setInterval(() => setTick(t => t + 1), 60000)`).

### ⚠️ Dropdown outside-click close

Use a `ref` on the dropdown container + `document.addEventListener('mousedown')` to close on outside clicks. Clean up the listener in the effect's return.

### ⚠️ Use Intl.DateTimeFormat for timezone calculations

Never hardcode UTC offsets — they change with DST. Use `new Date().toLocaleTimeString('en-US', { timeZone: tz })` and `new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })` for proper DST-aware formatting.

### ⚠️ Inline header layout with vertical separators

When showing multiple time zones in the header, use a horizontal flex with `w-px h-6 bg-gray-300 dark:bg-gray-700` dividers between each item. The primary value (e.g. 🇵🇰 PK time) is always shown, then each selected item appears with a divider before it. The dropdown trigger also gets a divider before it.

```jsx
<div className="relative flex items-center gap-0" ref={dropdownRef}>
  {/* PK time — always visible */}
  <div className="flex items-center gap-1.5 px-3 py-1.5">🇵🇰 PK ...</div>
  
  {/* Selected countries with dividers */}
  {activeCountries.map(c => (
    <React.Fragment key={c.id}>
      <div className="w-px h-6 bg-gray-300 dark:bg-gray-700 mx-0.5" />
      <div className="flex items-center gap-1.5 px-2 py-1.5">{c.flag} ...</div>
    </React.Fragment>
  ))}
  
  {/* Divider + Globe dropdown trigger */}
  <div className="w-px h-6 bg-gray-300 dark:bg-gray-700 mx-0.5" />
  <button onClick={() => setOpen(!open)}>Globe ▾</button>
</div>
```

The outer container needs `relative` so the absolute dropdown (`top-full left-1/2 -translate-x-1/2 mt-2`) positions correctly under the component, not under the header.

### ⚠️ Mode toggle in header

When adding a mode toggle (Instant/Scheduled) to the header, place it on the **far left** after the logo icon+text. Use the segmented two-button toggle pattern (see feedback memory on toggles). Remove the page-level mode toggles from both Instant.jsx and Scheduled.jsx (they had centered `<div className="flex justify-center">` toggle blocks around line 843/811) since the toggle now lives in the header only.

```jsx
{/* Logo — icon + text */}
<button onClick={() => navigate('/')} className="flex items-center gap-2">
  <div className="w-8 h-8 bg-gradient-to-br from-[#1a73e8] to-[#1557b0] rounded-lg flex items-center justify-center">
    <GraduationCap className="w-4.5 h-4.5 text-white" />
  </div>
  <span className="font-semibold text-sm">Email Agent</span>
</button>

{/* Mode toggle — no heading label, just the segmented buttons */}
<div className="flex p-0.5 bg-gray-200 dark:bg-gray-800 rounded-lg">
  <button onClick={() => navigate('/instant')}
    className={currentPage === 'instant' ? 'bg-emerald-500 text-white shadow-sm' : 'text-gray-500'}>
    <Zap /> Instant
  </button>
  <button onClick={() => navigate('/scheduled')}
    className={currentPage === 'scheduled' ? 'bg-violet-500 text-white shadow-sm' : 'text-gray-500'}>
    <Activity /> Scheduled
  </button>
</div>
```

`currentPage` is derived from `location.pathname` (already computed in Header). Remove the Mail icon and "Academic Outreach Platform" subtitle — keep just icon + "Email Agent" text. The GraduationCap icon fits the academic outreach theme better than Mail.

### ⚠️ Persist user preferences in localStorage

When the feature has user selections (countries, settings, checkboxes), persist them in localStorage so they survive page refresh and OAuth redirects. Apply this pattern to **both** the feature context and the auth context:

**Feature context — TimezoneContext.jsx:**
```jsx
const STORAGE_KEY = 'email-agent-tz-countries';

const [selectedCountries, setSelectedCountries] = useState(() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (e) {
    return [];
  }
});

useEffect(() => {
  if (selectedCountries.length > 0) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedCountries)); } catch {}
  } else {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
}, [selectedCountries]);
```

### ⚠️ Prevent Gmail "flash of disconnected" on page refresh

The root cause: `auth` state initializes to `null` → `isConnected = auth?.authenticated ?? false = false` → GmailConnectionCard renders disconnected immediately → user clicks Connect before the async bootstrap completes. Fix with two changes:

**1. Cache auth in localStorage (SessionContext.jsx):**
```jsx
const [auth, setAuth] = useState(() => {
  try {
    const cached = localStorage.getItem('email-agent-gmail-auth');
    return cached ? JSON.parse(cached) : null;
  } catch { return null; }
});

useEffect(() => {
  if (auth) {
    try { localStorage.setItem('email-agent-gmail-auth', JSON.stringify(auth)); } catch {}
  } else {
    try { localStorage.removeItem('email-agent-gmail-auth'); } catch {}
  }
}, [auth]);
```

**2. Show loading state when auth isn't confirmed (GmailConnectionCard.jsx):**

Instead of showing disconnected immediately, use a neutral spinner when `sessionReady` is false but cached auth says connected:

```jsx
const authKnown = sessionReady || isConnected;

// Compact variant — show spinner until auth confirmed
if (!authKnown) return (
  <div className="... bg-gray-50 text-gray-400">
    <Loader2 className="w-3 h-3 animate-spin" /> Gmail
  </div>
);

// Banner variant — show "Checking..." instead of "Not connected"
if (!authKnown) return (
  <div className="... bg-gray-50 text-gray-400">
    <Loader2 className="w-4 h-4 animate-spin" /> Checking Gmail connection…
  </div>
);
```

Export `sessionReady` from `useGmailAuth.js`:
```jsx
const { auth, settings, loadSession, sessionReady } = useSession();
// ... return { ..., sessionReady }
```

**Why this matters:** Without the cache, every page refresh shows Gmail as disconnected for 100-500ms before the server responds. Users reflexively click "Connect Gmail" and go through OAuth again, even though they're already connected. The cache + loading state eliminates this entirely — connected state appears instantly from cache, then the server confirms it.

### ⚠️ Modern date/time picker for Scheduled mode

Replace plain `<input type="date">` and `<input type="time">` with `react-datepicker` for a modern calendar + clock UI. Install with `npm install react-datepicker` and import with CSS:

```jsx
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
```

Use a single Date object state (`scheduledAt`) instead of separate string states (`scheduleDate`, `scheduleTime`). Derive the strings for API calls:

```jsx
const [scheduledAt, setScheduledAt] = useState(null);
// Derive local date/time strings from the Date object for API calls
const scheduleDate = scheduledAt ? `${scheduledAt.getFullYear()}-${String(scheduledAt.getMonth()+1).padStart(2,'0')}-${String(scheduledAt.getDate()).padStart(2,'0')}` : '';
const scheduleTime = scheduledAt ? `${String(scheduledAt.getHours()).padStart(2,'0')}:${String(scheduledAt.getMinutes()).padStart(2,'0')}` : '09:00';
```

**⚠️ Use local time, not UTC:** `toISOString()` gives UTC time which is wrong for user-facing scheduled times. Use manual year/month/day/hour/minute extraction instead.

Two separate DatePicker instances sharing the same Date state:
- **Date picker:** `dateFormat="MMMM d, yyyy"` with `minDate={new Date()}`, `placeholderText="Select date"`
- **Time picker:** `showTimeSelect`, `showTimeSelectOnly`, `timeIntervals={15}`, `dateFormat="h:mm aa"`, `placeholderText="Select time"`

Both call `onChange={date => setScheduledAt(date || null)}` — selecting date preserves time, selecting time preserves date.

The preview uses `scheduledAt.toLocaleString()` (local format, not UTC).

**⚠️ Derive strings, don't use separate setters:** Since `scheduleDate` and `scheduleTime` are derived (not state), there are no `setScheduleDate`/`setScheduleTime` functions. Remove all setter references. The existing API call format `${scheduleDate}T${scheduleTime}:00` still works with derived values.
