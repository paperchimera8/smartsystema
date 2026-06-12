# ADR 0002: BullMQ Before Temporal

## Status

Accepted for MVP.

## Context

The MVP needs retries, backoff, worker events, and operational simplicity for OCR, mapping, validation, and document processing jobs. Durable multi-day deterministic workflows may be needed later, but they are not required to prove the first integration loop.

## Decision

Use BullMQ and Redis for MVP background jobs. Revisit Temporal when workflows become long-running, expensive to replay manually, or require durable orchestration guarantees across many services.

## Consequences

- Lower operational overhead for early pilots.
- Easier NestJS integration.
- Workflow state that must survive complex process boundaries should remain explicit in Postgres, not hidden only in queue payloads.

