# Testing Guide

Test suites must rigorously defend the core product invariant: AI models never write directly to 1C. All modifications must route through the draft layer, the validation engine, human or policy approval, and the Agent Command Bus.

## Rust Desktop Tests

The desktop agent test suites must cover:

- Strongly-typed errors and boundary validations.
- OData connectivity and payload generation checks.
- `.epf` preflight validation, checksum checks, safe launch-plan previews, and later command execution response parsing.
- Local queue durability, retry loops, and transaction idempotency.
- Local `pendingResult` retry behavior so network loss after local execution does not cause result loss or duplicate command execution.
- Command state machine transitions and execution outcomes.
- Proper fallback responses (returning `UnsupportedPlatform` errors on unsupported systems).
- Automatic redaction of secrets, tokens, and personal data from logs.
- Classification of retryable versus terminal execution errors.

Implementation:
- Use standard unit tests (`cargo test`) for pure, deterministic logic.
- Use integration tests with isolated databases for local persistent queues.
- Use mock 1C integration adapters to isolate external dependencies.
- Leverage "golden" metadata snapshots for schema parsing validations.
- Test connection readiness reports from stored metadata snapshots, including ready, review-only, administrator-setup, empty snapshot, and secret-redaction cases.
- Use property-based tests for mapping and entity resolver rules.
- Implement contract tests for secure network transport and cryptographic protocols.

## NestJS Backend Tests

The backend platform test suites must cover:

- Strict DTO input validation on controllers.
- Domain service orchestrations and business use cases.
- Data repositories and database isolation checks.
- Authentication guards, authorization scopes, and RBAC filters.
- Absolute tenant isolation boundaries (ensuring data cannot leak across tenant scopes).
- Document processing lifecycles and step tracking.
- Draft state machine transitions and review gates.
- Validation reports accuracy and scoring outcomes.
- Adaptive write engine routing and command bus dispatch idempotency.
- Agent command creation, polling-to-delivered transition, heartbeat accounting, result submission, expiry, and idempotency conflict behavior.

Implementation:
- Use standard NestJS testing packages (`@nestjs/testing`).
- Write unit tests for business calculators, validators, and mapping rules.
- Write End-to-End (E2E) tests with Supertest to verify controller routes and middleware guards.

## React Desktop UI Tests

The frontend UI tests must cover:
- Verification of connection state screens.
- Rendering of localized error states and diagnostics.
- Rendering of connection readiness reports in browser demo mode without requiring the Tauri runtime.
- Human-in-the-loop review and correction screens.
- Validation warning lists and action triggers.
- Accessibility compliance and keyboard shortcuts.
- Ensuring zero credentials or raw secrets are displayed in the viewport or compiled into React state.

React component testing and browser-level tests must execute independently of the Tauri desktop runtime.

## Tauri Desktop E2E Testing (WebDriver)

- Use Tauri WebDriver integration to run smoke tests on target environments.
- E2E smoke tests must verify:
  - The application boots up and starts.
  - Local health and connection check tools function properly.
  - Status and configuration views render.
  - deep-link callbacks are handled correctly.
  - Native command error indicators are visible.
- **CRITICAL OS AUTOMATION WARNING:** Tauri WebDriver officially supports automation on **Windows and Linux** platforms. **A native WKWebView WebDriver does not exist for macOS.** Therefore, macOS desktop E2E automation for the MVP must be planned as a combination of:
  - Systematic smoke and manual verification checks.
  - Mocked automated integration testing on lower sub-layers (such as isolated React browser tests and Rust unit tests).
  - Do not promise full, automated black-box E2E parity on macOS during the MVP phase.

## Essential Testbed Fixtures

To enable reliable, database-free testing, maintain a catalog of versioned test fixtures:
- Fake 1C metadata snapshots (representing various configurations).
- Altered metadata snapshots to simulate schema drift and configuration changes.
- Inbound document files (sample invoices, acts of acceptance, waybills, and UPDs).
- Mock OCR raw JSON outputs.
- Precomputed mapping suggestions and entity candidates.
- Counterparty fuzzy matching fixtures with exact INN/KPP matches, INN conflicts, exact-INN legal-name conflicts, invalid identifier lengths, legal-form normalization cases, low-similarity names, secure option bounds, secret redaction, and deterministic tie ordering.
- Nomenclature fuzzy matching fixtures with exact barcode matches, invalid barcode lengths, vendor code and SKU precedence, supplier-specific aliases, supplier-context-only review gates, unit mismatch caps, secure option bounds, product-name normalization cases, low-similarity names, secret redaction, and deterministic tie ordering.
- Draft creation fixtures with malformed direct service payloads, forbidden lifecycle/write fields, field/reference duplicate names, order-independent idempotency hashes, audit redaction, transaction rollback, unsafe correlation id redaction, and compact JSON bounds.
- Connection readiness fixtures with complete metadata, missing counterparty catalog, missing purchase document fields, missing unit or conversion setup, deterministic report IDs, sorted checks, and serialized report redaction.
- Document exception queue fixtures with low-confidence routing, ambiguous nomenclature routing, metadata-gap routing, removed duplicate-signal rejection, forbidden caller-selected queue/status fields, order-independent signal hashes, audit redaction, transaction rollback, unsafe correlation id redaction, raw OCR rejection, and secret-like signal rejection.
- Sample validation reports with diverse error thresholds.
- Mock 1C connection write errors.

## Golden Snapshot Testing

Utilize golden snapshot assertions to lock and verify the stability of critical interfaces:
- Normalized 1C metadata schemas.
- 1C schema diff outputs.
- Ingestion parser normalization outputs.
- Validation report shapes and structures.
- Local offline export package schemas and file layouts.

By using stored metadata snapshots and "golden" EDMX files, the metadata scanner, AI mapping, and schema drift checks can be tested locally on CI runners without requiring a live, running 1C database on every execution.

## 1C Testbed Environments

The project must establish and maintain four classes of active 1C testbeds for pilot validation:

1. **Standard OData Testbed:** A standard, typical 1C database with OData publishing enabled.
2. **Modified Schema Testbed:** A heavily modified database configuration containing custom attributes, non-standard tables, and bespoke required fields.
3. **External Processor (.epf) Testbed:** An environment specifically configured to run integration and write routines through external `.epf` data scripts.
4. **Windows COM Testbed:** A local Windows-only test server configured to validate dynamic dispatch, Automation Server calls, and external connections.

## References

- NestJS Testing: https://docs.nestjs.com/fundamentals/testing
- Tauri WebDriver: https://v2.tauri.app/develop/tests/webdriver/
- Vitest: https://vitest.dev/guide/
- Cargo Test: https://doc.rust-lang.org/cargo/commands/cargo-test.html
