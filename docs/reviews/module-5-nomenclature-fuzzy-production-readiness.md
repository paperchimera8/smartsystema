# Module 5 Nomenclature Fuzzy Resolver Production Readiness Review

Date: 2026-05-29

## Scope

Reviewed Module 5, the pure TypeScript nomenclature fuzzy resolver:

- `apps/worker/src/entity-resolution/nomenclature-fuzzy.ts`
- `apps/worker/src/entity-resolution/nomenclature-fuzzy.test.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/nomenclature-resolution.test.ts`
- `docs/entity-resolution.md`
- `docs/testing.md`

The resolver remains advisory only. It does not query databases, call LLMs, call external services, create nomenclature, approve drafts, enqueue jobs, or write to 1C.

## Changes Made

- Added runtime fail-closed handling for unsupported payload versions.
- Made configurable scoring options secure by default: callers cannot lower the auto-accept threshold below `0.90`, raise name-only scores above `0.82`, or raise unit-mismatch scores above `0.65`.
- Added barcode validation before exact matching. Barcodes are normalized to digits and accepted only at common GTIN/UPC/EAN lengths: 8, 12, 13, or 14 digits.
- Added severe `supplier-context-only` warnings when a supplier-specific code match has no compatible unit, generic identifier, or reasonable product-name support.
- Added warning codes for invalid extracted and candidate identifiers.
- Redacted secret-like display names and source line identifiers, and expanded secret marker detection.
- Added property-inspired tests for normalization idempotence, trigram symmetry/bounds, secure option bounds, invalid barcode lengths, deterministic candidate limits, supplier-context-only review gates, and secret redaction.

## Skill Checklist

- `typescript-advanced-types`: kept shared contracts literal and compile-checked with `satisfies`.
- `property-based-testing`: added generated case loops for normalization, similarity, option bounds, candidate limits, and secret-marker invariants without adding a new dependency.
- `insecure-defaults`: removed unsafe caller-controlled scoring downgrades that could make weak matches review-free.
- `sharp-edges`: reduced misuse risk around runtime options, invalid barcodes, and supplier-context-only matches.
- `differential-review`: checked the changed resolver and shared contract boundary.
- `supply-chain-risk-auditor`: no new dependencies were added; `pnpm audit --prod` reported no known vulnerabilities.
- `audit-prep-assistant`: added this review artifact and stronger test coverage.
- `code-maturity-assessor`: improved validation, documentation, and test maturity for a safety-critical resolver.
- `secret-scanning`: performed targeted scans over changed code and docs.
- `semgrep` and `codeql`: CLIs are not installed locally, so no scan was run.

## Verification

Passed:

- `pnpm --filter @automator/contracts typecheck`
- `pnpm --filter @automator/contracts test`
- `pnpm --filter @automator/contracts build`
- `pnpm --filter @automator/worker typecheck`
- `pnpm --filter @automator/worker test`
- `pnpm --filter @automator/worker build`
- `pnpm --filter @automator/api build`
- `pnpm audit --prod`
- JSON parsing for root, contracts, worker, and API package files.
- English-only scan over docs, packages, worker source, and generated contract outputs.

Known limitation:

- `semgrep` and `codeql` are not installed in the local environment.

## Residual Risks

- Runtime API boundary validation should be added when this resolver is exposed through a NestJS controller or worker job.
- A future persisted catalog repository should validate barcode format, supplier alias provenance, and catalog snapshot freshness before passing candidates to this pure resolver.
- Full static analysis should be added to CI once Semgrep and CodeQL are available.
