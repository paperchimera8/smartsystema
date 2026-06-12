# Backend NestJS Guide

The Backend Platform functions as the centralized control plane and decision engine of the product. It manages users, organizations, documents, the OCR/AI ingestion pipeline, drafts, business validation rules, write orchestration, and immutable audit logs.

## Module Boundaries

Each domain module within NestJS must maintain a single, focused area of responsibility:

- `auth`: User authentication, session management, RBAC, PKCE, and machine enrollment.
- `tenants`: Tenant isolation, data residency boundaries, and retention policy enforcement.
- `agents`: Agent registry, heartbeat monitoring, capability matching, and command bus dispatch.
- `connections`: 1C database connection credentials and profile configurations.
- `metadata`: Schema snapshots storage, diff analysis, and config drift detection.
- `documents`: File ingestion endpoints, signed S3 upload paths, and file lifecycle tracking.
- `document-exceptions`: Exception queue routing for documents that cannot safely continue automatically.
- `ocr`: OCR engine adapters, layout parsing, and OCR artifact archives.
- `classification`: Inbound document type classifiers.
- `mapping`: Schema-to-document semantic mappings.
- `resolvers`: Counterparty, contract, nomenclature, and warehouse resolvers.
- `confidence`: Unified confidence scoring and explanation generation.
- `drafts`: Draft state machines and review workflow trackers.
- `validation`: Mandatory field checks, open periods, accounting rules, and security validators.
- `write`: Adaptive write orchestration and integration strategy routing.
- `audit`: Immutable, append-only security logs.
- `learning`: User feedback collection and resolver rule tuning.

## REST Controllers

- Keep controller classes thin, focusing exclusively on routing and request adaptation.
- Validate all incoming DTO payloads at the entry point using NestJS's global `ValidationPipe`.
- Never expose internal database entities or raw schema classes directly. Use mapped DTO structures.
- Do not perform heavy, long-running processes (e.g., parsing a document or writing to 1C) inside HTTP request handlers.
- Return a standard reference status, a job ID, or a document processing tracking token for asynchronous or long-running work.

## Business Services

- Domain services contain the core business and orchestration logic.
- Services must remain completely decoupled from HTTP concerns.
- Ensure all transactional side-effects (e.g., database writes, queue postings, file creations, or agent commands) are explicit.
- Enforce strict idempotency rules across all transactional write paths.

## Persistency & Repositories

- Data repositories must encapsulate all database and persistency mechanics.
- Domain services are forbidden from compiling loose, ad-hoc raw SQL strings.
- Destructive operations (such as deletes or updates to sensitive logs) require explicit method naming and dedicated integration test coverage.
- SQL migrations must undergo thorough code reviews as production-critical changes.

## Global DTO Validation Rules

The platform enforces a strict validation policy on all incoming payloads:

```text
whitelist: true
forbidNonWhitelisted: true
transform: true
```

Incoming DTOs must rigorously validate:
- Presence of mandatory fields.
- Valid UUID and entity identifier formats.
- Safe enumeration values.
- Valid date ranges and boundary conditions.
- Uploaded file formats and sizes.
- Permitted pagination boundaries.
- Tenant-scoped database keys.

## Asynchronous Background Queues

- API handlers only create and register jobs in Redis, returning immediate status references.
- Decoupled worker processes handle CPU-bound tasks (OCR, layout parsers, AI mappings, validation, and write commands).
- Keep background job payloads minimal. Payloads must only contain primitive identifiers linking back to Postgres or object storage records:
  
  ```text
  tenantId
  documentId
  draftId
  idempotencyKey
  ```
- **Never transmit raw binary file buffers inside job queue payloads.**

## Authentication & Machine Enrollment

- Desktop native agent authentication must use an external system browser combined with **Authorization Code + PKCE**, never an embedded login webview.
- Agent machine enrollment is separated from user authentication.
- Secure API keys or client certificates must authenticate background server-to-server and agent-to-backend communications.
- Every dispatched agent command requires explicit tenant and agent entitlement validation.

## OpenAPI Documentation

- Document all public endpoints using NestJS Swagger annotations.
- Document expected error formats and HTTP status responses clearly.
- Segregate internal administration or diagnostics endpoints behind distinct namespaces.
- Do not include real personal or customer data in Swagger DTO example schemas.

## Infrastructure Health Monitoring

Segregate health reporting into separate, discrete endpoints:
- **Liveness:** Verifies that the API process is alive.
- **Readiness:** Verifies that database connections, Redis queues, and object storage connections are functioning.
- **Dependency Health:** System checks on third-party OCR or cloud providers.
- **Worker Telemetry:** Tracks processing queues and worker capacities.
- **Agent Connectivity:** Summarizes connected, heartbeat-tracking desktop agents.

## Application Configuration

- Manage environment variables using `@nestjs/config` and typed config schemas.
- Ensure the application fails immediately upon startup if required environment configurations are missing or invalid.
- Never write credentials, database passwords, or private API keys to logging sinks.
- Tenant policies and execution parameters must never be used to override environment-level security limits.

## Testing Strategy

- **Unit Testing:** Focuses on pure services, calculators, rules, and validators.
- **E2E Testing:** Covers controller routes, authentication guards, and API pipelines.
- **Contract Testing:** Validates shared contracts and DTO matches between NestJS and React/Rust components.
- **Fixture Testing:** Uses predefined metadata snapshots to verify mappings and schema diff outputs.
- **Idempotency Testing:** Simulates repeat writes to ensure no duplicate operations are processed.

## References

- NestJS Validation: https://docs.nestjs.com/techniques/validation
- NestJS Queues: https://docs.nestjs.com/techniques/queues
- NestJS Config: https://docs.nestjs.com/techniques/configuration
- NestJS OpenAPI: https://docs.nestjs.com/openapi/introduction
- NestJS Health Checks: https://docs.nestjs.com/recipes/terminus
- NestJS Testing: https://docs.nestjs.com/fundamentals/testing
