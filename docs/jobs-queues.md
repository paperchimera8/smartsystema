# Jobs and Queues Guide

Background queues are crucial for maintaining a resilient, non-blocking document processing pipeline. During the MVP phase, we utilize **BullMQ + Redis** for background jobs orchestration.

## When to Use a Queue

Always delegate tasks to background queues when they are asynchronous, CPU-intensive, or depend on third-party APIs:

- Inbound OCR processing.
- Document classification.
- AI mapping compilation.
- Entity resolution (matching counterparties, items, warehouses).
- Running business and accounting validations.
- Orchestrating multi-step writes.
- Dispatching and retrying agent commands.
- Async parsing of learning feedback from accountant overrides.

**Never use queues as a substitute for database state machines.** The source of truth for document stages, drafts, and write outcomes must live in PostgreSQL, not hidden in Redis queues.

## Minimal Job Payload

Keep queue payloads as lightweight as possible. Never place large chunks of data or files inside Redis. Pass primitive identifiers:

```text
tenantId
documentId
draftId
metadataSnapshotId
idempotencyKey
attemptContext
```

The payload MUST NOT contain:
- Raw document binary arrays or base64 files.
- Full unredacted OCR texts.
- Secrets, database connection profiles, or client credentials.
- Large 1C metadata snapshots.

## Idempotency Rules

Every background job executing a stateful mutation or side effect must carry a unique `idempotencyKey`.

Side effects include:
- Generating and saving an OCR artifact.
- Initiating a draft document.
- Dispatching an instruction to the Agent Command Bus.
- Committing a final write outcome.
- Constructing an offline export package.

Core Idempotency Rule:

```text
Retrying the same job with the same idempotency key -> same final database state, zero duplicates.
```

## Retries and Backoff Policies

- **Transient Failures:** Safely retry network drops, API rate limits, or transient timeouts.
- **Validation Failures:** Never retry logical validator failures (e.g., missing mandatory fields, invalid dates). Flag these as terminal errors immediately.
- **Policy Failures:** Block automatic retries if tenant isolation or privacy policies are breached.
- **Uncaught Exceptions:** Route unexpected code errors to the failed state accompanied by diagnostic tracking IDs.
- Configure retry policies with safe exponential backoff limits and randomized jitter to prevent rate limit spikes on external providers.
- Move jobs to a Dead-Letter Queue (DLQ) or terminal failed state once max retry limits are exhausted.

## Dead-Letter Queue (DLQ) States

Unrecoverable or terminally failed jobs must persist in a visible DLQ structure containing:

- Queue and Job name.
- Unique Job ID.
- Correlation keys: `tenantId`, `documentId`, `draftId`.
- Current attempt count.
- Normalized error code.
- A boolean flag indicating whether the failure was retryable.
- Timestamp of the last execution failure.
- Redacted technical diagnostic reference path.

## Job Status Model

Jobs transition through the following states:

```text
queued
  -> running
  -> waiting_retry
  -> completed

failed_retryable
failed_terminal
cancelled
dead_lettered
```

## Worker Execution Rules

- Worker handlers must throw structured JS `Error` instances, never primitive strings or loose objects.
- Every worker thread must inject correlation IDs (`traceId`, `tenantId`, `documentId`) into all trace and logging contexts.
- Workers are forbidden from swallowing errors silently.
- Workers must implement graceful shutdown patterns, completing active operations or safely rolling back states on SIGTERM signals.
- Configure queue concurrency levels carefully depending on resource constraints (e.g., limit concurrent OCR/AI provider requests to respect API rate limits).

## When to Transition to Temporal

Revisit and evaluate migrating from BullMQ to Temporal if the platform architecture evolves to require:

- Extremely long-running orchestration pipelines that span hours, days, or weeks.
- Highly expensive, multi-stage transaction workflows.
- Native support for durable timers, signals, and external wake-ups.
- Declarative, deterministic replay models.
- Complex Saga or compensating transaction workflows across multiple independent services.

For MVP pilots, BullMQ is selected due to its lower operational overhead and seamless NestJS integration.

## References

- BullMQ Documentation: https://docs.bullmq.io/
- BullMQ Retries & Backoffs: https://docs.bullmq.io/guide/retrying-failing-jobs
- BullMQ Production Checklist: https://docs.bullmq.io/guide/going-to-production
- NestJS Queue integration: https://docs.nestjs.com/techniques/queues
- Temporal Retry Policies: https://docs.temporal.io/encyclopedia/retry-policies
