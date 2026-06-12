# Persistence And Migrations

This guide defines persistence rules for PostgreSQL, Redis/BullMQ, object storage, and the desktop-agent local database.

## Persistence Ownership

PostgreSQL is the system of record for:

- tenants;
- users;
- agents;
- connection profiles;
- metadata snapshots;
- documents;
- drafts;
- validation reports;
- approval decisions;
- agent commands;
- write results;
- audit events;
- learning feedback.

Object storage owns:

- raw uploaded documents;
- OCR artifacts;
- generated previews;
- export packages;
- large diagnostic bundles.

Redis/BullMQ owns transient job execution state, not domain truth.

Desktop SQLite/SQLCipher owns local agent queue state and local execution recovery data.

## Transaction Rules

Use database transactions for:

- creating document records and enqueueing follow-up jobs through an outbox pattern;
- creating drafts and validation records;
- approving drafts and creating write commands;
- recording write results and updating draft state;
- appending audit events tied to state transitions.

Do not perform remote OCR, LLM, 1C, or object-storage network calls inside long database transactions.

## Draft Persistence

Draft creation uses Drizzle ORM with PostgreSQL tables owned by the API backend:

- `drafts` stores the review draft state, tenant/document references, metadata snapshot reference, schema hash, target 1C resource name, mapped fields, mapped references, confidence summary, validation summary, idempotency key, correlation id, creator id, and normalized request hash.
- `audit_events` stores append-only domain audit events. Draft creation writes a `draft.created` event in the same transaction as the draft row.

Creation invariants:

- Draft creation must write only to Automator PostgreSQL.
- Newly created draft rows must be forced into `needs_review`, `pending`, and `not_requested`.
- `requires_accountant_approval` must be true for newly created review drafts.
- `(tenant_id, idempotency_key)` must be unique.
- Same idempotency key plus same request hash is a replay and returns the existing draft.
- Same idempotency key plus a different request hash is a conflict.
- The normalized request hash must be stable for equivalent field/reference ordering and must exclude caller-provided lifecycle, approval, write, or command data.
- Audit payloads must contain counts, identifiers, hashes, and statuses only. Do not store raw mapped field values, raw documents, raw OCR text, credentials, tokens, or connection strings in audit payloads.

## Document Exception Persistence

Document exception routing uses Drizzle ORM with PostgreSQL tables owned by the API backend:

- `document_exceptions` stores the open exception queue record, tenant/document references, optional draft and metadata references, stage, category, queue name, priority, review flags, compact signals, top signal code, suggested actions, idempotency key, request hash, correlation id, creator id, and timestamps.
- `audit_events` stores append-only domain audit events. Exception routing writes a `document.exception.queued` event in the same transaction as the exception row.

Creation invariants:

- Exception routing must write only to Automator PostgreSQL.
- Newly created exception rows must start as `status: "open"`.
- Callers must not set category, queue, priority, status, approval, write, command, or resolution fields.
- `(tenant_id, idempotency_key)` must be unique.
- Same idempotency key plus same normalized request hash is a replay and returns the existing exception.
- Same idempotency key plus a different normalized request hash is a conflict.
- The normalized request hash must be stable for equivalent signal ordering.
- Audit payloads must contain identifiers, selected category, selected queue, priority, top signal code, signal count, signal codes, and request hash only. Do not store signal messages, raw documents, raw OCR text, credentials, tokens, or connection strings in audit payloads.

## Outbox Pattern

For side effects that must follow a database state change:

```text
write domain state
write outbox event
commit transaction
worker publishes or executes side effect
mark outbox event processed
```

Use this for:

- document processing jobs;
- agent command dispatch;
- notifications;
- learning feedback jobs.

## Agent Command Persistence

`agent_commands` stores backend-to-desktop command bus state:

- command identity: `command_id`, `tenant_id`, `agent_id`;
- optional domain references: `draft_id`, `metadata_snapshot_id`;
- command payload: `command_type`, `payload_version`, compact JSON `payload`;
- idempotency: `idempotency_key` plus normalized `request_hash`;
- execution state: `status`, `retries`, `max_retries`, `deadline_at`, `last_error`, normalized `result`;
- traceability: `correlation_id`, `created_at`, `updated_at`.

`agent_heartbeats` stores the latest heartbeat per `(agent_id, tenant_id)` with run state, capabilities, optional schema snapshot id, and observation time.

Rules:

- `(tenant_id, idempotency_key)` on `agent_commands` is unique.
- `(agent_id, tenant_id)` on `agent_heartbeats` is the natural key.
- Active commands whose deadline passes must become `expired` before polling.
- Result payloads must be normalized and redacted; raw 1C diagnostics belong behind protected diagnostic references.

## Idempotency

Unique constraints should protect:

- document checksum within tenant where applicable;
- metadata snapshot hash per connection profile;
- draft write command per approved draft;
- agent command id;
- idempotency key per tenant and operation;
- audit event natural keys for retried operations.

Retries must not create duplicate drafts, commands, write results, or export packages.

## Migrations

Rules:

- Migrations are production-sensitive.
- Prefer additive migrations.
- Backfill large tables in batches.
- Avoid destructive migrations without explicit approval.
- Never edit an already-applied production migration.
- Add rollback notes for risky schema changes.
- Validate migration behavior against representative data volume.

## Schema Drift Versus Database Migrations

Do not confuse:

- application database migrations in Automator PostgreSQL;
- 1C metadata schema drift discovered by the desktop-agent.

Both require versioning, but they are separate domains.

## Redis And BullMQ

Redis data is operational state. It must not be the only place where document, draft, validation, command, or write truth exists.

Queue jobs should reference durable records by ID.

## Object Storage

Object keys should be:

- tenant-scoped;
- non-guessable;
- content-addressed where useful;
- versioned for artifacts;
- covered by retention policy.

Object metadata must not contain secrets.

## Local Agent Database

The local agent database should store:

- command queue;
- delivery acknowledgements;
- execution attempts;
- redacted diagnostics references;
- secure references to keyring/Stronghold secrets.

It should not store long-lived raw documents unless a tenant policy and local retention setting explicitly allow it.

## References

- PostgreSQL transactions: https://www.postgresql.org/docs/current/tutorial-transactions.html
- PostgreSQL constraints: https://www.postgresql.org/docs/current/ddl-constraints.html
- BullMQ production guide: https://docs.bullmq.io/guide/going-to-production
