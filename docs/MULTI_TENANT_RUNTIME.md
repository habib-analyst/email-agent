# Multi-Tenant Runtime Migration

## Target

Support 100+ concurrently authenticated Gmail users without sharing:

- OAuth credentials
- SQLite connections
- queues, batches, workers, schedulers, caches, or SSE events
- files, templates, resumes, API keys, or analytics

## Required request context

Every authenticated request and background job must carry an immutable `tenantId`.
The tenant must come from a signed server session, never from a request body,
query parameter, email address, or frontend storage.

## Required replacements

1. Replace `.tokens.json` with encrypted OAuth credentials keyed by `tenantId`.
2. Replace the mutable `activeDb` proxy with `getTenantDb(tenantId)`.
3. Replace singleton workers and scheduler with tenant-aware jobs:
   `{ tenantId, jobType, entityId, runAt }`.
4. Partition SSE clients and events by `tenantId`; admin receives explicit audit
   streams, not user event streams.
5. Key all in-memory caches by `tenantId`, or move them to a shared cache service.
6. Add idempotency keys and per-user Gmail rate limiting to every send job.
7. Run multiple backend/worker processes using a durable queue and distributed
   locks. In-process timers are not sufficient.

## Control plane already implemented

- tenant registry and roles
- account blocking
- plan and entitlement schema
- per-user feature overrides
- admin audit log
- admin-only controls and aggregate dashboard

## Deployment gate

Do not advertise concurrent multi-user support until:

- no route imports the mutable default database
- no Gmail operation reads a global token file
- no worker/scheduler stores tenant-neutral mutable state
- isolation and wrong-sender integration tests pass under parallel load

