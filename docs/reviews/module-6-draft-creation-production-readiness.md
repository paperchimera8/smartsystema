# Module 6 Draft Creation Production Readiness Review

Date: 2026-05-29

## Scope

Reviewed Module 6, the backend-only draft creation module:

- `apps/api/src/modules/drafts/drafts.controller.ts`
- `apps/api/src/modules/drafts/drafts.service.ts`
- `apps/api/src/modules/drafts/drafts.repository.ts`
- `apps/api/src/modules/drafts/dto/create-draft.dto.ts`
- `apps/api/src/modules/database/schema.ts`
- `apps/api/drizzle/0001_create_drafts.sql`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/draft-creation.test.ts`
- draft, persistence, review, and testing documentation.

The module stores Automator review drafts in PostgreSQL only. It does not create write packages, enqueue jobs, dispatch Desktop Agent commands, call workers, spawn processes, or write to 1C.

## Changes Made

- Added fail-closed direct service validation for malformed payload sections, arrays, nested objects, confidence summaries, and validation summaries.
- Added stable field/reference sorting before idempotency hashing so equivalent payload ordering does not create false conflicts.
- Added stricter compact JSON bounds for nested mapped values and object keys.
- Expanded secret-like and raw-document marker detection for nested keys and values.
- Redacted unsafe error metadata, including `correlationId` and `field`, before building `DraftCreationError` responses.
- Expanded DTO tests for unsupported payload versions, nested command fields, and array count limits.
- Expanded repository tests to assert forced non-writeable draft inserts and redacted audit payload shape.
- Updated docs to record order-independent idempotency, typed fail-closed errors, and audit redaction expectations.

## Skill Checklist

- `nestjs-best-practices`: kept controller thin, validation at the DTO boundary, service-owned lifecycle rules, repository-owned persistence, and transactional audit creation.
- `typescript-advanced-types`: preserved literal contract states and compile-checked DTO/service/repository boundaries.
- `property-based-testing`: added generated case loops for malformed payloads and deterministic normalization without adding a new dependency.
- `insecure-defaults`: prevented unsafe caller-provided statuses, command fields, secret material, raw document markers, and unsafe error metadata.
- `sharp-edges`: reduced misuse risk around idempotency ordering, nested command data, and direct service calls.
- `differential-review`: reviewed changed API, persistence, contract, and documentation boundaries for side effects.
- `supply-chain-risk-auditor`: no new dependencies were added; `pnpm audit --prod` is part of verification.
- `audit-prep-assistant`: added this review artifact and stronger security-oriented tests.
- `code-maturity-assessor`: improved input validation, redaction, deterministic hashing, and test coverage for a persistence module.
- `secret-scanning`: targeted scans cover changed draft code, contracts, and docs.
- `semgrep` and `codeql`: CLIs are not installed locally, so local scans are unavailable.

## Verification

Passed:

- `pnpm --filter @automator/contracts typecheck`
- `pnpm --filter @automator/contracts test`
- `pnpm --filter @automator/contracts build`
- `pnpm --filter @automator/api typecheck`
- `pnpm --filter @automator/api test`
- `pnpm --filter @automator/api build`
- `docker compose -f infra/docker-compose.yml config`
- `pnpm audit --prod`
- JSON/TOML parsing where applicable.
- English-only scan over repository docs and changed API/contracts areas.
- Targeted secret and side-effect scans over Module 6.

Known limitation:

- `semgrep` and `codeql` are not installed in the local environment.

## Residual Risks

- Repository tests still use a fake transaction harness. A real PostgreSQL integration test should be added once the migration runner and test database harness exist.
- `tenantId` and `createdByUserId` remain explicit request fields until authentication middleware derives them from the session.
- Full Semgrep and CodeQL analysis should run in CI once those tools are installed there.
