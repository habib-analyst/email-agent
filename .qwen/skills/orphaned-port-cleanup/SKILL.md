---
name: orphaned-port-cleanup
description: Diagnose and resolve port-in-use conflicts on Windows when starting dev servers — find stale PIDs with netstat, kill them, then restart
source: auto-skill
extracted_at: '2026-06-11T13:00:00.000Z'
---

# Orphaned Port Cleanup for Windows Dev Servers

When starting dual-service projects (backend + frontend) on Windows, orphaned processes from previous sessions commonly hold ports, causing `EADDRINUSE` errors. This method reliably clears and restarts them.

## The Pattern

### 1. Start both services in parallel

Run each with a background shell. If port 5173 (Vite default) is taken, Vite auto-falls back to 5174 — that's fine, just note the URL.

### 2. Detect port conflicts immediately

Check the output of each background service. Key error signals:
- **Backend**: `EADDRINUSE: address already in use :::PORT` — port is occupied by a stale process
- **Frontend**: `Port X is in use, trying another one...` — Vite handles this gracefully, no action needed

### 3. Find the offending PID

```powershell
netstat -ano | findstr :PORT
```

Look for `LISTENING` lines — the last column is the PID. Ignore `TIME_WAIT` entries (they self-clear; you can safely wait or restart).

### 4. Kill the stale process

```powershell
taskkill /PID <PID> /F
```

The `/F` forces termination. If multiple PIDs are listening (unusual for a single service), kill all of them.

### 5. Stop the failed background shell

The old background process is now blocked on the watcher (`Waiting for file changes before restarting...`). Stop the background task, then restart it freshly:

```powershell
# Stop the background shell
# Then re-run: npm run dev (or the project's start command)
```

### 6. Verify both services are up

Check the background output for startup confirmation:
- Backend: `Backend running on port X`
- Frontend: `VITE v... ready in ... ms` with `Local: http://localhost:X/`

## Common Ports in This Project

| Service | Default Port | Fallback |
|---------|-------------|----------|
| Backend (Express) | 3001 | Must be explicitly freed |
| Frontend (Vite) | 5173 | Auto-fallback to 5174, 5175, etc. |

## Why This Works

- **netstat + findstr** is the most reliable way to find orphaned Node processes on Windows (no `lsof` equivalent)
- **taskkill /F** actually terminates the process instead of sending a polite signal that orphaned processes ignore
- **Restarting the shell** is necessary because `node --watch` will not auto-restart after the port error — it waits for file changes instead

## When to Use

- Any time you start a dev server and get `EADDRINUSE`
- When a previous Ctrl+C / shutdown didn't properly clean up the process
- On Windows specifically — the approach differs on macOS/Linux (where `lsof -i :PORT` and `kill` are used)