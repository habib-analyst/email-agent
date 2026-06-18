# Pages Overview

## Dashboard (/)
- **Purpose**: Analytics hub showing system statistics
- **Features**:
  - Current date/time display
  - Analytics cards (Today sent, Week sent, All time, Queue size, Scheduled batches)
  - Mode selection cards to navigate to Instant or Scheduled
  - No email sending functionality (view-only)
- **Navigation**: Click cards to go to Instant or Scheduled pages

## Instant Page (/instant)
- **Purpose**: Immediate email outreach with real-time processing
- **Features**:
  - Import professors (URL scraping, Paste emails, File upload)
  - Real-time agent research (deepseek → Qwen → Gemini)
  - Processing queue with live status
  - Email template editor
  - Send emails immediately after processing
  - Live activity feed
  - Agent health monitoring
- **State**: Independent state (not shared with Scheduled)
- **Toggle**: Header button to switch to Scheduled mode

## Scheduled Page (/scheduled)
- **Purpose**: Schedule email batches for future delivery
- **Features**:
  - Import professors (URL scraping, Paste emails, File upload)
  - **Schedule Settings**: Date/time picker to set when emails should be sent
  - Create multiple scheduled batches
  - View scheduled batches table (with status: pending/processing/completed/failed)
  - View and manage scheduled drafts
  - Approve/cancel scheduled emails before they're sent
  - Processing queue
  - Email template editor
- **State**: Independent state with additional scheduledBatches and scheduledDrafts
- **Toggle**: Header button to switch to Instant mode

## Key Differences

| Feature | Instant | Scheduled |
|---------|---------|-----------|
| Send timing | Immediate | Future date/time |
| Batch management | No | Yes (multiple schedules) |
| Date/Time picker | No | Yes |
| Drafts approval | No | Yes |
| Processing | Real-time | Queued for scheduled time |
| Use case | Urgent outreach | Planned campaigns |

## Shared Components
Both pages use the same underlying components but operate independently:
- GmailComposeChrome (Email template editor)
- Queue management cards
- Agent research system
- Import functionality (URL/Paste/File)

## Navigation Flow
```
Dashboard → [Select Mode] → Instant/Scheduled
              ↓                    ↕
         Analytics Only      Toggle between pages
```

## Card Sizes
- Email Template card: Full width in 2-column grid
- Processing Queue card: Full width in 2-column grid  
- Both cards: `max-h-[500px]` (equal height)
