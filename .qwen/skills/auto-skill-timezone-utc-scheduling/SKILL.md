---
name: timezone-utc-scheduling
description: When frontend sends scheduled times to backend, convert local time to UTC ISO string — backend SQLite datetime('now') is UTC, so local time strings cause incorrect comparisons and delayed sending
source: auto-skill
extracted_at: '2026-06-14T23:31:19.902Z'
---

# Timezone UTC Scheduling — Prevent Delayed Email Sending

When a web app schedules future actions (like sending emails at a specific time), the frontend must convert local time to UTC before sending to the backend. SQLite's `datetime('now')` returns UTC, so storing local time strings causes the scheduler to compare wrong times and either send too late or never send.

## Root Cause Pattern

1. User in Pakistan (UTC+5) picks **4:20 AM local** time in a DatePicker
2. Frontend builds `scheduled_at = "2026-06-14T04:20:00"` from local time strings (year, month, day, hours, minutes)
3. Backend stores this as-is in SQLite
4. Scheduler checks `scheduled_at <= datetime('now')` — but `datetime('now')` returns **UTC** time (23:20 on June 13)
5. SQLite compares `"2026-06-14T04:20:00" <= "2026-06-13T23:20:00"` → **FALSE** (the stored time is treated as UTC 04:20 = Pakistan 09:20)
6. Emails don't send until **9:20 AM Pakistan time** — 5 hours late!

## Fix: Convert Local Date to UTC ISO String

```jsx
// WRONG — sends local time as raw string, backend interprets as UTC
const scheduled_at = `${scheduleDate}T${scheduleTime}:00`;

// RIGHT — DatePicker gives a Date object in local timezone, toISOString() converts to UTC
const scheduled_at = scheduledAt ? scheduledAt.toISOString() : `${scheduleDate}T${scheduleTime}:00`;
```

`toISOString()` returns `"2026-06-13T23:20:00.000Z"` (4:20 AM Pakistan → 23:20 UTC previous day). The scheduler then correctly compares this against UTC `datetime('now')`.

### Display Local Time to User

The UI preview should still show local time using `toLocaleString()`:

```jsx
<span>Scheduled for: {scheduledAt.toLocaleString()}</span>
// Shows: "6/14/2026, 4:20:00 AM" — user-friendly local time
```

The DatePicker component handles timezone natively — its `selected` value is a `Date` object in the user's local timezone. Just make sure the API call uses `toISOString()` and the display uses `toLocaleString()`.

## Why This Is Hard to Diagnose

- The backend API and scheduler appear to work correctly — no errors in logs
- The batch status shows "scheduled" — looks normal
- The `checkScheduledBatches` SQL query looks correct: `WHERE scheduled_at <= datetime('now')`
- Only by comparing the actual stored value vs UTC now can you see the 5-hour offset
- Manual "Send Now" button works fine (bypasses the scheduled_at comparison entirely)

Diagnostic SQL:
```sql
SELECT datetime('now') as utc_now, scheduled_at FROM scheduled_batches WHERE status='scheduled';
-- If utc_now < scheduled_at when it should be past → timezone mismatch
```

## The 5-Hour Offset (Pakistan UTC+5)

For Pakistan specifically:
- 4:20 AM local → stored as "04:20" → backend treats as UTC 04:20 → actual send at 09:20 AM Pakistan
- 9:00 PM local → stored as "21:00" → backend treats as UTC 21:00 → actual send at 02:00 AM Pakistan next day
- The offset is always `timezone_offset` hours (5 for Pakistan, varies by country and DST)

## When to Apply

- Any app where users schedule future actions and the backend uses SQLite `datetime('now')` or any UTC-based time comparison
- When users report "emails didn't send at the scheduled time" or "scheduler is late"
- When adding a DatePicker/time picker for scheduling — ensure the API sends UTC
- When the backend uses PostgreSQL/MySQL with UTC timestamps — same pattern applies
- After adding a reschedule feature — the reschedule PUT endpoint also needs UTC conversion

## Reschedule Endpoint

The reschedule feature currently accepts raw `scheduled_at` strings from the frontend. When implementing reschedule with a DatePicker, apply the same UTC conversion:

```jsx
// Reschedule with new Date object
const doReschedule = async () => {
  const scheduled_at = rescheduleDate.toISOString(); // UTC
  await put(`/scheduled/batch/${batch.id}/reschedule`, { scheduled_at });
};
```

## Alternative: Backend Local Time Mode

If you want the backend to use local time instead of UTC, set SQLite's `localtime` modifier:

```sql
SELECT * FROM batches WHERE scheduled_at <= datetime('now', 'localtime')
```

But this is fragile — it depends on the server's timezone setting. The UTC approach is universal and portable.
