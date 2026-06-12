# Observability Guide

Observability is crucial for tracking, diagnosing, and resolving errors across OCR engines, semantic mappings, accounting validations, and agent command executions without exposing sensitive customer data or private document files.

## Distributed Correlation IDs

Every transaction and document processing pipeline must be traceable end-to-end. Inject the following correlation keys into all logging, tracing, and queue contexts:

- `traceId`: The global transaction trace identifier.
- `tenantId`: The tenant/organization identifier.
- `documentId`: The unique document file identifier.
- `draftId`: The active draft identifier.
- `jobId`: The active background queue job identifier.
- `agentId`: The local desktop agent instance identifier.
- `commandId`: The specific Agent Command Bus instruction identifier.
- `metadataSnapshotId`: The target 1C schema snapshot identifier (where applicable).

## Structured JSON Logging

- **Backend & Workers:** Write structured logs strictly in JSON format to support indexing and querying.
- **Desktop Agent:** Capture structured tracing events in the Rust core using the `tracing` framework.

Always log:
- Unique event/span names.
- Transaction outcome statuses (success, failure).
- Execution and processing durations (milliseconds).
- Normalized error codes.
- Retry attempt counts and a boolean flag indicating if the failure was retryable.
- Correlation identifiers (`traceId`, `tenantId`, etc.).
- Redacted descriptions of user-initiated actions.

**NEVER write sensitive information to logs or external telemetry sinks.** This includes:
- Raw document files or binary arrays.
- Full extracted OCR texts or text snippets.
- Passwords, database logins, or private API keys.
- JWT tokens or session keys.
- Database connection profiles or full connection strings.
- Raw cryptographic certificates or private keys.
- Unredacted customer-identifying personal data.

## Distributed Tracing Spans

Establish tracing spans to measure execution timings and bottlenecks at key transaction boundaries:

- Document intake and S3 storage persistence.
- External OCR provider requests and responses.
- Inbound document classification.
- Semantic schema mapping proposals.
- Entity resolver database searches (counterparties, nomenclature, warehouses).
- Confidence score computations.
- Validation engine execution.
- Adaptive write routing and strategy selection.
- Agent command bus serialization and dispatching.
- Agent command queuing and local execution.
- Final 1C writing or package exporting.

## System Metrics Telemetry

The platform collects and monitors the following operational metrics:

- Volume of processed documents.
- Ingestion processing duration and error rates per OCR provider.
- AI mapping confidence score distributions.
- Volume of draft documents flagged as `needs_review`.
- Validation failure codes and trip rates.
- 1C write success and failure rates grouped by write strategy.
- Redis/BullMQ background queue depths and worker utilization.
- Retry counts and dead-letter queue (DLQ) ingress rates.
- Connected and active desktop agent counts (heartbeat track).
- Auto-updater checks, successes, and failure spikes.

## Redacted Agent Diagnostics

To investigate local failures safely, the Desktop Agent must compile a standardized `diagnosticBundle` upon request:

- Desktop application version.
- Host Operating System name and kernel version.
- Active agent capability matrix.
- Summary of the local persistent queue state (backlog size, failures).
- Connection status and latency to the 1C database.
- Auto-updater channel configuration.
- Local crash reference tags.
- Recent local command log history, filtered through a strict **redaction parser** to strip private customer data, paths, and credentials.

The compiled diagnostic bundle must never contain plaintext secrets, passwords, or raw document contents.

## Redacted Crash Reporting

- Local crash reports must undergo automated string parsing to redact directory paths, user names, or configuration strings before transmission.
- Compile and store debugging symbols separate from client distribution binaries.
- Connect crash events with specific application channels (`dev`, `pilot`, `stable`) and build versions.
- Never transmit automated crash reports without checking active client telemetry policies.

## Sentry MVP Integration

Sentry is optional and environment-driven. It is disabled unless the corresponding DSN is configured.

Server-side services use:

```text
SENTRY_DSN=
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=<git-sha-or-release-tag>
SENTRY_TRACES_SAMPLE_RATE=0.1
```

Desktop/browser code uses:

```text
VITE_SENTRY_DSN=
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_RELEASE=<git-sha-or-release-tag>
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
```

Privacy defaults:

- `sendDefaultPii` is disabled.
- Desktop session replay is disabled.
- Raw documents, OCR text, credentials, tokens, and connection strings must never be sent to Sentry.
- Sentry status endpoints expose only booleans and sample rates, never DSNs or tokens.

The API exposes a redacted operational endpoint:

```text
GET /api/observability
```

This endpoint reports whether Sentry is configured, the active environment, release label, trace sampling rate, and PII safety flags. It must not expose secrets or customer document contents.

## Alerts and Incident Triggers

Raise engineering notifications and alerts upon detecting:
- Spikes in final 1C write failures.
- Growing backlogs in Redis background processing queues.
- Outages or high error rates from OCR providers.
- Elevated latencies or timeouts on the Agent Command Bus.
- Spikes in schema drift detection (indicating 1C database updates).
- Systemic failures in auto-updater downloads or signature verifications.
- Elevated failure rates in token refresh requests.

## References

- OpenTelemetry for JavaScript: https://opentelemetry.io/docs/languages/js/
- OpenTelemetry for Rust: https://opentelemetry.io/docs/languages/rust/
- Tauri Logging Plugin: https://tauri.app/plugin/logging/
- Rust Tracing Crate: https://docs.rs/tracing/latest/tracing/
