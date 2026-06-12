# Module 2 Metadata Scanner Production Readiness Review

Date: 2026-05-29

## Scope

Reviewed Module 2, the desktop-agent OData metadata scanner:

- `apps/desktop/src-tauri/src/integrations/metadata.rs`
- `apps/desktop/src-tauri/src/lib.rs` command registration boundary
- `apps/desktop/src-tauri/Cargo.toml` direct dependency surface

The module remains read-only. It fetches the OData service document and `$metadata`, parses accessible published metadata, and returns a normalized JSON snapshot. It does not write to 1C, does not create write packages, does not execute EPF or COM paths, and does not accept credentials in IPC.

## Test Coverage Added

Added Rust tests for:

- Endpoint normalization idempotence across service root and `$metadata` URL forms.
- Endpoint rejection for generated credential-like fragments, URL userinfo, query strings, and non-HTTP schemes.
- `authRef` acceptance for opaque secure references and rejection for secret-like values.
- Timeout boundaries at default, minimum, maximum, zero, and over-limit values.
- XML parsing deduplication for duplicate fields, duplicate keys, and duplicate navigation references.
- Collection type normalization for navigation target types.
- Inclusion of classifiable 1C entity types without an `EntitySet` with a warning.
- Skipping unknown helper-only entity types without an `EntitySet`.
- Stable object and warning ordering.
- Local HTTP success body handling.
- Local HTTP status error redaction without endpoint, auth, or response-body leakage.

Property-based testing guidance was applied as deterministic invariant-style tests without adding a fuzzing dependency. This keeps the Module 2 dependency surface unchanged.

## Security Review Notes

### Insecure Defaults

No fail-open default was introduced in Module 2. The scanner rejects empty endpoints, malformed endpoints, non-HTTP schemes, username/password URL components, query strings, fragments, zero timeouts, and unbounded timeouts.

### Sharp Edges

The review expanded credential-like input detection for endpoint and auth reference boundaries. The easy path remains the safe path:

- callers pass a clean OData service root, not a full URL with secrets;
- `authRef` is an opaque secure-storage reference, not credential material;
- status and XML errors return typed redacted errors;
- only GET requests are used by this scanner.

### Secret Scanning

Targeted secret-pattern scanning found only documentation guardrails and test fixtures that intentionally contain fake secret-like markers. Tests verify that rejected inputs do not leak those fake secrets into serialized errors.

### Supply Chain

No new dependencies were added. Direct desktop-agent dependencies remain unchanged:

- `quick-xml`
- `reqwest`
- `serde`
- `serde_json`
- `sha2`
- `tauri`
- `tauri-plugin-opener`
- `thiserror`
- `tokio`
- `tracing`
- `url`

`cargo audit` and `cargo deny` are not installed in the workspace, so advisory and license scans were not run locally.

### Semgrep

The Semgrep CLI is not installed in the workspace. A real Semgrep scan was not run. When Semgrep is available, run an approved Rust-focused important-only scan with metrics disabled against `apps/desktop/src-tauri/src/integrations/metadata.rs`.

### CodeQL

The CodeQL CLI is not installed in the workspace. A local CodeQL database analysis was not run. The repository should add a future GitHub Actions CodeQL workflow for Rust and JavaScript/TypeScript.

## Verification Evidence

- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check` passed.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml metadata -- --nocapture` passed: 25 Module 2 tests.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` passed: 64 Rust tests.
- `cargo metadata --manifest-path apps/desktop/src-tauri/Cargo.toml --no-deps --format-version 1` passed.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --all-features --locked -- -D warnings` failed on pre-existing scaffold dead-code warnings outside Module 2.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --all-features --locked -- -D warnings -A dead_code` passed.
- Cyrillic scan over repository docs/code in scope found no matches.

## Remaining Follow-Up

- Resolve or intentionally annotate existing scaffold dead code so strict Clippy can pass without `-A dead_code`.
- Install and configure Semgrep and CodeQL in CI for repeatable static analysis.
- Add `cargo audit` or `cargo deny` to the security toolchain before pilot release.
- Add an integration test with a real 1C OData testbed once a pilot environment is available.
